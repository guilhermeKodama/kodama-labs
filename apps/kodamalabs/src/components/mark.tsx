interface MarkProps {
  size: number;
  className?: string;
}

/**
 * The Kodama Labs mark: a drafting compass and the arc it has just drawn.
 * Drawn in the current text colour. Decorative; the name sits beside it.
 */
export function Mark({ size, className }: MarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
    >
      <path d="M 4 19 Q 12 22.8 20 19" strokeWidth={0.95} opacity={0.55} />
      <line x1="12" y1="6.2" x2="4.8" y2="20" strokeWidth={1.7} />
      <line x1="12" y1="6.2" x2="19.2" y2="20" strokeWidth={1.7} />
      <path d="M 8.6 13 Q 12 11.2 15.4 13" strokeWidth={0.95} opacity={0.7} />
      <rect x="9.8" y="2.6" width="4.4" height="4" rx="1.1" fill="currentColor" stroke="none" />
      <circle cx="15.2" cy="4.4" r="0.7" fill="currentColor" stroke="none" opacity={0.7} />
      <path d="M 19.2 20 L 20.6 22.4 L 17.7 21.9 Z" fill="currentColor" stroke="none" />
      <path d="M 4.8 20 L 3.4 22.4 L 6.3 21.9 Z" fill="currentColor" stroke="none" opacity={0.85} />
    </svg>
  );
}
