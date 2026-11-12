interface StripRowProps {
  id: string;
  /** Left: track 1, 32% of the container. */
  text: React.ReactNode;
  /** Right: tracks 3-5, 66% of the container, crossed by the spine. */
  figure: React.ReactNode;
}

/**
 * A lighter row for the smaller systems: a short text beside a strip figure,
 * under a hairline that crosses the spine. Stacks below the `wide` breakpoint.
 */
export function StripRow({ id, text, figure }: StripRowProps) {
  return (
    <div
      id={id}
      className="mt-14 grid grid-cols-[minmax(0,1fr)] gap-y-6 border-t border-rule pt-8 wide:grid-cols-(--kl-tracks) wide:items-start"
    >
      <div className="flex flex-col gap-2.5">{text}</div>
      <div className="wide:col-span-3 wide:col-start-3">{figure}</div>
    </div>
  );
}
