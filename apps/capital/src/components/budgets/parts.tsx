"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Badge, Menu, MenuItem, MenuSep, Segmented } from "@/components/cap";
import { Link } from "@/i18n/navigation";
import { useSession } from "@/lib/api/session";
import type { PaceTone } from "@/lib/budgets/pace";
import type { BudgetsScope } from "@/lib/budgets/url";
import { buildTransactionsHref, type ViewDraft } from "@/lib/ledger/view-draft";
import { entityLabel } from "@/lib/pickers/options";
import { cn } from "@/lib/utils";
import type { EditableBudget } from "./budget-dialog";

/** Text color of a pace tone (mockup: category red / yellow, else tertiary). */
export const TONE_TEXT: Record<PaceTone, string> = { over: "text-cat-red", ahead: "text-cat-yellow", normal: "text-fg-3" };
const TONE_FILL: Record<PaceTone | "warn", string> = { over: "bg-cat-red", ahead: "bg-cat-yellow", warn: "bg-cat-yellow", normal: "bg-fg-2" };

/**
 * 6px bar of spent / budget with a 1px mark (today, or where the year
 * is). The fill only takes a color when something is wrong.
 */
export function PaceBar({ ratio, tone, marker, label }: { ratio: number; tone: PaceTone | "warn"; marker: number | null; label?: string }) {
  const width = Math.min(1, Math.max(0, Number.isFinite(ratio) ? ratio : 0)) * 100;
  return (
    <span role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(width)} className="relative h-1.5 min-w-0 flex-1 rounded-[3px] bg-fill-3">
      <span className={cn("absolute inset-y-0 left-0 rounded-[3px]", TONE_FILL[tone])} style={{ width: `${width}%` }} />
      {marker !== null ? <span className="absolute -top-[3px] h-3 w-px bg-fg-1" style={{ left: `${Math.min(1, Math.max(0, marker)) * 100}%` }} /> : null}
    </span>
  );
}

/** A number that opens Transações filtered to the entries behind it ("todo número leva à tabela filtrada"). */
export function DrillLink({ draft, className, children, title }: { draft: ViewDraft | null; className?: string; children: ReactNode; title?: string }) {
  if (!draft) return <span className={className}>{children}</span>;
  return (
    <Link href={buildTransactionsHref({ draft })} title={title} className={cn("outline-none hover:underline focus-visible:underline", className)}>
      {children}
    </Link>
  );
}

/** Entity of a budget or bill (PF, the company's name); "Todas" for a budget for every entity. */
export function EntityBadge({ entityId, names }: { entityId: string | null; names: ReadonlyMap<string, string> }) {
  const t = useTranslations("budgets");
  return <Badge className="shrink-0">{entityId ? (names.get(entityId) ?? "—") : t("dialog.allEntities")}</Badge>;
}

/** Id → label (PF or the company's name) of the session's entities. */
export function useEntityNames(): { names: Map<string, string>; hasBusiness: boolean; personalId: string | null; businessIds: string[] } {
  const entities = useSession().data?.entities ?? [];
  return {
    names: new Map(entities.map((entity) => [entity.id, entityLabel(entity)])),
    hasBusiness: entities.some((entity) => entity.kind === "business"),
    personalId: entities.find((entity) => entity.kind === "personal")?.id ?? null,
    businessIds: entities.filter((entity) => entity.kind === "business").map((entity) => entity.id),
  };
}

/** First row of both views: Todas / PF / PJ, then the period text on the right. */
export function ScopeBar({ scope, onScope, children }: { scope: BudgetsScope; onScope: (scope: BudgetsScope) => void; children?: ReactNode }) {
  const t = useTranslations("budgets");
  const { names, hasBusiness } = useEntityNames();
  const options: { v: BudgetsScope; l: string }[] = [
    { v: "all", l: t("scope.all") },
    { v: "pf", l: t("scope.pf") },
    ...(hasBusiness || scope === "pj" ? [{ v: "pj", l: t("scope.pj") }] : []),
  ];
  // A link may scope to one entity (?scope=<id>): show it so the filter is visible.
  if (!["all", "pf", "pj"].includes(scope)) options.push({ v: scope, l: names.get(scope) ?? scope });
  return (
    <div className="flex min-h-[28px] flex-wrap items-center gap-2">
      <Segmented aria-label={t("scope.label")} value={scope} options={options} onChange={onScope} />
      <span className="ml-auto text-[12px] text-fg-3">{children}</span>
    </div>
  );
}

