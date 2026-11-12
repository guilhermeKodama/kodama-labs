interface SplitRowProps {
  /** Left of the spine: tracks 1-3, 57.5% of the container. */
  main: React.ReactNode;
  /** Right of the spine: track 5, 40.5% of the container. */
  side?: React.ReactNode;
  /** Vertical alignment of the two columns on wide screens. */
  align?: 'start' | 'end';
  className?: string;
}

/**
 * A row split by the spine. Below the `wide` breakpoint the two columns stack.
 * See src/styles/layout.css for the track template.
 */
export function SplitRow({ main, side, align = 'start', className = '' }: SplitRowProps) {
  const alignment = align === 'end' ? 'wide:items-end' : 'wide:items-start';

  return (
    <div className={`grid grid-cols-[minmax(0,1fr)] gap-y-6 wide:grid-cols-(--kl-tracks) ${alignment} ${className}`}>
      <div className="wide:col-span-3">{main}</div>
      {side ? <div className="wide:col-start-5">{side}</div> : null}
    </div>
  );
}
