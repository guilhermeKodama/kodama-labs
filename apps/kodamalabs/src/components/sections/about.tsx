import { useTranslations } from 'next-intl';

import { SplitRow } from '@/components/layout/split-row';
import type { Facts } from '@/content/facts';
import { SECTIONS } from '@/content/links';
import { RICH } from '@/content/rich';
import { EARLIER_WORK } from '@/content/site';

/** Who he is and where he came from, after the work rather than before it. */
export function About({ facts }: { facts: Facts }) {
  const t = useTranslations('about');
  const intro = facts.employer.known
    ? `${t('intro')} ${t('current', { employer: facts.employer.value })}`
    : t('intro');

  return (
    <section id={SECTIONS.about} aria-labelledby="about-title" className="pt-27.5">
      <SplitRow
        main={
          <div className="flex flex-col gap-4.5">
            <h2 id="about-title" className="mb-1.5 font-display text-h2-sm font-normal">
              {t('title')}
            </h2>
            <p className="max-w-[600px] text-pretty">{intro}</p>
            <p className="max-w-[600px] text-pretty">{t('path')}</p>
          </div>
        }
        side={
          <div className="flex flex-col border-b border-rule wide:pt-3">
            <div className="pb-2.5 font-mono text-label leading-5 text-muted">{t('earlier.label')}</div>
            {EARLIER_WORK.map((item) => (
              <div
                key={item.key}
                className="grid grid-cols-[88px_minmax(0,1fr)] items-baseline gap-3 border-t border-rule py-2.5"
              >
                <span className="font-mono text-status leading-6 text-muted">{item.years}</span>
                <span className="text-list">{t.rich(`earlier.${item.key}`, RICH)}</span>
              </div>
            ))}
          </div>
        }
      />
    </section>
  );
}
