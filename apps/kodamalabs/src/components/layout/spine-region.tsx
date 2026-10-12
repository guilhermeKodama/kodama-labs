import { bind, scope } from '@/motion/timeline';
import { LANES_TIMELINE } from '@/motion/timelines/lanes';
import { SPINE_TIMELINE } from '@/motion/timelines/spine';

const m = bind(SPINE_TIMELINE);

/**
 * The part of the page the spine runs through: from the first figure to the
 * end of Method. The line itself sits behind the content at 58.5% of the
 * container; text never crosses it, figures draw their gates on top of it.
 * It is inked in together with the first figure.
 *
 * Below the `wide` breakpoint there is no page-level spine; each figure keeps
 * its own.
 */
export function SpineRegion({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative mt-4.5 pb-12">
      <div
        aria-hidden="true"
        className="absolute top-0 bottom-0 left-(--kl-spine-x) z-0 hidden w-px wide:block"
        {...scope(SPINE_TIMELINE, LANES_TIMELINE)}
      >
        <div data-part="spine" className="h-full bg-accent" {...m('spine.page')} />
      </div>
      <div className="relative z-1">{children}</div>
    </div>
  );
}
