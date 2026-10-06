"use client";

import { useTranslations } from "next-intl";
import { layoutGlyph } from "@/lib/ledger/view-glyphs";
import type { LedgerView } from "@/lib/ledger/use-views";
import { cn } from "@/lib/utils";

/**
 * The view tabs above the table (mockup 2196–2231): layout glyph, name,
 * "fixa" on Todas, the active underline, the yellow dot while the active
 * view has an unsaved draft, and "+" for a new view.
 */
export function ViewTabs({
  views,
  activeId,
  dirty,
  onPick,
  onNew,
  creating,
}: {
  views: readonly LedgerView[];
  activeId: string | null;
  dirty: boolean;
  onPick: (view: LedgerView) => void;
  onNew: () => void;
  creating?: boolean;
}) {
  const t = useTranslations("ledger.tabs");
  return (
    <div className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-stroke-3 px-2.5">
      {views.map((view) => {
        const on = view.id === activeId;
        return (
          <button
            key={view.id}
            type="button"
            onClick={() => onPick(view)}
            className={cn(
              "inline-flex h-[38px] shrink-0 items-center gap-1.5 border-b-2 px-2 text-[12.5px] whitespace-nowrap outline-none focus-visible:bg-fill-4",
              on ? "border-fg-1 font-medium text-fg-1" : "border-transparent text-fg-3 hover:text-fg-strong",
            )}
          >
            <span className="text-[11px] text-fg-3">{layoutGlyph(view.config.layout)}</span>
            {view.name}
            {view.isBuiltin ? <span className="text-[10px] text-fg-4">{t("fixed")}</span> : null}
            {on && dirty ? <span title={t("modified")} className="size-1.5 rounded-full bg-cat-yellow" /> : null}
          </button>
        );
      })}
      <button type="button" title={t("newView")} aria-label={t("newView")} disabled={creating} onClick={onNew} className="px-2 text-[14px] text-fg-3 hover:text-fg-strong disabled:opacity-40">
        +
      </button>
    </div>
  );
}
