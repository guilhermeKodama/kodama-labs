"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { sankey, sankeyJustify, sankeyLinkHorizontal, type SankeyLink as D3Link, type SankeyNode as D3Node } from "d3-sankey";
import { useTranslations } from "next-intl";
import type { ViewConfig } from "@capital/server/modules/ledger/contracts";
import type { LedgerFlowsResult } from "@capital/server/modules/ledger/services/flows";
import { EmptyRow } from "@/components/cap";
import { apiPost } from "@/lib/api/client";
import { keys } from "@/lib/api/keys";
import type { Names } from "@/lib/api/catalog";
import { useFmt } from "@/lib/format/provider";
import type { DrillCell } from "@/lib/ledger/drill";
import { expandOthers, type SankeyNode } from "@/lib/ledger/sankey";
import { flowsQuery } from "@/lib/ledger/view-query";
import { CHART } from "@/lib/theme/chart-colors";

const HEIGHT = 440;
type Node = SankeyNode & { name: string };
type Link = { source: number; target: number; value: number };

/** Node color by role: income in the accent, entities in ink, outputs muted, surplus in the accent again. */
function nodeColor(node: SankeyNode): string {
  switch (node.kind) {
    case "category":
    case "reserves":
    case "prior_balance":
    case "transfer_in":
      return CHART.accent;
    case "business":
    case "personal":
      return CHART.bar;
    case "surplus":
      return CHART.accent;
    default:
      return CHART.muted;
  }
}

/**
 * The cash-flow sankey (decision sankey=v1): receita → PJ → PF →
 * categorias, investimentos and sobra, from POST /v2/ledger/flows over the
 * view's selection. "Outros" opens its small categories; a category or
 * entity node opens the table with that slice.
 */
export function SankeyView({
  config,
  search,
  names,
  rangeLabel,
  onDrill,
}: {
  config: ViewConfig;
  search: string | null;
  names: Names;
  rangeLabel: string;
  onDrill: (cells: DrillCell[]) => void;
}) {
  const t = useTranslations("ledger.sankey");
  const fmt = useFmt();
  const body = flowsQuery(config, search);
  const flows = useQuery({
    queryKey: keys.ledgerFlows(body),
    queryFn: () => apiPost<LedgerFlowsResult>("/api/v2/ledger/flows", body),
    placeholderData: (previous) => previous,
  });
  const [expanded, setExpanded] = useState(false);
  const [width, setWidth] = useState(0);
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!box) return;
    const observer = new ResizeObserver((entries) => setWidth(entries[0]?.contentRect.width ?? 0));
    observer.observe(box);
    return () => observer.disconnect();
  }, [box]);

  const nameOf = (node: SankeyNode): string => {
    const entity = node.entityId ? (names.entity.get(node.entityId) ?? "—") : "";
    switch (node.kind) {
      case "category":
      case "expense":
        return node.categoryId ? (names.category.get(node.categoryId) ?? t("uncategorized")) : t("uncategorized");
      case "business":
      case "personal":
        return entity;
      case "investment":
        return t("investments");
      case "surplus":
        return t("surplus", { entity });
      case "others":
        return t("others");
      case "reserves":
        return t("reserves");
      case "prior_balance":
        return t("priorBalance");
      case "transfer_in":
        return t("transferIn", { entity });
      case "transfer_out":
        return t("transferOut", { entity });
    }
  };

  const data = flows.data;
  const layout = useMemo(() => {
    if (!data || !data.links.length || width <= 0) return null;
    const graph = expanded ? expandOthers(data) : data;
    const generator = sankey<Node, Link>()
      .nodeWidth(10)
      .nodePadding(12)
      .nodeAlign(sankeyJustify)
      .extent([
        [1, 8],
        [Math.max(360, width) - 1, HEIGHT - 8],
      ]);
    return generator({
      nodes: graph.nodes.map((n) => ({ ...n, name: "" })),
      links: graph.links.filter((l) => l.value > 0).map((l) => ({ ...l })),
    });
  }, [data, expanded, width]);

  const click = (node: SankeyNode) => {
    if (node.kind === "others") return setExpanded(true);
    if (node.kind === "category" || node.kind === "expense") {
      if (expanded && node.kind === "expense" && data?.nodes.find((n) => n.kind === "others")?.subItems?.some((s) => s.categoryId === node.categoryId)) {
        return setExpanded(false);
      }
      return onDrill([{ key: { field: "categoryId" }, value: node.categoryId }]);
    }
    if ((node.kind === "business" || node.kind === "personal") && node.entityId) return onDrill([{ key: { field: "entityId" }, value: node.entityId }]);
    if (node.kind === "investment") return onDrill([{ key: { field: "flowKind" }, value: "invest" }]);
  };

  const hasOthers = !!data?.nodes.some((n) => n.kind === "others");
  const path = sankeyLinkHorizontal();
  return (
    <div className="flex flex-col gap-2">
      <div ref={setBox} className="w-full" style={{ minHeight: HEIGHT }}>
        {data && !data.links.length ? (
          <EmptyRow className="border-t-0">{t("empty")}</EmptyRow>
        ) : layout ? (
          <svg viewBox={`0 0 ${Math.max(360, width)} ${HEIGHT}`} className="w-full" style={{ height: HEIGHT }}>
            {layout.links.map((link: D3Link<Node, Link>, i: number) => {
              const source = link.source as D3Node<Node, Link>;
              const target = link.target as D3Node<Node, Link>;
              return (
                <path key={i} d={path(link) ?? ""} fill="none" stroke={CHART.muted} strokeOpacity={0.35} strokeWidth={Math.max(1, link.width ?? 1)}>
                  <title>{`${nameOf(source)} → ${nameOf(target)} · ${fmt.money0(link.value)}`}</title>
                </path>
              );
            })}
            {layout.nodes.map((node: D3Node<Node, Link>, i: number) => {
              const x0 = node.x0 ?? 0;
              const x1 = node.x1 ?? 0;
              const y0 = node.y0 ?? 0;
              const y1 = node.y1 ?? 0;
              const left = x0 < Math.max(360, width) / 2;
              const clickable = node.kind !== "surplus" && node.kind !== "reserves" && node.kind !== "prior_balance" && node.kind !== "transfer_in" && node.kind !== "transfer_out";
              return (
                <g key={i} onClick={clickable ? () => click(node) : undefined} className={clickable ? "cursor-pointer" : undefined}>
                  <rect x={x0} y={y0} width={x1 - x0} height={Math.max(1, y1 - y0)} rx={2} fill={nodeColor(node)} />
                  <text x={left ? x1 + 6 : x0 - 6} y={(y0 + y1) / 2} dy="0.35em" textAnchor={left ? "start" : "end"} fontSize={11} fill={CHART.label}>
                    {`${nameOf(node)} · ${fmt.money0(node.value ?? 0)}`}
                  </text>
                  <title>{`${nameOf(node)} · ${fmt.money0(node.value ?? 0)}`}</title>
                </g>
              );
            })}
          </svg>
        ) : null}
      </div>
      {data ? (
        <span className="text-[12px] text-fg-4">
          {t("caption", {
            income: fmt.money0(data.totals.income),
            expenses: fmt.money0(data.totals.expenses),
            investments: fmt.money0(data.totals.investments),
            surplus: fmt.money0(data.totals.surplus),
            period: rangeLabel,
          })}
          {hasOthers ? ` · ${expanded ? t("collapseOthers") : t("expandOthers")}` : ""}
        </span>
      ) : null}
    </div>
  );
}
