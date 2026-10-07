"use client";

import { useState, type ReactNode } from "react";
import { Select as SelectPrimitive } from "radix-ui";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useOverlay } from "@/lib/shortcuts/provider";
import { cn } from "@/lib/utils";
import { CONTROL, FLOATING, MENU_ROW } from "./styles";

export interface SelectOption {
  value: string;
  label: ReactNode;
  /** Right-aligned secondary text in the list. */
  hint?: ReactNode;
  disabled?: boolean;
}

// Radix reserves "" for "no value"; an option whose value is "" (e.g. "Nenhuma") goes through this.
const EMPTY = "__cap_empty__";
const encode = (value: string) => (value === "" ? EMPTY : value);
const decode = (value: string) => (value === EMPTY ? "" : value);

/** Single-choice dropdown (Radix Select) styled as the 26px control; an overlay while its list is open. */
export function Select({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  invalid,
  id,
  className,
  contentClassName,
  "aria-label": ariaLabel,
}: {
  value: string | null;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  className?: string;
  contentClassName?: string;
  "aria-label"?: string;
}) {
  const t = useTranslations("common");
  const [open, setOpen] = useState(false);
  useOverlay(open);
  const known = value !== null && options.some((option) => option.value === value);
  return (
    <SelectPrimitive.Root
      value={known ? encode(value) : ""}
      onValueChange={(next) => onChange(decode(next))}
      open={open}
      onOpenChange={setOpen}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        id={id}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        className={cn(
          CONTROL,
          "inline-flex items-center justify-between gap-1.5 text-left text-fg-1 data-[placeholder]:text-fg-3 data-[state=open]:border-fg-muted [&>span]:truncate",
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder ?? t("select")} />
        <SelectPrimitive.Icon asChild>
          <ChevronDownIcon className="size-3.5 shrink-0 text-fg-3" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className={cn(
            FLOATING,
            "max-h-[min(320px,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-[8px]",
            contentClassName,
          )}
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((option) => (
              <SelectPrimitive.Item key={option.value} value={encode(option.value)} disabled={option.disabled} className={cn(MENU_ROW, "pr-1.5")}>
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                <span className="ml-auto flex shrink-0 items-center gap-1.5">
                  {option.hint ? <span className="text-caption text-fg-3">{option.hint}</span> : null}
                  <span className="flex w-3.5 justify-center">
                    <SelectPrimitive.ItemIndicator>
                      <CheckIcon className="size-3.5" />
                    </SelectPrimitive.ItemIndicator>
                  </span>
                </span>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
