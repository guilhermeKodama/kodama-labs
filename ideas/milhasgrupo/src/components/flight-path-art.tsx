export function FlightPathArt({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 600 400"
      aria-hidden
      className={className}
      preserveAspectRatio="xMidYMid meet"
    >
      <path
        d="M 60 320 Q 300 -40 540 120"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray="4 6"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="60" cy="320" r="4" fill="currentColor" />
      <circle cx="540" cy="120" r="6" fill="currentColor" />
    </svg>
  );
}
