"use client";

import type { ReactNode } from "react";
import { DropdownMenu } from "radix-ui";
import { CheckIcon } from "lucide-react";
import { OverlayScope, useOverlayRoot } from "@/lib/shortcuts/provider";
import { cn } from "@/lib/utils";
import { FLOATING, MENU_ROW } from "./styles";

/**
 * Dropdown menu (Radix): row menus (⋯), "Mais ações", view options.
 * `trigger` is rendered as the Radix trigger, so it must accept a ref and
 * props (a <button> or Btn). An overlay while open, so single-key app
 * shortcuts do not fire while typing ahead in it.
 */
export function Menu({
  trigger,
  children,
  align = "start",
  side = "bottom",
  width = 210,
  open,
  onOpenChange,
  modal = false,
  className,
}: {
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  width?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  modal?: boolean;
  className?: string;
}) {
  const root = useOverlayRoot({ open, onOpenChange });
  return (
    <DropdownMenu.Root open={root.open} onOpenChange={root.onOpenChange} modal={modal}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          side={side}
          sideOffset={4}
          collisionPadding={8}
          style={{ width }}
          className={cn(FLOATING, "max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto rounded-[8px] p-1", className)}
        >
          <OverlayScope id={root.overlayId}>{children}</OverlayScope>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** Menu row: 28px, 12.5px label, shortcut hint in mono 10.5px quaternary. */
export function MenuItem({
  label,
  shortcut,
  onSelect,
  danger,
  disabled,
  icon,
}: {
  label: ReactNode;
  shortcut?: string;
  /** Runs on click or ↵; the menu closes afterwards unless the event is prevented. */
  onSelect?: (event: Event) => void;
  danger?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
}) {
  return (
    <DropdownMenu.Item onSelect={onSelect} disabled={disabled} className={cn(MENU_ROW, danger ? "text-neg" : "text-fg-1")}>
      {icon ? <span className="flex size-3.5 shrink-0 items-center justify-center text-fg-3">{icon}</span> : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {shortcut ? <span className="shrink-0 font-mono text-[10.5px] text-fg-4">{shortcut}</span> : null}
    </DropdownMenu.Item>
  );
}

/** Toggle row (column visibility, filters) with a check on the right when on. */
export function MenuCheckItem({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <DropdownMenu.CheckboxItem
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled}
      onSelect={(event) => event.preventDefault()}
      className={cn(MENU_ROW, "text-fg-1")}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <DropdownMenu.ItemIndicator>
        <CheckIcon className="size-3.5" />
      </DropdownMenu.ItemIndicator>
    </DropdownMenu.CheckboxItem>
  );
}

export function MenuSep() {
  return <DropdownMenu.Separator className="my-1 h-px bg-stroke-3" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <DropdownMenu.Label className="px-2 pt-1 pb-0.5 text-[11px] text-fg-3">{children}</DropdownMenu.Label>;
}
