"use client";

import { cn } from "@/lib/utils";

/**
 * Inline segmented control: 22px segments in a 2px-padded outline (Mês / Ano, PF / PJ).
 * Never wider than its container: with many options on a phone it scrolls sideways inside itself.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
  className,
  "aria-label": ariaLabel,
}: {
  value: T;
  options: { v: T; l: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <span role="radiogroup" aria-label={ariaLabel} className={cn("inline-flex max-w-full shrink-0 gap-0.5 overflow-x-auto rounded-[7px] border border-stroke-2 p-0.5 [scrollbar-width:none]", className)}>
      {options.map((option) => (
        <button
          key={option.v}
          type="button"
          role="radio"
          aria-checked={option.v === value}
          disabled={disabled}
          onClick={() => onChange(option.v)}
          className={cn(
            "inline-flex h-[22px] shrink-0 items-center rounded-[5px] px-2 text-button whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-fg-3/40 disabled:cursor-not-allowed",
            option.v === value ? "bg-fill-3 font-medium text-fg-1" : "text-fg-3 hover:text-fg-strong",
          )}
        >
          {option.l}
        </button>
      ))}
    </span>
  );
}
