"use client";

import { cn } from "@/lib/utils";

/**
 * The cap Segmented with options that can be off one by one: editing an
 * expense can switch to Entrada but not to Transferência, which needs a
 * new transaction.
 */
export function KindSegmented<T extends string>({
  value,
  options,
  onChange,
  "aria-label": ariaLabel,
}: {
  value: T;
  options: { v: T; l: string; disabled?: boolean }[];
  onChange: (value: T) => void;
  "aria-label"?: string;
}) {
  return (
    <span role="radiogroup" aria-label={ariaLabel} className="inline-flex w-fit shrink-0 gap-0.5 rounded-[7px] border border-stroke-2 p-0.5">
      {options.map((option) => (
        <button
          key={option.v}
          type="button"
          role="radio"
          aria-checked={option.v === value}
          disabled={option.disabled}
          onClick={() => onChange(option.v)}
          className={cn(
            "inline-flex h-[22px] items-center rounded-[5px] px-2 text-button whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-fg-3/40 disabled:cursor-not-allowed disabled:opacity-40",
            option.v === value ? "bg-fill-3 font-medium text-fg-1" : "text-fg-3 hover:text-fg-strong",
          )}
        >
          {option.l}
        </button>
      ))}
    </span>
  );
}
