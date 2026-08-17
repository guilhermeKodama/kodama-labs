import { prisma } from "../lib/prisma";
import { env } from "../../env";
import { displayName } from "../lib/display-name";
import { spTodayStart } from "../lib/timezone";
import { triageMessage, type TriageResult } from "../llm/triage";
import { draftReply } from "../llm/draft";
import { sendPush } from "../push/send-push";
import { enqueue } from "./queue";

const ACTIVE_DRAFT_STATUSES = ["DRAFT", "APPROVED"] as const;
const LEFT_QUEUE_STATES = new Set(["DISMISSED", "RESOLVED_BY_REPLY", "REPLIED"]);

export async function handleTriage(payload: { messageId: string }): Promise<void> {
  const { messageId } = payload;
  const result = await triageMessage(messageId);

  await prisma.message.update({
    where: { id: messageId },
    data: {
      triageNivel: result.nivel,
      triagePrecisaResposta: result.precisa_resposta,
      triagePrazo: result.prazo,
      triageResumo: result.resumo_1_linha,
      triagedAt: new Date(),
    },
  });

  if (result.nivel === "agora") {
    await handleAgora(messageId, result);
  }
}

async function handleAgora(messageId: string, result: TriageResult): Promise<void> {
  // Distinct tag, not row count — sendPush fans out one Notification row per
  // subscription, so counting rows would over-count a single "agora" event
  // for anyone with more than one device registered.
  const agoraToday = await prisma.notification.findMany({
    where: { kind: "now", sentAt: { gte: spTodayStart() } },
    select: { tag: true },
    distinct: ["tag"],
  });

  if (agoraToday.length >= env.AGORA_MAX_PER_DAY) {
    await prisma.message.update({ where: { id: messageId }, data: { triageNivel: "digest" } });
    console.warn(
      `[jobs] cap de "agora" atingido (${agoraToday.length}/${env.AGORA_MAX_PER_DAY}) — ${messageId} rebaixado para digest`
    );
    return;
  }

  const message = await prisma.message.update({
    where: { id: messageId },
    data: { queueState: "QUEUED" },
    include: { chat: true, sender: true },
  });

  if (result.precisa_resposta) {
    try {
      await enqueue("draft", { messageId }, { uniqueKey: `draft:${messageId}` });
    } catch (error) {
      console.error("[jobs] falha ao enfileirar rascunho de agora", error);
    }
  }

  await sendPush({
    kind: "now",
    title: displayName({ chat: message.chat, sender: message.sender }),
    body: result.resumo_1_linha,
    url: "/fila",
    tag: `now:${messageId}`,
  });
}

export async function handleDraft(payload: { messageId: string }): Promise<void> {
  const message = await prisma.message.findUnique({
    where: { id: payload.messageId },
    select: { queueState: true },
  });
  if (!message) return;
  // Item already left the queue (dismissed / phone reply / already sent) —
  // no point spending a generation on it.
  if (message.queueState && LEFT_QUEUE_STATES.has(message.queueState)) return;

  await draftReply(payload.messageId);
}

function formatWindowLabel(scheduledFor: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(scheduledFor);
}

function waitingLabel(occurredAt: Date): string {
  const hours = Math.floor((Date.now() - occurredAt.getTime()) / (60 * 60 * 1000));
  if (hours < 1) return "poucos minutos";
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

type DigestItem = {
  id: string;
  occurredAt: Date;
  triagePrazo: string | null;
  triagePrecisaResposta: boolean | null;
  chat: { isGroup: boolean; name: string | null; waChatId: string };
  sender: { name: string | null; pushname: string | null } | null;
};

// Deterministic, zero-LLM: top-3 oldest-waiting items, one line each (prazo
// if the triager found one, else how long it's been waiting), "+N" for the
// rest. Same shape every time — the whole point is that it's decidable from
// the lock screen alone.
function buildDigestText(items: DigestItem[], filteredCount: number): { title: string; body: string } {
  const sorted = [...items].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const top3 = sorted.slice(0, 3);
  const rest = sorted.length - top3.length;

  const parts = top3.map((m) => {
    const name = displayName({ chat: m.chat, sender: m.sender });
    return m.triagePrazo ? `${name}: prazo ${m.triagePrazo}` : `${name} esperando há ${waitingLabel(m.occurredAt)}`;
  });
  if (rest > 0) parts.push(`+${rest}`);

  return {
    title: `${items.length} conversa${items.length === 1 ? "" : "s"} esperando · ${filteredCount} filtradas`,
    body: parts.join(" · "),
  };
}

export async function handleDigest(payload: { scheduledFor: string }): Promise<void> {
  const scheduledFor = new Date(payload.scheduledFor);

  const digest = await prisma.digest.upsert({
    where: { scheduledFor },
    create: { scheduledFor, windowLabel: formatWindowLabel(scheduledFor) },
    update: {},
  });

  // Idempotency guard #2 (beyond the job's own uniqueKey) — a zombie-requeued
  // digest job that actually already completed shouldn't double-send.
  if (digest.sentAt || digest.pushSkipped) return;

  const lastDigest = await prisma.digest.findFirst({
    where: { scheduledFor: { lt: scheduledFor } },
    orderBy: { scheduledFor: "desc" },
  });

  await prisma.message.updateMany({
    where: { direction: "IN", triageNivel: { in: ["digest", "agora"] }, queueState: null },
    data: { queueState: "QUEUED", digestId: digest.id },
  });

  const [shownItems, filteredCount] = await Promise.all([
    prisma.message.findMany({
      where: {
        OR: [{ queueState: "QUEUED" }, { queueState: "SNOOZED", snoozedUntil: { lte: new Date() } }],
      },
      include: { chat: true, sender: true },
      orderBy: { occurredAt: "asc" },
    }),
    prisma.message.count({
      where: { triageNivel: "ignorar", triagedAt: { gt: lastDigest?.createdAt ?? new Date(0) } },
    }),
  ]);

  if (shownItems.length === 0) {
    await prisma.digest.update({
      where: { id: digest.id },
      data: { pushSkipped: true, filteredCount, shownCount: 0 },
    });
    return;
  }

  const { title, body } = buildDigestText(shownItems, filteredCount);
  await sendPush({ kind: "digest", title, body, url: "/fila", tag: "digest" });

  await prisma.digest.update({
    where: { id: digest.id },
    data: { sentAt: new Date(), shownCount: shownItems.length, filteredCount },
  });

  await prewarmDrafts(shownItems);
}

async function prewarmDrafts(items: DigestItem[]): Promise<void> {
  const candidates = items.filter((m) => m.triagePrecisaResposta);
  if (candidates.length === 0) return;

  const existing = await prisma.replyDraft.findMany({
    where: { messageId: { in: candidates.map((m) => m.id) }, status: { in: [...ACTIVE_DRAFT_STATUSES] } },
    select: { messageId: true },
  });
  const hasDraft = new Set(existing.map((d) => d.messageId));

  for (const m of candidates) {
    if (hasDraft.has(m.id)) continue;
    try {
      await enqueue("draft", { messageId: m.id }, { uniqueKey: `draft:${m.id}` });
    } catch (error) {
      console.error("[jobs] falha ao pré-aquecer rascunho", error);
    }
  }
}
