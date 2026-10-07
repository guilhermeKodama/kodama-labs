"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Btn, Check, Popover } from "@/components/cap";
import { MENU_ROW } from "@/components/cap/styles";
import { cn } from "@/lib/utils";

export type ChipOption = { value: string; label: string; hint?: string };

/** One filter on screen: its text, the property it edits (null: shown with ✕ only) and its removal. */
export interface FilterChip<P extends string> {
  /** Stable per property ("prop:<id>"), so the chip keeps its editor open while its filter is created or changed. */
  key: string;
  text: string;
  prop: P | null;
  onRemove: () => void;
}

/** "Prop é…" and a check per value (the body of a chip's editor). */
export function ChipValuesEditor({
  title,
  options,
  values,
  onValues,
  loading,
}: {
  title: string;
  options: readonly ChipOption[];
  values: readonly string[];
  onValues: (values: string[]) => void;
  loading?: boolean;
}) {
  const t = useTranslations("ledger.filters");
  const tc = useTranslations("common");
  return (
    <>
      <span className="text-[11px] text-fg-3">{title}</span>
      <div className="flex flex-col gap-1.5">
        {options.map((option) => (
          <Check
            key={option.value}
            checked={values.includes(option.value)}
            onChange={(on) => onValues(on ? [...values, option.value] : values.filter((v) => v !== option.value))}
            label={
              <span className="inline-flex min-w-0 gap-1.5">
                <span className="truncate">{option.label}</span>
                {option.hint ? <span className="truncate text-fg-3">{option.hint}</span> : null}
              </span>
            }
          />
        ))}
        {loading ? <span className="text-[12px] text-fg-3">{tc("loading")}</span> : null}
        {!loading && !options.length ? <span className="text-[12px] text-fg-3">{t("noOptions")}</span> : null}
      </div>
    </>
  );
}

/** The key of a chip: per property when it has one, so it survives being created and reordered. */
export function chipKey(prop: string | null, index: number, field: string): string {
  return prop ? `prop:${prop}` : `${index}:${field}`;
}

/**
 * The filter chips and "+ Filtro" of a view (mockup 2234–2362), for any
 * dataset: pick a property in "Filtrar por…", then check its values in the
 * chip's editor ("Prop é…", "Pronto"). Each check changes the view at once.
 * While a property just picked has no value yet it shows as "Prop:
 * escolha…". `editor(prop)` renders the values of a property (a component,
 * so it can load them).
 */
export function ChipBar<P extends string>({
  chips,
  addable,
  propLabel,
  pendingText,
  editor,
  trailing,
}: {
  chips: readonly FilterChip<P>[];
  /** Properties "+ Filtro" offers (those without a chip yet). */
  addable: readonly P[];
  propLabel: (prop: P) => string;
  /** "Prop: escolha…" for a property picked but not set yet. */
  pendingText: (prop: P) => string;
  editor: (prop: P) => ReactNode;
  /** After "+ Filtro" (e.g. "Limpar filtros"). */
  trailing?: ReactNode;
}) {
  const t = useTranslations("ledger.filters");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<P | null>(null);
  /** A property just picked in "Filtrar por…", shown as "Prop: escolha…" while its editor is open. */
  const [pending, setPending] = useState<P | null>(null);

  const close = () => {
    setEditing(null);
    setPending(null);
  };

  const chip = ({ key, text, prop, onRemove }: FilterChip<P>) => {
    const open = prop !== null && editing === prop;
    const label = (
      <button type="button" disabled={!prop} className="h-full max-w-[320px] truncate px-2 text-left whitespace-nowrap disabled:cursor-default">
        {text}
      </button>
    );
    return (
      <span key={key} className={cn("inline-flex h-6 shrink-0 items-center overflow-hidden rounded-[6px] border border-stroke-2 text-[12px]", open ? "bg-fill-2" : "bg-fill-4")}>
        {prop ? (
          <Popover open={open} onOpenChange={(next) => (next ? setEditing(prop) : close())} width={260} trigger={label}>
            {editor(prop)}
            <div className="flex gap-1.5">
              <Btn primary onClick={close}>
                {t("done")}
              </Btn>
            </div>
          </Popover>
        ) : (
          label
        )}
        <button
          type="button"
          title={t("remove")}
          aria-label={t("remove")}
          className="h-full border-l border-stroke-3 px-[7px] text-fg-3 hover:text-fg-strong"
          onClick={() => {
            if (prop !== null && prop === editing) close();
            onRemove();
          }}
        >
          ✕
        </button>
      </span>
    );
  };

  const pendingShown = pending !== null && !chips.some((c) => c.prop === pending);
  // One list, so the picked property's chip keeps its key (and its open editor) when its filter appears.
  const all: FilterChip<P>[] = pendingShown ? [...chips, { key: chipKey(pending, -1, pending), text: pendingText(pending), prop: pending, onRemove: close }] : [...chips];
  return (
    <>
      {all.map(chip)}
      <Popover open={adding} onOpenChange={setAdding} width={220} trigger={<Btn dashed>{t("add")}</Btn>}>
        <span className="text-[11px] text-fg-3">{t("filterBy")}</span>
        <div className="-mx-1 flex flex-col">
          {addable.map((prop) => (
            <button
              key={prop}
              type="button"
              className={cn(MENU_ROW, "hover:bg-fill-3")}
              onClick={() => {
                setAdding(false);
                setPending(prop);
                // Open the editor once the menu has closed, so it anchors to the new chip.
                setTimeout(() => setEditing(prop), 0);
              }}
            >
              {propLabel(prop)}
            </button>
          ))}
        </div>
      </Popover>
      {trailing}
    </>
  );
}
