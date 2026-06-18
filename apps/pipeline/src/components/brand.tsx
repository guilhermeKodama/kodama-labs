// Pipeline logomark: a funnel — three rounded bars narrowing downward.
// Monochrome (inherits currentColor), reads clean at 16px. No gradient, no glow.

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="3.2" rx="1.6" />
      <rect x="6" y="10.4" width="12" height="3.2" rx="1.6" />
      <rect x="9" y="15.8" width="6" height="3.2" rx="1.6" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`font-semibold tracking-tight text-foreground ${className ?? ""}`}>
      Pipeline
    </span>
  );
}
