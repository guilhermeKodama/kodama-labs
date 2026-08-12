import { prisma } from "@/server/lib/prisma";
import { triggerBeaconNow, startFocusWindow, endFocusWindow } from "./actions";

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

export default async function LabPage() {
  const [focusWindows, beacons, deadSubs, liveSubs] = await Promise.all([
    prisma.focusWindow.findMany({ orderBy: { startsAt: "desc" } }),
    prisma.beacon.findMany({ orderBy: { sentAt: "desc" }, include: { subscription: true } }),
    prisma.pushSubscription.findMany({
      where: { deadAt: { not: null } },
      orderBy: { deadAt: "desc" },
    }),
    prisma.pushSubscription.findMany({ where: { deadAt: null }, orderBy: { createdAt: "desc" } }),
  ]);

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
