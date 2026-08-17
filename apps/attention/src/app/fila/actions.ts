"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/lib/prisma";
import { enqueue, cancelByUniqueKey } from "@/server/jobs/queue";
import { spTomorrowAt } from "@/server/lib/timezone";

export async function aprovarEnviar(formData: FormData) {
  const draftId = String(formData.get("draftId") ?? "");
  if (!draftId) return;

  const draft = await prisma.replyDraft.findUnique({ where: { id: draftId } });
  // Already approved/sent/canceled (double-tap, or state moved on) — no-op.
  if (!draft || draft.status !== "DRAFT") {
    revalidatePath("/fila");
    return;
  }

  await prisma.replyDraft.update({
    where: { id: draftId },
    data: { status: "APPROVED", approvedAt: new Date() },
  });
  await enqueue(
    "send",
    { draftId },
    { uniqueKey: `send:${draftId}`, runAt: new Date(Date.now() + 45_000) }
  );

  revalidatePath("/fila");
}

export async function desfazer(formData: FormData) {
  const draftId = String(formData.get("draftId") ?? "");
  if (!draftId) return;

  const canceled = await cancelByUniqueKey(`send:${draftId}`);
  if (canceled) {
    await prisma.replyDraft.update({ where: { id: draftId }, data: { status: "DRAFT", approvedAt: null } });
  }
  // else: the send already fired — the card will reflect "enviado" (item
  // leaves the queue) on the next refresh regardless of what we do here.

  revalidatePath("/fila");
}

export async function editarDraft(formData: FormData) {
  const draftId = String(formData.get("draftId") ?? "");
  const texto = String(formData.get("texto") ?? "").trim();
  if (!draftId || !texto) return;

  await prisma.replyDraft.updateMany({ where: { id: draftId, status: "DRAFT" }, data: { text: texto } });
  revalidatePath("/fila");
}

export async function regenerarDraft(formData: FormData) {
  const messageId = String(formData.get("messageId") ?? "");
  const draftId = formData.get("draftId") ? String(formData.get("draftId")) : null;
  if (!messageId) return;

  if (draftId) {
    await prisma.replyDraft.updateMany({ where: { id: draftId, status: "DRAFT" }, data: { status: "CANCELED" } });
  }
  // Fresh uniqueKey each time — "draft:<messageId>" was already consumed by
  // the first generation, and skipDuplicates would silently no-op a reuse.
  await enqueue("draft", { messageId }, { uniqueKey: `draft:${messageId}:${Date.now()}` });
  revalidatePath("/fila");
}

export async function adiar(formData: FormData) {
  const messageId = String(formData.get("messageId") ?? "");
  const mode = String(formData.get("mode") ?? "3h");
  if (!messageId) return;

  const snoozedUntil =
    mode === "tomorrow" ? spTomorrowAt("08:00") : new Date(Date.now() + 3 * 60 * 60 * 1000);
  await prisma.message.update({ where: { id: messageId }, data: { queueState: "SNOOZED", snoozedUntil } });
  revalidatePath("/fila");
}

export async function naoImportante(formData: FormData) {
  const messageId = String(formData.get("messageId") ?? "");
  if (!messageId) return;

  await prisma.message.update({ where: { id: messageId }, data: { queueState: "DISMISSED" } });
  revalidatePath("/fila");
}
