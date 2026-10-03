import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Neutral, bordered callout. Used for the TSE "official 2026 candidate list
 * not yet published" notice and for "external source / to be verified" notes.
 */
export function InfoNote({
  children,
  className,
  icon,
}: {
  children: React.ReactNode;
  className?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 text-sm text-muted-foreground",
        className,
      )}
      role="note"
    >
      <span className="mt-0.5 flex-shrink-0 text-blue-500">
        {icon ?? <Info className="h-4 w-4" />}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
