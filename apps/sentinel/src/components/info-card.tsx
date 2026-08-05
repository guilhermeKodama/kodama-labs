import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Shared presentational building blocks promoted from the politician detail
 * page so every section/tab and the elections hub render identical shapes.
 * Pure (no hooks) — safe in server components.
 */

/** Big-number card: small muted label over a bold value. */
export function InfoCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-4",
        highlight && "border-orange-500/30",
      )}
    >
      <p className="text-[11px] text-muted-foreground mb-1">{label}</p>
      <p className={cn("text-lg font-bold", highlight && "text-orange-500")}>
        {value}
      </p>
    </div>
  );
}

/** Inline label/value pair used inside section grids. */
export function Field({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="font-medium">{value ?? "-"}</p>
    </div>
  );
}

/** Dashboard-style stat card; becomes a link when `href` is provided. */
export function StatCard({
  title,
  value,
  icon,
  subtitle,
  highlight,
  href,
}: {
  title: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  subtitle?: string;
  highlight?: boolean;
  href?: string;
}) {
  const inner = (
    <>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-muted-foreground">{title}</span>
        {icon}
      </div>
      <p className="text-xl font-bold">{value}</p>
      {subtitle && (
        <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>
      )}
    </>
  );

  const className = cn(
    "rounded-lg border bg-card p-4 block",
    highlight && "border-orange-500/40",
    href && "hover:bg-muted/40 transition-colors",
  );

  return href ? (
    <Link href={href} className={className}>
      {inner}
    </Link>
  ) : (
    <div className={className}>{inner}</div>
  );
}
