import { toDataURL } from "qrcode";
import { prisma } from "@/server/lib/prisma";
import { spTodayStart } from "@/server/lib/timezone";
import { QrAutoRefresh } from "@/components/qr-auto-refresh";
import {
  triggerBeaconNow,
  startFocusWindow,
  endFocusWindow,
  dispararDigestAgora,
  testarEnvioSelfChat,
  triarUltimosDias,
} from "./actions";

export const dynamic = "force-dynamic";

function percentile(sortedMs: number[], p: number): number | null {
  if (sortedMs.length === 0) return null;
  const idx = Math.min(sortedMs.length - 1, Math.floor((p / 100) * sortedMs.length));
  return sortedMs[idx];
}

function pct(n: number, total: number): string {
  if (total === 0) return "—";
  return `${Math.round((n / total) * 100)}%`;
}

function fmtMs(ms: number | null): string {
  if (ms === null) return "—";
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtDate(d: Date): string {
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" });
}

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

function timeAgo(d: Date): string {
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60_000);
  if (diffMin < 1) return "agora";
  if (diffMin < 60) return `há ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `há ${diffH}h`;
  return `há ${Math.floor(diffH / 24)}d`;
}

export default async function LabPage() {
  const since24h = hoursAgo(24);

  const [
    focusWindows,
    beacons,
    deadSubs,
    liveSubs,
    waStatus,
    waMessagesIn24h,
    waMessagesOut24h,
    waChatCount,
    waContactCount,
    waMessages,
    llmStatsToday,
    llmErrors24h,
    failedJobsCount,
    lastDigest,
  ] = await Promise.all([
    prisma.focusWindow.findMany({ orderBy: { startsAt: "desc" } }),
    prisma.beacon.findMany({ orderBy: { sentAt: "desc" }, include: { subscription: true } }),
    prisma.pushSubscription.findMany({
      where: { deadAt: { not: null } },
      orderBy: { deadAt: "desc" },
    }),
    prisma.pushSubscription.findMany({ where: { deadAt: null }, orderBy: { createdAt: "desc" } }),
    prisma.integrationStatus.findUnique({ where: { channel: "whatsapp" } }),
    prisma.message.count({ where: { direction: "IN", occurredAt: { gte: since24h } } }),
    prisma.message.count({ where: { direction: "OUT", occurredAt: { gte: since24h } } }),
    prisma.chat.count(),
    prisma.contact.count(),
    prisma.message.findMany({
      orderBy: { occurredAt: "desc" },
      take: 50,
      include: { chat: true, sender: true },
    }),
    prisma.llmCall.aggregate({
      where: { createdAt: { gte: spTodayStart() } },
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true },
      _avg: { durationMs: true },
    }),
    prisma.llmCall.count({ where: { error: { not: null }, createdAt: { gte: since24h } } }),
    prisma.job.count({ where: { status: "FAILED" } }),
    prisma.digest.findFirst({ orderBy: { scheduledFor: "desc" } }),
  ]);

  const waQrDataUrl = waStatus?.qrPayload ? await toDataURL(waStatus.qrPayload) : null;

  const sent = beacons.length;
  const received = beacons.filter((b) => b.receivedAt).length;
  const acked = beacons.filter((b) => b.ackedAt).length;
  const latencies = beacons
    .filter((b) => b.receivedAt)
    .map((b) => b.receivedAt!.getTime() - b.sentAt.getTime())
    .sort((a, b) => a - b);

  const stats = [
    { label: "Enviados", value: String(sent) },
    { label: "Recebidos", value: `${received} (${pct(received, sent)})` },
    { label: "Confirmados", value: `${acked} (${pct(acked, sent)})` },
    { label: "Latência p50", value: fmtMs(percentile(latencies, 50)) },
    { label: "Latência p95", value: fmtMs(percentile(latencies, 95)) },
  ];

  const focusBreakdown = focusWindows.map((fw) => {
    const inWindow = beacons.filter(
      (b) => b.sentAt >= fw.startsAt && (!fw.endsAt || b.sentAt <= fw.endsAt)
    );
    return {
      ...fw,
      sent: inWindow.length,
      received: inWindow.filter((b) => b.receivedAt).length,
    };
  });

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-5 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-medium">Lab</h1>
        <form action={triggerBeaconNow}>
          <button className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm">
            Disparar beacon agora
          </button>
        </form>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-medium">WhatsApp</h2>
        {waStatus?.state === "NEEDS_QR" && <QrAutoRefresh />}
        <div className="rounded-lg bg-neutral-900 p-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <p>
              <span className="text-neutral-400">Estado</span>{" "}
              <span className="font-medium">{waStatus?.state ?? "não iniciado"}</span>
            </p>
            <p>
              <span className="text-neutral-400">Última mensagem</span>{" "}
              {waStatus?.lastMessageAt ? timeAgo(waStatus.lastMessageAt) : "—"}
            </p>
            <p>
              <span className="text-neutral-400">Sessão desde</span>{" "}
              {waStatus?.sessionStartedAt ? fmtDate(waStatus.sessionStartedAt) : "—"}
            </p>
          </div>
          {waStatus?.lastError && (
            <p className="mt-2 text-sm text-red-400">Erro: {waStatus.lastError}</p>
          )}
          {waQrDataUrl && (
            <div className="mt-4 flex flex-col items-start gap-2">
              <p className="text-sm text-neutral-400">
                Escaneie com WhatsApp → Aparelhos conectados (o código atualiza sozinho):
              </p>
              {/* eslint-disable-next-line @next/next/no-img-element -- data URL, sem otimização de imagem aplicável */}
              <img src={waQrDataUrl} alt="QR code do WhatsApp" width={200} height={200} />
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg bg-neutral-900 p-4">
            <p className="text-xs text-neutral-400">Mensagens 24h (recebidas)</p>
            <p className="mt-1 text-lg font-medium">{waMessagesIn24h}</p>
          </div>
          <div className="rounded-lg bg-neutral-900 p-4">
            <p className="text-xs text-neutral-400">Mensagens 24h (enviadas)</p>
            <p className="mt-1 text-lg font-medium">{waMessagesOut24h}</p>
          </div>
          <div className="rounded-lg bg-neutral-900 p-4">
            <p className="text-xs text-neutral-400">Chats</p>
            <p className="mt-1 text-lg font-medium">{waChatCount}</p>
          </div>
          <div className="rounded-lg bg-neutral-900 p-4">
            <p className="text-xs text-neutral-400">Contatos</p>
            <p className="mt-1 text-lg font-medium">{waContactCount}</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-neutral-400">
              <tr>
                <th className="py-1.5 pr-3 font-normal">Hora</th>
                <th className="py-1.5 pr-3 font-normal">Chat</th>
                <th className="py-1.5 pr-3 font-normal">Remetente</th>
                <th className="py-1.5 pr-3 font-normal">Direção</th>
                <th className="py-1.5 pr-3 font-normal">Mensagem</th>
                <th className="py-1.5 pr-3 font-normal">Nível</th>
                <th className="py-1.5 font-normal">Resumo</th>
              </tr>
            </thead>
            <tbody>
              {waMessages.map((m) => (
                <tr key={m.id} className="border-t border-neutral-800">
                  <td className="py-1.5 pr-3 text-neutral-400">{fmtDate(m.occurredAt)}</td>
                  <td className="py-1.5 pr-3">{m.chat.name ?? m.chat.waChatId}</td>
                  <td className="py-1.5 pr-3">
                    {m.direction === "OUT" ? "você" : (m.sender?.name ?? m.sender?.pushname ?? "—")}
                  </td>
                  <td className="py-1.5 pr-3">{m.direction}</td>
                  <td className="py-1.5 pr-3 text-neutral-300">{m.body ?? "[expirada]"}</td>
                  <td className="py-1.5 pr-3">{m.triageNivel ?? "—"}</td>
                  <td className="py-1.5 text-neutral-300">{m.triageResumo ?? "—"}</td>
                </tr>
              ))}
              {waMessages.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-3 text-neutral-500">
                    Nenhuma mensagem ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-medium">Curadoria</h2>
          <a href="/fila" className="text-sm text-neutral-400 underline underline-offset-2">
            ver fila →
          </a>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg bg-neutral-900 p-4">
            <p className="text-xs text-neutral-400">Triagens hoje</p>
            <p className="mt-1 text-lg font-medium">{llmStatsToday._count._all}</p>
          </div>
          <div className="rounded-lg bg-neutral-900 p-4">
            <p className="text-xs text-neutral-400">Latência média</p>
            <p className="mt-1 text-lg font-medium">{fmtMs(llmStatsToday._avg.durationMs)}</p>
          </div>
          <div className="rounded-lg bg-neutral-900 p-4">
            <p className="text-xs text-neutral-400">Erros de LLM (24h)</p>
            <p className="mt-1 text-lg font-medium">{llmErrors24h}</p>
          </div>
          <div className="rounded-lg bg-neutral-900 p-4">
            <p className="text-xs text-neutral-400">Jobs falhados</p>
            <p className="mt-1 text-lg font-medium">{failedJobsCount}</p>
          </div>
        </div>
        <div className="rounded-lg bg-neutral-900 p-4 text-sm">
          {lastDigest ? (
            <p>
              <span className="text-neutral-400">Último digest</span>{" "}
              <span className="font-medium">{lastDigest.windowLabel}</span>{" "}
              {lastDigest.pushSkipped ? (
                <span className="text-neutral-400">(fila vazia, sem push)</span>
              ) : (
                <span className="text-neutral-400">
                  {lastDigest.shownCount} mostradas · {lastDigest.filteredCount} filtradas
                  {lastDigest.sentAt ? ` · ${fmtDate(lastDigest.sentAt)}` : ""}
                </span>
              )}
            </p>
          ) : (
            <p className="text-neutral-400">Nenhum digest rodou ainda.</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <form action={dispararDigestAgora}>
            <button className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm">
              Disparar digest agora
            </button>
          </form>
          <form action={testarEnvioSelfChat}>
            <button className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm">
              Teste de envio (self-chat)
            </button>
          </form>
          <form action={triarUltimosDias}>
            <button className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm">
              Triar últimos 3 dias
            </button>
          </form>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg bg-neutral-900 p-4">
            <p className="text-xs text-neutral-400">{s.label}</p>
            <p className="mt-1 text-lg font-medium">{s.value}</p>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-medium">Janelas de Foco</h2>
        <form action={startFocusWindow} className="flex gap-2">
          <input
            name="label"
            placeholder="ex: Foco Sono"
            required
            className="flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm"
          />
          <button className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm">
            Iniciar
          </button>
        </form>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-neutral-400">
              <tr>
                <th className="py-1.5 pr-3 font-normal">Label</th>
                <th className="py-1.5 pr-3 font-normal">Início</th>
                <th className="py-1.5 pr-3 font-normal">Fim</th>
                <th className="py-1.5 pr-3 font-normal">Enviados</th>
                <th className="py-1.5 pr-3 font-normal">Recebidos</th>
                <th className="py-1.5 font-normal" />
              </tr>
            </thead>
            <tbody>
              {focusBreakdown.map((fw) => (
                <tr key={fw.id} className="border-t border-neutral-800">
                  <td className="py-1.5 pr-3">{fw.label}</td>
                  <td className="py-1.5 pr-3 text-neutral-400">{fmtDate(fw.startsAt)}</td>
                  <td className="py-1.5 pr-3 text-neutral-400">
                    {fw.endsAt ? fmtDate(fw.endsAt) : "em curso"}
                  </td>
                  <td className="py-1.5 pr-3">{fw.sent}</td>
                  <td className="py-1.5 pr-3">
                    {fw.received} ({pct(fw.received, fw.sent)})
                  </td>
                  <td className="py-1.5">
                    {!fw.endsAt && (
                      <form action={endFocusWindow}>
                        <input type="hidden" name="id" value={fw.id} />
                        <button className="text-xs text-neutral-400 underline underline-offset-2">
                          encerrar
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
              {focusBreakdown.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-3 text-neutral-500">
                    Nenhuma janela registrada ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-medium">Subscriptions</h2>
        <p className="text-sm text-neutral-400">
          {liveSubs.length} viva{liveSubs.length === 1 ? "" : "s"}, {deadSubs.length} morta
          {deadSubs.length === 1 ? "" : "s"}
        </p>
        {deadSubs.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead className="text-neutral-400">
              <tr>
                <th className="py-1.5 pr-3 font-normal">Dispositivo</th>
                <th className="py-1.5 font-normal">Morreu em</th>
              </tr>
            </thead>
            <tbody>
              {deadSubs.map((s) => (
                <tr key={s.id} className="border-t border-neutral-800">
                  <td className="py-1.5 pr-3">{s.deviceLabel ?? "desconhecido"}</td>
                  <td className="py-1.5 text-neutral-400">
                    {s.deadAt ? fmtDate(s.deadAt) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-medium">Últimos beacons</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-neutral-400">
              <tr>
                <th className="py-1.5 pr-3 font-normal">Enviado</th>
                <th className="py-1.5 pr-3 font-normal">Dispositivo</th>
                <th className="py-1.5 pr-3 font-normal">Recebido</th>
                <th className="py-1.5 pr-3 font-normal">Confirmado</th>
                <th className="py-1.5 font-normal">Erro</th>
              </tr>
            </thead>
            <tbody>
              {beacons.slice(0, 50).map((b) => (
                <tr key={b.id} className="border-t border-neutral-800">
                  <td className="py-1.5 pr-3 text-neutral-400">{fmtDate(b.sentAt)}</td>
                  <td className="py-1.5 pr-3">{b.subscription.deviceLabel ?? "—"}</td>
                  <td className="py-1.5 pr-3">
                    {b.receivedAt ? fmtMs(b.receivedAt.getTime() - b.sentAt.getTime()) : "—"}
                  </td>
                  <td className="py-1.5 pr-3">{b.ackedAt ? "sim" : "—"}</td>
                  <td className="py-1.5 text-red-400">{b.sendError ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
