import { cn } from "@/lib/utils";
import type { MetricStatus, VerdictDecision } from "@/lib/funnel/types";

// One source of truth for health → visual treatment, shared across the funnel
// diagram, portfolio dots and badges. Flat and desaturated — status is the
// only color on screen, used quietly (no glow, no neon).
export const HEALTH_CLASSES: Record<
  MetricStatus,
  { chip: string; border: string; dot: string }
> = {
  healthy: {
    chip: "bg-success/10 text-success border border-success/20",
    border: "border-success/35",
    dot: "bg-success",
  },
  warning: {
    chip: "bg-warning/10 text-warning border border-warning/20",
    border: "border-warning/35",
    dot: "bg-warning",
  },
  critical: {
    chip: "bg-destructive/12 text-destructive border border-destructive/25",
    border: "border-destructive/40",
    dot: "bg-destructive",
  },
  insufficient_data: {
    chip: "bg-muted text-muted-foreground border border-border",
    border: "border-border",
    dot: "bg-muted-foreground/40",
  },
  neutral: {
    chip: "bg-muted text-foreground/75 border border-border",
    border: "border-border",
    dot: "bg-muted-foreground/40",
  },
};

export function HealthDot({
  status,
  title,
}: {
  status: MetricStatus;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn("inline-block h-2 w-2 rounded-full", HEALTH_CLASSES[status].dot)}
    />
  );
}

const VERDICT_CLASSES: Record<VerdictDecision, string> = {
  DOUBLE_DOWN: "bg-success/10 text-success border border-success/20",
  SCALE: "bg-success/10 text-success border border-success/20",
  OPTIMIZE: "bg-warning/10 text-warning border border-warning/20",
  HOLD_FIX: "bg-warning/10 text-warning border border-warning/20",
  KILL: "bg-destructive/12 text-destructive border border-destructive/25",
  COLLECTING: "bg-muted text-muted-foreground border border-border",
};

export function VerdictBadge({
  decision,
  label,
}: {
  decision: VerdictDecision;
  label: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold uppercase tracking-wide",
        VERDICT_CLASSES[decision],
      )}
    >
      {label}
    </span>
  );
}
