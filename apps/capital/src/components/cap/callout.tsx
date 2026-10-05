import type { ReactNode } from "react";
import { CircleCheckIcon, InfoIcon, OctagonAlertIcon, TriangleAlertIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type CalloutTone = "info" | "success" | "warning" | "danger" | "neutral";

const TONE: Record<CalloutTone, { box: string; icon: ReactNode }> = {
  info: { box: "border-stroke-2 bg-fill-4 text-fg-2", icon: <InfoIcon /> },
  neutral: { box: "border-stroke-2 bg-fill-4 text-fg-2", icon: null },
  success: { box: "border-pos-soft bg-pos-wash text-pos-ink", icon: <CircleCheckIcon /> },
  warning: { box: "border-warn-soft bg-warn-wash text-warn-ink", icon: <TriangleAlertIcon /> },
  danger: { box: "border-neg-soft bg-neg-wash text-neg-ink", icon: <OctagonAlertIcon /> },
};

/** Inline notice: optional title, body text, tone-colored box with a leading icon. */
export function Callout({
  tone = "info",
  title,
  icon,
  children,
  className,
}: {
  tone?: CalloutTone;
  title?: ReactNode;
  /** Replaces the tone's default icon; `null` hides it. */
  icon?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const glyph = icon === undefined ? TONE[tone].icon : icon;
  return (
    <div role={tone === "danger" || tone === "warning" ? "alert" : "status"} className={cn("flex gap-2 rounded-[8px] border px-3 py-2 text-[12px]", TONE[tone].box, className)}>
      {glyph ? <span className="mt-px flex size-3.5 shrink-0 items-center justify-center [&>svg]:size-3.5">{glyph}</span> : null}
      <div className="flex min-w-0 flex-col gap-0.5">
        {title ? <span className="font-medium">{title}</span> : null}
        {children ? <div>{children}</div> : null}
      </div>
    </div>
  );
}
