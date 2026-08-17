import type { WASocket } from "@whiskeysockets/baileys";
import { prisma } from "../lib/prisma";
import { shouldIngest, ingestMessage } from "./ingest";
import { complete, type ClaimedJob } from "../jobs/queue";

const STALENESS_MS = 10 * 60 * 1000;

// Always resolves the job to a terminal state itself (complete or EXPIRED,
// via job.status directly) in every path that doesn't throw. The one thing
// allowed to throw is sock.sendMessage() itself — nothing was sent yet at
// that point, so the caller's fail()-and-retry is safe. Everything after
// sendMessage returns must not throw in a retryable way, since a retry there
// would send the message a second time.
export async function handleSend(
  job: ClaimedJob,
  { sock, ownWid }: { sock: WASocket; ownWid: string }
): Promise<void> {
  const { draftId } = job.payload as { draftId: string };

  const draft = await prisma.replyDraft.findUnique({
    where: { id: draftId },
    include: { message: { include: { chat: true } } },
  });

  if (!draft || draft.status !== "APPROVED") {
    // Undone or otherwise moved on since this job was enqueued — nothing to send.
    await complete(job.id);
    return;
  }

  if (Date.now() > job.runAt.getTime() + STALENESS_MS) {
    // The server was down/behind long enough that firing this now would be
    // a stale surprise reply. Don't send — hand the item back to the queue.
    await Promise.all([
      prisma.replyDraft.update({ where: { id: draft.id }, data: { status: "EXPIRED" } }),
      prisma.message.update({ where: { id: draft.messageId }, data: { queueState: "QUEUED" } }),
      prisma.job.update({ where: { id: job.id }, data: { status: "EXPIRED", finishedAt: new Date() } }),
    ]);
    console.warn(`[whatsapp] envio expirado (draft ${draft.id}) — item volta pra fila sem enviar`);
    return;
  }

  // Recipient comes exclusively from the chat FK on the message this draft
  // replies to — the LLM has no way to choose or influence who this goes to.
  const jid = draft.message.chat.waChatId;
  const result = await sock.sendMessage(jid, { text: draft.text });

  await Promise.all([
    prisma.replyDraft.update({
      where: { id: draft.id },
      data: { status: "SENT", sentAt: new Date(), sentWaMessageId: result?.key.id ?? null },
    }),
    prisma.message.update({ where: { id: draft.messageId }, data: { queueState: "REPLIED" } }),
  ]);

  if (result && shouldIngest(result)) {
    try {
      // Baileys doesn't echo our own sendMessage() back through
      // messages.upsert (confirmed empirically) — without this, our own OUT
      // message would never land in the DB.
      await ingestMessage(result, { ownWid, sock });
    } catch (error) {
      console.error("[whatsapp] falha ao ingerir a própria mensagem enviada", error);
    }
  }

  await complete(job.id);
}
