import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { prisma } from "@capital/server/lib/prisma";
import { uploadAttachment } from "@capital/server/modules/attachments/services/upload-attachment";
import { runAgentTurn } from "../agent/loop";

const IMAGE = process.env.E2E_IMAGE;

describe.skipIf(!IMAGE)("read_attachment (live API)", () => {
  it("opens a receipt already attached to an existing transaction", async () => {
    const userId = (
      await prisma.user.findFirstOrThrow({ where: { email: "demo@capital.app" }, select: { id: true } })
    ).id;
    const personal = await prisma.personalAccount.findFirstOrThrow({ where: { userId }, select: { id: true } });

    const tx = await prisma.transaction.create({
      data: {
        entityType: "personal",
        personalAccountId: personal.id,
        date: new Date("2026-08-14"),
        description: "Compra no mercado (E2E anexo)",
        amount: 247.9,
        type: "expense",
        category: "Other Expense",
        currency: "BRL",
      },
      select: { id: true },
    });

    await uploadAttachment(
      userId,
      {
        kind: "RECEIPT",
        ownerType: "transaction",
        ownerId: tx.id,
        file: {
          buffer: readFileSync(IMAGE!),
          mimeType: "image/png",
          originalName: "recibo-mercado.png",
        },
      },
      prisma
    );

    const conversation = await prisma.agentConversation.create({
      data: { userId, title: "E2E read_attachment" },
      select: { id: true },
    });

    const tools: string[] = [];
    let text = "";
    await runAgentTurn(
      {
        userId,
        conversationId: conversation.id,
        text: `Abre o comprovante anexado à transação ${tx.id} e me diz o valor, a data e o destinatário que aparecem nele.`,
      },
      (e) => {
        if (e.type === "token") { text += e.delta; return; }
        if (e.type === "tool_call_started") tools.push(e.tool);
        if (e.type === "error") console.log("ERROR EVENT:", e.message);
      }
    );

    console.log("TOOLS CALLED:", tools.join(" -> "));
    console.log("ASSISTANT SAID:\n" + text);

    const rows = await prisma.agentMessage.findMany({
      where: { conversationId: conversation.id, kind: "tool_results" },
      select: { content: true },
    });
    const raw = JSON.stringify(rows.map((r) => r.content));
    console.log("tool_results bytes:", raw.length, "| has ref:", raw.includes("capital_file_ref"));

    expect(tools).toContain("read_attachment");
    // It described what is actually in the pixels.
    expect(text).toMatch(/247[.,]90/);
    expect(text).toMatch(/A[CÇ]UCAR|Açúcar|Acucar/i);
    // The bytes it saw were never written to the tool_results row.
    expect(raw).toContain("capital_file_ref");
    expect(/[A-Za-z0-9+/]{500,}/.test(raw)).toBe(false);
  }, 300_000);
});
