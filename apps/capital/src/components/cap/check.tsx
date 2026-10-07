"use client";

import { useId, type MouseEvent, type ReactNode } from "react";
import { Checkbox } from "radix-ui";
import { CheckIcon, MinusIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** 14px checkbox with an optional 12.5px label. "indeterminate" for partial selection. */
export function Check({
  checked,
  onChange,
  label,
  disabled,
  id,
  className,
  onClick,
  "aria-label": ariaLabel,
}: {
  checked: boolean | "indeterminate";
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  /** Sees the click first (e.g. shift for range selection); the click never reaches the row behind. */
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
  "aria-label"?: string;
}) {
  const autoId = useId();
  const boxId = id ?? autoId;
  const box = (
    <Checkbox.Root
      id={boxId}
      checked={checked}
      disabled={disabled}
      aria-label={ariaLabel}
      onCheckedChange={(value) => onChange(value === true)}
      onClick={(event) => {
        onClick?.(event);
        event.stopPropagation();
      }}
      className={cn(
        "inline-flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border border-stroke-1 bg-editor text-editor outline-none focus-visible:ring-2 focus-visible:ring-fg-3/40 disabled:cursor-not-allowed disabled:opacity-40 data-[state=checked]:border-fg-1 data-[state=checked]:bg-fg-1 data-[state=indeterminate]:border-fg-1 data-[state=indeterminate]:bg-fg-1",
        !label && className,
      )}
    >
      <Checkbox.Indicator>
        {checked === "indeterminate" ? <MinusIcon className="size-2.5" strokeWidth={3} /> : <CheckIcon className="size-2.5" strokeWidth={3} />}
      </Checkbox.Indicator>
    </Checkbox.Root>
  );
  if (!label) return box;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-control", disabled && "opacity-60", className)}>
      {box}
      <label htmlFor={boxId} className={cn("cursor-pointer select-none", disabled && "cursor-not-allowed")}>
        {label}
      </label>
    </span>
  );
}
