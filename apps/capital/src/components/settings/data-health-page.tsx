"use client";

import { useTranslations } from "next-intl";
import { Badge, KpiStrip, Kpi, Table, type TableRowTone } from "@/components/cap";
import { useMarketDataHealth, type JobHealth } from "@/lib/api/market-data-health";
import { ASSET_CLASSES } from "@/lib/invest/types";
import { useFmt } from "@/lib/format/provider";

const JOB_TONE: Record<JobHealth["status"], TableRowTone> = { ok: "success", degraded: "warning", down: "danger" };

/**
 * Ajustes › Dados › Saúde dos dados (mockup data-health panel): the same
 * GET /health/market-data Uptime Kuma polls, read straight — no
 * "sincronizar agora" here, that's the Carteira screen's "Atualizar
 * cotações" button (POST /v2/holdings/refresh-prices).
 */
export function DataHealthPage() {
  const t = useTranslations("settings.dataHealth");
  const tClass = useTranslations("invest");
  const fmt = useFmt();
  const health = useMarketDataHealth();
  const data = health.data;

  if (health.isError) return <span className="text-body-sm text-neg">{t("loadError")}</span>;

  const jobRows = (data?.jobs ?? []).map((job) => [
    t(`job.${job.job}`),
    t(`status.${job.status}`),
    job.lastRunAt ? fmt.relative(job.lastRunAt) : t("never"),
    job.lastRunStatus ? t(`runStatus.${job.lastRunStatus}`) : "—",
  ]);

  const classRows = ASSET_CLASSES.map((assetClass) => {
    const c = data?.holdings.byAssetClass[assetClass];
    return [
      tClass(`assetClass.${assetClass}`),
      c?.activeProvider ? t(`source.${c.activeProvider}`) : t("noSource"),
      c?.priceable ?? 0,
      c?.fresh ?? 0,
      c?.stale ?? 0,
      c?.unsupported ?? 0,
    ];
  });

  return (
    <div className="flex flex-col gap-4">
      <KpiStrip>
        <Kpi label={t("kpi.status")} value={data ? t(`status.${data.status}`) : "—"} tone={data?.status === "ok" ? "pos" : data?.status === "down" ? "neg" : data ? "warn" : undefined} />
        <Kpi label={t("kpi.priceable")} value={data ? `${data.holdings.priceable}/${data.holdings.total}` : "—"} />
        <Kpi label={t("kpi.stale")} value={data?.holdings.stale ?? "—"} tone={data && data.holdings.stale > 0 ? "warn" : undefined} />
        <Kpi label={t("kpi.oldest")} value={data?.holdings.oldestPriceAt ? fmt.relative(data.holdings.oldestPriceAt) : t("never")} />
      </KpiStrip>

      <div className="flex flex-col gap-2">
        <h2 className="text-body-sm font-medium text-fg-2">{t("jobsTitle")}</h2>
        <Table
          headers={[t("jobsHeaders.job"), t("jobsHeaders.status"), t("jobsHeaders.last"), t("jobsHeaders.lastStatus")]}
          columnAlign={["left", "left", "left", "left"]}
          rowTone={(data?.jobs ?? []).map((j) => JOB_TONE[j.status])}
          rowKey={(i) => data!.jobs[i]!.job}
          emptyMessage={health.isSuccess ? t("jobsEmpty") : undefined}
          rows={jobRows}
        />
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-body-sm font-medium text-fg-2">{t("classesTitle")}</h2>
        <Table
          headers={[t("classesHeaders.class"), t("classesHeaders.source"), t("classesHeaders.priceable"), t("classesHeaders.fresh"), t("classesHeaders.stale"), t("classesHeaders.unsupported")]}
          columnAlign={["left", "left", "right", "right", "right", "right"]}
          rowKey={(i) => ASSET_CLASSES[i]!}
          rows={classRows}
        />
      </div>

      {data && data.holdings.stale > 0 ? (
        <Badge tone="warn">{t("staleBadge", { count: data.holdings.stale, hours: data.holdings.staleAfterHours })}</Badge>
      ) : null}
    </div>
  );
}
