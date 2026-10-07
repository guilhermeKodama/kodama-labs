"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { PALETTE, paletteName, type PaletteName } from "@/lib/settings/palette";

/**
 * Pieces of the mockup's MasterDataFlow (Negócios e PF, contas, cartões,
 * corretoras, categorias): a grouped list on the left and the selected
 * item's form on the right.
 */
export function ListDetail({ list, detail }: { list: ReactNode; detail: ReactNode }) {
  return (
    <div className="grid items-start gap-3.5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="flex flex-col gap-0.5">{list}</div>
      <div className="flex flex-col gap-3 rounded-[10px] border border-stroke-3 p-3.5">{detail}</div>
    </div>
  );
}

/** 11px tertiary group label ("Despesas", an entity name). */
export function GroupLabel({ children }: { children: ReactNode }) {
  return <span className="px-2.5 pt-2 pb-0.5 text-caption text-fg-3">{children}</span>;
}

/** List row, --cap-row-h tall (34px at Médio): left content, right annotation (kind, currency, count). */
export function ListItem({ on, onClick, left, right, faded }: { on: boolean; onClick: () => void; left: ReactNode; right?: ReactNode; faded?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={on || undefined}
      className={cn(
        "flex h-(--cap-row-h) items-center gap-2 rounded-[6px] px-2.5 text-left text-control outline-none focus-visible:ring-2 focus-visible:ring-fg-3/40",
        on ? "bg-fill-2/80" : "hover:bg-fill-4",
        faded && "opacity-50",
      )}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">{left}</span>
      {right}
    </button>
  );
}

/** "+ Nova conta": 12.5px tertiary text row under the list. */
export function AddRow({ on, onClick, children }: { on?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("rounded-[6px] px-2.5 py-2 text-left text-control outline-none hover:text-fg-strong focus-visible:ring-2 focus-visible:ring-fg-3/40", on ? "bg-fill-2/80 text-fg-1" : "text-fg-3")}
    >
      {children}
    </button>
  );
}

/** 8px color dot of a list row. */
export function Dot({ color }: { color: string }) {
  return <span className="size-2 shrink-0 rounded-full" style={{ background: color }} />;
}

/** Form footer: primary action, then a right-aligned secondary one (Arquivar …). */
export function DetailFooter({ children, end }: { children?: ReactNode; end?: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 border-t border-stroke-3 pt-2.5">
      {children}
      <span className="flex-1" />
      {end}
    </div>
  );
}

/** The nine palette swatches (18px), the selected one outlined. Stores the palette hex. */
export function Swatches({ value, onChange, disabled }: { value: string | null; onChange: (hex: string) => void; disabled?: boolean }) {
  const t = useTranslations("settings.ent.colorName");
  const selected = paletteName(value);
  return (
    <span role="radiogroup" className="flex gap-1.5">
      {PALETTE.map((p) => (
        <button
          key={p.name}
          type="button"
          role="radio"
          aria-checked={selected === p.name}
          aria-label={t(p.name as PaletteName)}
          title={t(p.name as PaletteName)}
          disabled={disabled}
          onClick={() => onChange(p.hex)}
          className="size-[18px] rounded-full outline-offset-2 disabled:cursor-not-allowed"
          style={{ background: `var(--cap-cat-${p.name})`, outline: selected === p.name ? "2px solid var(--cap-text-1)" : "none" }}
        />
      ))}
    </span>
  );
}
