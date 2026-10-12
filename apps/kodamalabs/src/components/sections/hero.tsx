import { useTranslations } from 'next-intl';

import { SplitRow } from '@/components/layout/split-row';
import type { Facts } from '@/content/facts';
import { RICH, SpineWords } from '@/content/rich';
import { LanesFigure } from '@/figures/lanes/lanes-figure';
import { bind, scope } from '@/motion/timeline';
import { INTRO_TIMELINE } from '@/motion/timelines/intro';

import { FactsTable } from './facts-table';

const m = bind(INTRO_TIMELINE);

/** The sentence's rich text, with the underline of "this line" drawn in on load. */
const SENTENCE = {
  ...RICH,
  line: (chunks: React.ReactNode) => <SpineWords motion={m('sentence.line')}>{chunks}</SpineWords>,
};

/**
 * Name, lede, facts and the sentence that points at the spine. The words are
 * there from the first frame; only the ruling is drawn in (INTRO_TIMELINE).
 */
export function Hero({ facts }: { facts: Facts }) {
  const t = useTranslations('hero');

  return (
    <div {...scope(INTRO_TIMELINE)}>
      <h1 className="mt-11 font-display text-name-sm font-normal wide:text-name">{t('name')}</h1>
      <SplitRow
        className="mt-7"
        main={<p className="text-lede-sm text-pretty wide:pr-6 wide:text-lede">{t('lede')}</p>}
        side={<FactsTable facts={facts} />}
      />
      <p className="mt-10 text-sentence font-medium text-balance">{t.rich('sentence', SENTENCE)}</p>
    </div>
  );
}

/** The first figure and its legend. The spine starts here. */
export function HeroLanes() {
  const t = useTranslations('hero.legend');

  return (
    <>
      <LanesFigure />
      <div className="mt-3.5 grid grid-cols-[minmax(0,1fr)] gap-y-1 font-mono text-label leading-5 text-muted wide:grid-cols-(--kl-tracks)">
        <div className="flex flex-wrap gap-x-7 gap-y-1 wide:col-span-3">
          <span className="flex items-center gap-2.5">
            <svg width="28" height="8" viewBox="0 0 28 8" aria-hidden="true" className="shrink-0">
              <line x1="0" y1="4" x2="28" y2="4" className="fig-proposed" />
            </svg>
            {t('proposed')}
          </span>
          <span className="flex items-center gap-2.5">
            <svg width="28" height="8" viewBox="0 0 28 8" aria-hidden="true" className="shrink-0">
              <line x1="0" y1="4" x2="28" y2="4" className="fig-committed" />
            </svg>
            {t('committed')}
          </span>
        </div>
        <div className="flex items-center gap-2.5 wide:col-start-5">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className="shrink-0">
            <circle cx="7" cy="7" r="5" className="fig-gate" />
          </svg>
          <span>{t('gate')}</span>
        </div>
      </div>
    </>
  );
}
