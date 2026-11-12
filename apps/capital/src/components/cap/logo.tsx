import { MARK_FULL, MARK_SIMPLE, type MarkShape } from "@/lib/brand";
import { cn } from "@/lib/utils";

const SHAPES = { full: MARK_FULL, simple: MARK_SIMPLE } satisfies Record<string, MarkShape>;

/**
 * The Cerne mark: growth rings around a resin core. "brand" paints it in
 * the theme's brand and resin (heartwood rings on light, sapwood on dark);
 * "current" takes the text color, for use as a navigation icon. Hidden
 * from assistive technology unless it gets a label.
 */
export function Mark({
  detail = "simple",
  tone = "brand",
  label,
  className,
}: {
  detail?: keyof typeof SHAPES;
  tone?: "brand" | "current";
  label?: string;
  className?: string;
}) {
  const shape = SHAPES[detail];
  const rings = tone === "brand" ? "var(--cap-brand)" : "currentColor";
  const core = tone === "brand" ? "var(--cap-resin)" : "currentColor";
  return (
    <svg
      viewBox="0 0 64 64"
      className={cn("shrink-0", className)}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      <g fill="none" stroke={rings}>
        {shape.rings.map((ring) => (
          <circle key={ring.r} cx={ring.cx} cy={ring.cy} r={ring.r} strokeWidth={ring.w} />
        ))}
      </g>
      <circle cx={shape.core.cx} cy={shape.core.cy} r={shape.core.r} fill={core} />
    </svg>
  );
}

/** The mark and the lowercase "cerne" in the title serif. */
export function Wordmark({ className, markClassName }: { className?: string; markClassName?: string }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2 font-title text-heading font-semibold tracking-tight text-wordmark", className)}>
      <Mark className={cn("size-6", markClassName)} />
      <span className="truncate">cerne</span>
    </span>
  );
}
