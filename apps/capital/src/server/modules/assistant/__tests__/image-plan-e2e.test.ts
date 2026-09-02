import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { prisma } from "@capital/server/lib/prisma";
import { uploadConversationFile } from "../services/upload-conversation-file";
import { runAgentTurn } from "../agent/loop";

const IMAGE = process.env.E2E_IMAGE;

describe.skipIf(!IMAGE)("image -> import plan (live API)", () => {
  it("turns a receipt screenshot into a proposed plan awaiting UI confirmation", async () => {
    const userId = (
      await prisma.user.findFirstOrThrow({ where: { email: "demo@capital.app" }, select: { id: true } })
    ).id;
    const conversation = await prisma.agentConversation.create({
      data: { userId, title: "E2E imagem -> plano" },
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

    const tools: string[] = [];
    let text = "";
    await runAgentTurn(
      {
        userId,
        conversationId: conversation.id,
        text: "Registra essa despesa na minha conta pessoal.",
        fileIds: [file.id],
      },
      (e) => {
        if (e.type === "token") { text += e.delta; return; }
        if (e.type === "tool_call_started") tools.push(e.tool);
        if (e.type === "error") console.log("ERROR EVENT:", e.message);
      }
    );

    console.log("TOOLS CALLED:", tools.join(" -> "));
    console.log("ASSISTANT SAID:\n" + text);

    const plans = await prisma.importPlan.findMany({
      where: { conversationId: conversation.id },
      select: { status: true, payload: true, summary: true },
    });
    console.log("PLANS:", JSON.stringify(plans.map((p) => ({ status: p.status, summary: p.summary })), null, 2));
    const payload = plans[0]?.payload as { transactions?: Array<Record<string, unknown>> } | undefined;
    console.log("PLAN TRANSACTIONS:", JSON.stringify(payload?.transactions, null, 2));

    expect(tools).toContain("propose_import_plan");
    expect(plans).toHaveLength(1);
    // Safety boundary intact: a plan from a file is only ever "proposed"
    // until the user clicks confirm in the UI.
    expect(plans[0]!.status).toBe("proposed");
    expect(tools).not.toContain("commit_plan");
    // It read the real number off the image, not a hallucinated one.
    expect(JSON.stringify(payload?.transactions)).toContain("247.9");
  }, 300_000);
});
