import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Form field: 12px/500 label, 5px gap, optional 11px hint. Pass `htmlFor`
 * with the control's id to make the label focus it; `span` spans grid
 * columns in two-column forms.
 */
export function Field({
  label,
  hint,
  htmlFor,
  span,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  htmlFor?: string;
  span?: number;
  children: ReactNode;
  className?: string;
}) {
  const labelClass = "text-[12px] font-medium";
  return (
    <div className={cn("flex min-w-0 flex-col gap-[5px]", className)} style={span ? { gridColumn: `span ${span}` } : undefined}>
      {htmlFor ? (
        <label htmlFor={htmlFor} className={labelClass}>
          {label}
        </label>
      ) : (
        <span className={labelClass}>{label}</span>
      )}
      {children}
      {hint ? <span className="text-[11px] text-fg-3">{hint}</span> : null}
    </div>
  );
}
