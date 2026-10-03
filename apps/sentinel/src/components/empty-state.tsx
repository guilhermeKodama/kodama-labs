import { cn } from "@/lib/utils";

/**
 * Standard "no data yet" placeholder for tabs/sections whose data lands in a
 * later pipeline milestone (CEAP, votes, legal, news). Keeps the neutral,
 * non-verdict tone required across Sentinel.
 */
export function EmptyState({
  icon,
  title,
  subtitle,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-dashed bg-card/50 p-8 text-center",
        className,
      )}
    >
      {icon && (
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          {icon}
        </div>
      )}
      <p className="text-sm font-medium">{title}</p>
      {subtitle && (
        <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
      )}
    </div>
  );
}
