import { prisma } from "@/server/lib/prisma";
import { displayName } from "@/server/lib/display-name";
import { FilaAutoRefresh } from "@/components/fila-auto-refresh";
import { aprovarEnviar, desfazer, editarDraft, regenerarDraft, adiar, naoImportante } from "./actions";
import type { Chat, Contact, Message, ReplyDraft, Job } from "@/generated/prisma";

export const dynamic = "force-dynamic";

function waitingLabel(occurredAt: Date, now: Date): string {
  const hours = Math.floor((now.getTime() - occurredAt.getTime()) / (60 * 60 * 1000));
  if (hours < 1) return "poucos minutos";
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

type QueueMessage = Message & {
  chat: Chat;
  sender: Contact | null;
  drafts: ReplyDraft[];
};

export default async function FilaPage() {
  const now = new Date();

  const [items, lastDigest] = await Promise.all([
    prisma.message.findMany({
      where: {
        OR: [{ queueState: "QUEUED" }, { queueState: "SNOOZED", snoozedUntil: { lte: now } }],
      },
      include: { chat: true, sender: true, drafts: { orderBy: { createdAt: "desc" }, take: 1 } },
      orderBy: { occurredAt: "asc" },
    }),
    prisma.digest.findFirst({ orderBy: { scheduledFor: "desc" } }),
  ]);

  const approvedDraftIds = items
    .map((m) => m.drafts[0])
    .filter((d): d is ReplyDraft => !!d && d.status === "APPROVED")
    .map((d) => d.id);

  const sendJobs = approvedDraftIds.length
    ? await prisma.job.findMany({
        where: { type: "send", uniqueKey: { in: approvedDraftIds.map((id) => `send:${id}`) } },
      })
    : [];
  const sendJobByDraftId = new Map(sendJobs.map((j) => [j.uniqueKey!.slice("send:".length), j]));

  const filteredCount = lastDigest?.filteredCount ?? 0;

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-4 px-4 py-6">
      <FilaAutoRefresh badgeCount={items.length} />
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-medium">Fila</h1>
        <p className="text-sm text-neutral-400">
          {items.length} na fila · {filteredCount} filtradas
        </p>
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg bg-neutral-900 p-8 text-center">
          <p className="text-base font-medium">Fila zerada</p>
          <p className="mt-1 text-sm text-neutral-400">Nada esperando você.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((m) => (
            <QueueCard
              key={m.id}
              message={m}
              draft={m.drafts[0] ?? null}
              sendJob={m.drafts[0] ? (sendJobByDraftId.get(m.drafts[0].id) ?? null) : null}
              now={now}
            />
          ))}
        </div>
      )}
    </main>
  );
}

function QueueCard({
  message,
  draft,
  sendJob,
  now,
}: {
  message: QueueMessage;
  draft: ReplyDraft | null;
  sendJob: Job | null;
  now: Date;
}) {
  const name = displayName({ chat: message.chat, sender: message.sender });
  const initial = name.charAt(0).toUpperCase();
  const summary = message.triageResumo ?? message.body?.slice(0, 90) ?? "[mídia]";

  const isSending = draft?.status === "APPROVED" && sendJob?.status === "QUEUED";
  const secondsLeft =
    isSending && sendJob ? Math.max(0, Math.round((sendJob.runAt.getTime() - now.getTime()) / 1000)) : null;

  const showSuggestionBox = !!draft || !!message.triagePrecisaResposta;

  return (
    <div className="rounded-lg bg-neutral-900 p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-800 text-sm font-medium">
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="font-medium">{name}</p>
            <span className="text-xs text-neutral-400">esperando há {waitingLabel(message.occurredAt, now)}</span>
            {message.triagePrazo && (
              <span className="rounded bg-amber-950 px-1.5 py-0.5 text-xs text-amber-400">
                prazo: {message.triagePrazo}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-neutral-300">{summary}</p>

          {isSending ? (
            <div className="mt-3 flex items-center justify-between gap-2 rounded-md bg-neutral-800 px-3 py-2 text-sm">
              <span>
                Enviando para {name} em {secondsLeft}s
              </span>
              <form action={desfazer}>
                <input type="hidden" name="draftId" value={draft!.id} />
                <button className="font-medium text-amber-400 underline underline-offset-2">Desfazer</button>
              </form>
            </div>
          ) : (
            <>
              {showSuggestionBox && (
                <div className="mt-3 rounded-md bg-neutral-800 p-3">
                  {draft ? (
                    <p className="text-sm whitespace-pre-wrap">{draft.text}</p>
                  ) : (
                    <p className="text-sm text-neutral-500">Gerando sugestão...</p>
                  )}
                </div>
              )}

              <div className="mt-3 flex flex-wrap gap-2 text-sm">
                {draft && (
                  <form action={aprovarEnviar}>
                    <input type="hidden" name="draftId" value={draft.id} />
                    <button className="rounded-md bg-neutral-100 px-3 py-1.5 font-medium text-neutral-900">
                      Enviar
                    </button>
                  </form>
                )}
                {draft && (
                  <details className="inline-block">
                    <summary className="cursor-pointer list-none rounded-md border border-neutral-700 px-3 py-1.5">
                      Editar
                    </summary>
                    <form action={editarDraft} className="mt-2 flex flex-col gap-2">
                      <input type="hidden" name="draftId" value={draft.id} />
                      <textarea
                        name="texto"
                        defaultValue={draft.text}
                        rows={3}
                        className="w-full rounded-md border border-neutral-700 bg-neutral-950 p-2 text-sm"
                      />
                      <button className="self-start rounded-md border border-neutral-700 px-3 py-1.5 text-sm">
                        Salvar
                      </button>
                    </form>
                  </details>
                )}
                {showSuggestionBox && (
                  <form action={regenerarDraft}>
                    <input type="hidden" name="messageId" value={message.id} />
                    {draft && <input type="hidden" name="draftId" value={draft.id} />}
                    <button className="rounded-md border border-neutral-700 px-3 py-1.5">Regenerar</button>
                  </form>
                )}
                <form action={adiar}>
                  <input type="hidden" name="messageId" value={message.id} />
                  <input type="hidden" name="mode" value="3h" />
                  <button className="rounded-md border border-neutral-700 px-3 py-1.5">Adiar 3h</button>
                </form>
                <form action={adiar}>
                  <input type="hidden" name="messageId" value={message.id} />
                  <input type="hidden" name="mode" value="tomorrow" />
                  <button className="rounded-md border border-neutral-700 px-3 py-1.5">Amanhã 8h</button>
                </form>
                <form action={naoImportante}>
                  <input type="hidden" name="messageId" value={message.id} />
                  <button className="rounded-md border border-neutral-700 px-3 py-1.5 text-neutral-400">
                    Não é importante
                  </button>
                </form>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
