/**
 * The part of the page the spine runs through: from the first figure to the
 * end of Method. The line itself sits behind the content at 58.5% of the
 * container; text never crosses it, figures draw their gates on top of it.
 * With motion it is inked as far as the reader has scrolled (src/motion).
 *
 * Below the `wide` breakpoint there is no page-level spine; each figure keeps
 * its own.
 */
export function SpineRegion({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative mt-4.5 pb-12">
      <div
        aria-hidden="true"
        data-part="spine"
        data-spine=""
        className="absolute top-0 bottom-0 left-(--kl-spine-x) z-0 hidden w-px bg-accent wide:block"
      />
      <div className="relative z-1">{children}</div>
    </div>
  );
}
