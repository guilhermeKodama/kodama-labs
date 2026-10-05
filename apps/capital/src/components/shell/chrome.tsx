"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { OverlayScope, useOverlay } from "@/lib/shortcuts/provider";
import { cn } from "@/lib/utils";

// Same look and API as before the cap primitives existed; screens may import either path.
export { Badge, EmptyRow, Kpi, Segmented, TextInput } from "@/components/cap";

// The components below predate @/components/cap and differ from it (radius 10,
// native select/checkbox, 11px field labels); they keep their look until the
// screens move to the cap primitives.

export function Btn({
  children,
  primary,
  dashed,
  ghost,
  danger,
  disabled,
  onClick,
  type = "button",
  className,
}: {
  children: ReactNode;
  primary?: boolean;
  dashed?: boolean;
  ghost?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-[26px] shrink-0 items-center gap-1.5 rounded-[6px] px-2.5 text-[12px] font-medium whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-40",
        primary && "border border-fg-1 bg-fg-1 text-editor",
        !primary && !ghost && "border border-stroke-1 bg-editor text-fg-1 hover:bg-fill-4",
        dashed && "border-dashed",
        ghost && "border border-transparent text-fg-muted hover:bg-fill-3",
        danger && "text-neg",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function KpiStrip({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-7 rounded-lg border border-stroke-3 px-3.5 py-3">{children}</div>;
}

export function Panel({ title, trailing, children, pad = true }: { title: string; trailing?: ReactNode; children: ReactNode; pad?: boolean }) {
  return (
    <section className="min-w-0 overflow-hidden rounded-lg border border-stroke-3">
      <header className="flex h-9 items-center gap-2 border-b border-stroke-3 px-3 text-[12.5px] font-medium">
        <span>{title}</span>
        <span className="ml-auto flex items-center gap-1.5">{trailing}</span>
      </header>
      <div className={pad ? "p-3" : ""}>{children}</div>
    </section>
  );
}

export function SelectInput({
  value,
  onChange,
  options,
  placeholder,
  className,
  required,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  className?: string;
  required?: boolean;
}) {
  return (
    <select
      value={value}
      required={required}
      onChange={(event) => onChange(event.target.value)}
      className={cn("h-[26px] min-w-0 rounded-[6px] border border-stroke-1 bg-editor px-1.5 text-[12.5px] outline-none focus:border-fg-muted", className)}
    >
      {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span className="text-[11px] text-fg-muted">{label}</span>
      {children}
      {hint ? <span className="text-[11px] text-fg-3">{hint}</span> : null}
    </label>
  );
}

export function Check({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label?: string }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 text-[12.5px]">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="size-3.5 accent-fg-ink" />
      {label}
    </label>
  );
}

/**
 * Anchored menu that closes on outside click and Escape. An overlay while
 * open: app shortcuts pause, and Esc closes only the top overlay.
 */
export function Popover({
  open,
  onClose,
  children,
  align = "left",
  width = 240,
  up,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  align?: "left" | "right";
  width?: number;
  up?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const overlayId = useOverlay(open, { onEscape: onClose });
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      ref={ref}
      style={{ width }}
      className={cn(
        "absolute z-40 flex max-h-[360px] flex-col gap-0.5 overflow-y-auto rounded-lg border border-stroke-1 bg-editor p-1.5 text-[12.5px] shadow-lg",
        align === "left" ? "left-0" : "right-0",
        up ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]",
      )}
    >
      <OverlayScope id={overlayId}>{children}</OverlayScope>
    </div>
  );
}

export function MenuItem({ label, hint, onClick, danger, active }: { label: ReactNode; hint?: ReactNode; onClick?: () => void; danger?: boolean; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("flex h-7 w-full items-center gap-2 rounded-[5px] px-2 text-left hover:bg-fill-3", danger && "text-neg", active && "font-medium")}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint ? <span className="shrink-0 text-[11px] text-fg-3">{hint}</span> : null}
    </button>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <span className="px-2 pt-1 pb-0.5 text-[11px] text-fg-3">{children}</span>;
}

/** Rendered only while open, so it is an overlay for as long as it is mounted (like Popover). */
export function Modal({
  title,
  description,
  onClose,
  children,
  footer,
  width = 520,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const overlayId = useOverlay(true, { onEscape: onClose });
  return (
    <div data-modal className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-backdrop/30 py-[8vh]" onMouseDown={onClose}>
      <div style={{ width }} className="flex max-w-[94vw] flex-col rounded-[10px] border border-stroke-1 bg-editor shadow-xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-start gap-2 border-b border-stroke-3 px-4 py-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-[14px] font-semibold">{title}</span>
            {description ? <span className="text-[12px] text-fg-muted">{description}</span> : null}
          </div>
          <button type="button" className="ml-auto text-fg-3 hover:text-fg-strong" onClick={onClose}>
            ✕
          </button>
        </div>
        <OverlayScope id={overlayId}>
          <div className="flex flex-col gap-3 px-4 py-3.5">{children}</div>
          {footer ? <div className="flex items-center justify-end gap-1.5 border-t border-stroke-3 px-4 py-2.5">{footer}</div> : null}
        </OverlayScope>
      </div>
    </div>
  );
}
