"use client";

import { Switch } from "radix-ui";
import { cn } from "@/lib/utils";

/** On/off switch (notification settings). md 28×16, sm 24×14. */
export function Toggle({
  checked,
  onChange,
  disabled,
  size = "md",
  id,
  className,
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  id?: string;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <Switch.Root
      id={id}
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn(
        "inline-flex shrink-0 cursor-pointer items-center rounded-full bg-fill-1 p-0.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-fg-3/40 disabled:cursor-not-allowed disabled:opacity-40 data-[state=checked]:bg-fg-1",
        size === "md" ? "h-4 w-7" : "h-3.5 w-6",
        className,
      )}
    >
      <Switch.Thumb
        className={cn(
          "block rounded-full bg-editor shadow-sm transition-transform data-[state=unchecked]:translate-x-0",
          size === "md" ? "size-3 data-[state=checked]:translate-x-3" : "size-2.5 data-[state=checked]:translate-x-2.5",
        )}
      />
    </Switch.Root>
  );
}
