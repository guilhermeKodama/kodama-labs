"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/lib/prisma";
import { dispatchBeacon } from "@/server/lib/dispatch-beacon";
import { enqueue } from "@/server/jobs/queue";

export async function triggerBeaconNow() {
  await dispatchBeacon();
  revalidatePath("/lab");
}

export async function dispararDigestAgora() {
  const scheduledFor = new Date();
  await enqueue(
    "digest",
    { scheduledFor: scheduledFor.toISOString() },
    { uniqueKey: `digest:manual:${Date.now()}` }
  );
  revalidatePath("/lab");
}

// Exercises the full send path (approve → 45s job → whatsapp worker →
// sock.sendMessage → ingest the return) against the connected account's own
// self-chat, so it can be verified end-to-end without touching a real
// contact. The anchor message is synthetic (never actually received) — it
// only exists so ReplyDraft has somewhere to point its required FK.
export async function testarEnvioSelfChat() {
  const status = await prisma.integrationStatus.findUnique({ where: { channel: "whatsapp" } });
  if (!status?.ownWid) return;

  const chat = await prisma.chat.upsert({
    where: { waChatId: status.ownWid },
    create: { waChatId: status.ownWid, isGroup: false, name: "Você (self-chat)" },
    update: {},
  });

  const testMessage = await prisma.message.create({
    data: {
      waMessageId: `test-selfchat-${Date.now()}`,
      chatId: chat.id,
      direction: "IN",
      type: "conversation",
      body: "[mensagem de teste — verificação do caminho de envio]",
      occurredAt: new Date(),
    },
  });

  const draft = await prisma.replyDraft.create({
    data: {
      messageId: testMessage.id,
      text: `Teste de envio do attention — ${new Date().toLocaleTimeString("pt-BR")}`,
      model: "test",
      status: "APPROVED",
      approvedAt: new Date(),
    },
  });

  await enqueue(
    "send",
    { draftId: draft.id },
    { uniqueKey: `send:${draft.id}`, runAt: new Date(Date.now() + 45_000) }
  );

  revalidatePath("/lab");
}

// Calibration tool — backfills triage for recent messages that predate the
// pipeline (or missed the 24h auto-triage window on ingest), so nivel/resumo
// can be reviewed against real data before push ever goes live.
export async function triarUltimosDias() {
  const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const candidates = await prisma.message.findMany({
    where: { direction: "IN", triagedAt: null, occurredAt: { gte: since } },
    select: { id: true },
  });

  for (const m of candidates) {
    try {
      await enqueue("triage", { messageId: m.id }, { uniqueKey: `triage:${m.id}` });
    } catch (error) {
      console.error("[lab] falha ao enfileirar triagem manual", error);
    }
  }

  revalidatePath("/lab");
}

export async function startFocusWindow(formData: FormData) {
  const label = String(formData.get("label") ?? "").trim();
  if (!label) return;
  await prisma.focusWindow.create({ data: { label } });
  revalidatePath("/lab");
}

export async function endFocusWindow(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await prisma.focusWindow.update({ where: { id }, data: { endsAt: new Date() } });
  revalidatePath("/lab");
}
