"use client";

import type { ReactNode } from "react";
import { RadioGroup } from "radix-ui";
import { cn } from "@/lib/utils";

export interface ChoiceOption<T extends string = string> {
  v: T;
  l: ReactNode;
  /** 11.5px description under the label. */
  d?: ReactNode;
  disabled?: boolean;
}

/** Radio cards: one bordered row per option with a title and description (delete scopes, import modes). */
export function Choice<T extends string>({
  options,
  value,
  onChange,
  className,
  "aria-label": ariaLabel,
}: {
  options: ChoiceOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <RadioGroup.Root value={value} onValueChange={(next) => onChange(next as T)} aria-label={ariaLabel} className={cn("flex flex-col gap-1.5", className)}>
      {options.map((option) => (
        <RadioGroup.Item
          key={option.v}
          value={option.v}
          disabled={option.disabled}
          className="group flex cursor-pointer items-start gap-2.5 rounded-[8px] border border-stroke-2 px-2.5 py-[9px] text-left outline-none focus-visible:ring-2 focus-visible:ring-fg-3/40 disabled:cursor-not-allowed disabled:opacity-40 data-[state=checked]:border-fg-1"
        >
          <span className="mt-px inline-flex size-3.5 shrink-0 items-center justify-center rounded-full border border-stroke-1 group-data-[state=checked]:border-fg-1">
            <RadioGroup.Indicator className="block size-[7px] rounded-full bg-fg-1" />
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-body font-medium">{option.l}</span>
            {option.d ? <span className="text-label text-fg-3">{option.d}</span> : null}
          </span>
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
