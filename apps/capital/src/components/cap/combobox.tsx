"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { canCreateOption, filterOptions, moveActive, type ComboboxOption } from "@/lib/combobox";
import { OverlayScope, useOverlay } from "@/lib/shortcuts/provider";
import { cn } from "@/lib/utils";
import { CONTROL, FLOATING } from "./styles";

export type { ComboboxOption } from "@/lib/combobox";

type Row = { kind: "option"; option: ComboboxOption; disabled?: boolean } | { kind: "create"; disabled?: boolean };

const MOVES: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, PageDown: Infinity, PageUp: -Infinity };

/**
 * Searchable single choice. Typing filters (accents and case ignored),
 * ↑/↓ move, ↵ picks, Esc closes. With `onCreate`, a query that matches no
 * option offers "+ Criar “X”" as the last row. An overlay while open.
 */
export function Combobox({
  value,
  onChange,
  options,
  placeholder,
  searchPlaceholder,
  emptyText,
  onCreate,
  createLabel,
  footer,
  disabled,
  invalid,
  id,
  className,
  contentClassName,
  "aria-label": ariaLabel,
  ref,
}: {
  value: string | null;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  /** Called with the trimmed query when the create row is picked. */
  onCreate?: (name: string) => void;
  createLabel?: (name: string) => ReactNode;
  /**
   * Pinned below the list (e.g. "+ Criar conta…"). A function gets the
   * current query and `close`, to open a form prefilled with what was typed.
   */
  footer?: ReactNode | ((api: { query: string; close: () => void }) => ReactNode);
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  className?: string;
  contentClassName?: string;
  "aria-label"?: string;
  /** The trigger button (to focus the field again after a dialog opened from it). */
  ref?: Ref<HTMLButtonElement>;
}) {
  const t = useTranslations("common");
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState<{ query: string; index: number } | null>(null);
  const overlayId = useOverlay(open);

  const rows = useMemo<Row[]>(() => {
    const matches: Row[] = filterOptions(options, query).map((option) => ({ kind: "option", option, disabled: option.disabled }));
    return onCreate && canCreateOption(options, query) ? [...matches, { kind: "create" }] : matches;
  }, [options, query, onCreate]);

  // Until the user moves, the active row is the current value (empty query) or the best match.
  const selectedRow = query ? -1 : rows.findIndex((row) => row.kind === "option" && row.option.value === value);
  const fallback = selectedRow >= 0 ? selectedRow : moveActive(rows, -1, 1);
  const active = cursor && cursor.query === query && cursor.index < rows.length ? cursor.index : fallback;

  useEffect(() => {
    if (!open || active < 0) return;
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setQuery("");
      setCursor(null);
    }
  };

  const choose = (row: Row | undefined) => {
    if (!row || row.disabled) return;
    if (row.kind === "create") onCreate?.(query.trim());
    else onChange(row.option.value);
    changeOpen(false);
  };

  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    const delta = MOVES[event.key];
    if (delta !== undefined) {
      event.preventDefault();
      setCursor({ query, index: moveActive(rows, active, delta) });
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(rows[active]);
    }
  };

  // Typing on the closed trigger opens the list with that first letter.
  const onTriggerKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      changeOpen(true);
    } else if (event.key.length === 1 && event.key !== " " && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      changeOpen(true);
      setQuery(event.key);
    }
  };

  const selected = options.find((option) => option.value === value);
  const optionId = (index: number) => `${listId}-${index}`;

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={changeOpen} modal>
      <PopoverPrimitive.Trigger asChild disabled={disabled}>
        <button
          ref={ref}
          type="button"
          id={id}
          aria-label={ariaLabel}
          data-invalid={invalid || undefined}
          aria-haspopup="listbox"
          onKeyDown={onTriggerKey}
          className={cn(CONTROL, "inline-flex items-center justify-between gap-1.5 text-left text-fg-1 data-[invalid]:border-neg data-[state=open]:border-fg-muted", className)}
        >
          <span className={cn("truncate", !selected && "text-fg-3")}>{selected ? selected.label : (placeholder ?? t("select"))}</span>
          <ChevronDownIcon className="size-3.5 shrink-0 text-fg-3" />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          onCloseAutoFocus={(event) => {
            // Focus normally falls back to <body> when the list unmounts and
            // returns to the trigger. If something else took it meanwhile
            // (a form dialog opened from the footer), leave it there.
            if (document.activeElement && document.activeElement !== document.body) event.preventDefault();
          }}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
          className={cn(FLOATING, "flex w-[var(--radix-popover-trigger-width)] min-w-[220px] flex-col overflow-hidden rounded-[8px]", contentClassName)}
        >
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onSearchKey}
            placeholder={searchPlaceholder ?? t("search")}
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? optionId(active) : undefined}
            className="h-8 w-full shrink-0 border-b border-stroke-3 bg-transparent px-2.5 text-control outline-none placeholder:text-fg-3"
          />
          <ul ref={listRef} id={listId} role="listbox" className="max-h-[260px] overflow-y-auto p-1">
            {rows.map((row, index) => {
              const isSelected = row.kind === "option" && row.option.value === value;
              return (
                <li
                  key={row.kind === "option" ? row.option.value : "__create__"}
                  id={optionId(index)}
                  data-index={index}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={row.disabled || undefined}
                  data-active={index === active || undefined}
                  onMouseMove={() => index !== active && setCursor({ query, index })}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(row)}
                  className={cn(
                    "flex h-(--cap-menu-row-h) cursor-pointer items-center gap-2 rounded-[5px] px-2 text-control select-none data-[active]:bg-fill-3",
                    row.disabled && "cursor-not-allowed opacity-40",
                  )}
                >
                  {row.kind === "option" ? (
                    <>
                      <span className="min-w-0 flex-1 truncate">{row.option.label}</span>
                      {row.option.hint ? <span className="shrink-0 text-caption text-fg-3">{row.option.hint}</span> : null}
                      <CheckIcon className={cn("size-3.5 shrink-0", !isSelected && "invisible")} />
                    </>
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-fg-2">
                      {createLabel ? createLabel(query.trim()) : t("createNamed", { name: query.trim() })}
                    </span>
                  )}
                </li>
              );
            })}
            {rows.length === 0 ? <li className="px-2 py-1.5 text-body-sm text-fg-3">{emptyText ?? t("noResults")}</li> : null}
          </ul>
          {footer ? (
            <div className="border-t border-stroke-3 p-1">
              <OverlayScope id={overlayId}>{typeof footer === "function" ? footer({ query: query.trim(), close: () => changeOpen(false) }) : footer}</OverlayScope>
            </div>
          ) : null}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
