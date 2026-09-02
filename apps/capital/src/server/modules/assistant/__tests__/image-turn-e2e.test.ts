import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { prisma } from "@capital/server/lib/prisma";
import { uploadConversationFile } from "../services/upload-conversation-file";
import { runAgentTurn } from "../agent/loop";
import { buildApiMessages } from "../agent/message-content";

const IMAGE = process.env.E2E_IMAGE;

describe.skipIf(!IMAGE)("image turn end to end (live API)", () => {
  it("uploads an image, lets the model read it, and persists a ref not bytes", async () => {
    const userId = (
      await prisma.user.findFirstOrThrow({ where: { email: "demo@capital.app" }, select: { id: true } })
    ).id;
    const conversation = await prisma.agentConversation.create({
      data: { userId, title: "E2E imagem" },
      select: { id: true },
    });

    const file = await uploadConversationFile(
      userId,
      {
        conversationId: conversation.id,
        file: {
          buffer: readFileSync(IMAGE!),
          mimeType: "application/octet-stream",
          originalName: "comprovante-pix.png",
        },
      },
      prisma
    );
    console.log("UPLOADED:", {
      fileType: file.fileType,
      statementKind: file.statementKind,
      mimeType: file.mimeType,
      parseStatus: file.parseStatus,
    });
    expect(file.fileType).toBe("image");
    expect(file.mimeType).toBe("image/png");

    const events: string[] = [];
    let text = "";
    await runAgentTurn(
      {
        userId,
        conversationId: conversation.id,
        text: "O que tem nessa imagem? Diga o valor, a data e o estabelecimento que você está vendo. Só descreva o que leu, não proponha plano.",
        fileIds: [file.id],
      },
      (e) => {
        if (e.type === "token") { text += e.delta; return; }
        events.push(e.type + (e.type === "error" ? `: ${e.message}` : ""));
      }
    );

    console.log("EVENTS:", events.join(" -> "));
    console.log("ASSISTANT SAID:\n" + text);

    const rows = await prisma.agentMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "asc" },
      select: { role: true, kind: true, content: true },
    });
    const userRow = rows.find((r) => r.kind === "user_text")!;
    const raw = JSON.stringify(userRow.content);
    console.log("PERSISTED USER ROW:", raw);
    console.log("row bytes:", raw.length);

    expect(raw).toContain("capital_file_ref");
    expect(raw).toContain("image/png");
    // The whole point of the marker: no base64 payload in the DB row.
    expect(/[A-Za-z0-9+/]{500,}/.test(raw)).toBe(false);

    const api = await buildApiMessages(rows.map((r) => ({ role: r.role, content: r.content })));
    const types = (api[0]!.content as Array<{ type: string }>).map((b) => b.type);
    console.log("REBUILT BLOCK TYPES:", types);
    expect(types).toContain("image");

    // The model actually read the pixels.
    expect(text).toMatch(/247[.,]90/);
  }, 180_000);
});