/** "‹ set/2026 ›" / "‹ 2026 ›" in the header. */
export function PeriodNav({ label, onPrev, onNext, prevLabel, nextLabel }: { label: string; onPrev: () => void; onNext: () => void; prevLabel: string; nextLabel: string }) {
  const arrow = "inline-flex h-full items-center px-1.5 text-fg-2 outline-none hover:text-fg-1 focus-visible:text-fg-1";
  return (
    <span className="inline-flex h-[26px] shrink-0 items-center rounded-[6px] border border-stroke-1 text-[12px] font-medium whitespace-nowrap">
      <button type="button" aria-label={prevLabel} title={prevLabel} onClick={onPrev} className={cn(arrow, "pl-2.5")}>
        ‹
      </button>
      <span className="px-0.5 tabular-nums">{label}</span>
      <button type="button" aria-label={nextLabel} title={nextLabel} onClick={onNext} className={cn(arrow, "pr-2.5")}>
        ›
      </button>
    </span>
  );
}

/** Series names under a chart: a short swatch (solid or dashed) and the name. */
export function ChartLegend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11px] text-fg-3">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          <svg width="14" height="8" aria-hidden className="shrink-0">
            <line x1="0" y1="4" x2="14" y2="4" stroke={item.color} strokeWidth="2" strokeDasharray={item.dashed ? "3 2" : undefined} />
          </svg>
          {item.label}
        </span>
      ))}
    </div>
  );
}

/** Caption under a chart ("Dia do mês × R$ mil · set/2026"). */
export function ChartCaption({ children }: { children: ReactNode }) {
  return <p className="mt-1.5 text-[12px] text-fg-4">{children}</p>;
}

/** Loading and error states in place of a view's body. */
export function ViewState({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  const t = useTranslations("common");
  if (!error) return <p className="text-[12.5px] text-fg-3">{t("loading")}</p>;
  return (
    <p className="flex items-center gap-2 text-[12.5px] text-fg-3">
      {error}
      <button type="button" className="font-medium text-fg-1 underline-offset-2 hover:underline" onClick={onRetry}>
        {t("retry")}
      </button>
    </p>
  );
}

export interface BudgetActions {
  onEdit: (budget: EditableBudget) => void;
  onDelete: (budget: EditableBudget) => void;
}

/** Recharts tooltip in the theme tokens. */
export const TOOLTIP_STYLE = {
  contentStyle: { background: "var(--cap-bg-editor)", border: "1px solid var(--cap-stroke-1)", borderRadius: 6, fontSize: 12, padding: "6px 8px" },
  labelStyle: { color: "var(--cap-text-3)", marginBottom: 2 },
  itemStyle: { color: "var(--cap-text-1)", padding: 0 },
} as const;

/** ⋯ on a budget row (shown on hover): edit the amount from a month on, or delete. */
export function RowMenu({ category, onEdit, onDelete }: { category: string; onEdit: () => void; onDelete: () => void }) {
  const t = useTranslations("budgets");
  return (
    <Menu
      align="end"
      width={200}
      trigger={
        <button
          type="button"
          aria-label={t("rowMenu.label", { category })}
          className="ml-auto inline-flex size-5 shrink-0 items-center justify-center rounded text-fg-3 opacity-0 outline-none group-hover:opacity-100 pointer-coarse:opacity-100 hover:bg-fill-3 hover:text-fg-1 focus-visible:opacity-100 data-[state=open]:opacity-100"
        >
          ⋯
        </button>
      }
    >
      <MenuItem label={t("rowMenu.edit")} onSelect={onEdit} />
      <MenuSep />
      <MenuItem label={t("rowMenu.delete")} danger onSelect={onDelete} />
    </Menu>
  );
}
