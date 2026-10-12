import { useFormatter, useTranslations } from 'next-intl';

import { SplitRow } from '@/components/layout/split-row';
import { StripRow } from '@/components/layout/strip-row';
import { StatusLine } from '@/components/status-line';
import { isoDay } from '@/content/dates';
import { SECTIONS } from '@/content/links';
import { MERGED_PULL_REQUESTS } from '@/content/site';
import { FigureSlot } from '@/figures/figure-slot';

const ENTRY_TITLE = 'font-display text-h3 font-medium';
const ENTRY_TEXT = 'text-small text-pretty';

/** How the work gets made and kept running: coding agents, and his own machine. */
export function Method() {
  const t = useTranslations('method');
  const figures = useTranslations('figures');
  const format = useFormatter();

  // "10 Oct": day first in every locale, as in a changelog.
  const dayMonth = (date: string) => {
    const day = format.dateTime(isoDay(date), { day: '2-digit', timeZone: 'UTC' });
    const month = format.dateTime(isoDay(date), { month: 'short', timeZone: 'UTC' });
    return `${day} ${month}`;
  };
  const reference = (number: number) => `#${number}`;

  return (
    <section id={SECTIONS.method} aria-labelledby="method-title" className="pt-37.5">
      <SplitRow
        main={
          <h2 id="method-title" className="font-display text-h2-sm font-normal text-balance wide:pr-6">
            {t('title')}
          </h2>
        }
        side={
          <div className="flex flex-col gap-0.5 font-display text-habit font-medium wide:pt-1.5">
            <span>{t('habits.incidents')}</span>
            <span>{t('habits.migrations')}</span>
            <span>{t('habits.conventions')}</span>
          </div>
        }
      />

      <StripRow
        id={SECTIONS.agents}
        text={
          <>
            <h3 className={ENTRY_TITLE}>{t('agents.title')}</h3>
            <p className={ENTRY_TEXT}>{t('agents.body')}</p>
          </>
        }
        figure={
          <div className="flex flex-col gap-5">
            <FigureSlot width={792} height={234} alt={figures('agents.alt')} />
            <div className="flex flex-col gap-1 font-mono text-label leading-4.5 wide:ml-[40.2%]">
              <div className="text-muted">{t('agents.merged.label')}</div>
              {MERGED_PULL_REQUESTS.map((pr) => (
                <div key={pr.number} className="grid grid-cols-[52px_30px_minmax(0,1fr)] gap-2.5">
                  <span className="text-muted">{dayMonth(pr.date)}</span>
                  <span className="text-muted">{reference(pr.number)}</span>
                  <span>{t(`agents.merged.pr${pr.number}`)}</span>
                </div>
              ))}
            </div>
          </div>
        }
      />

      <StripRow
        id={SECTIONS.production}
        text={
          <>
            <h3 className={ENTRY_TITLE}>{t('production.title')}</h3>
            <p className={ENTRY_TEXT}>{t('production.body')}</p>
            <StatusLine className="mt-0.5" segments={[t('production.limits')]} />
          </>
        }
        figure={<FigureSlot width={792} height={214} alt={figures('deploy.alt')} />}
      />
    </section>
  );
}
