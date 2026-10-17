import { useTranslations } from 'next-intl';

import { StripRow } from '@/components/layout/strip-row';
import { StatusLine } from '@/components/status-line';
import type { Facts } from '@/content/facts';
import { SECTIONS } from '@/content/links';
import { RICH } from '@/content/rich';
import { SHOW_LEARNING_FILTER } from '@/content/site';
import { PlaybookFigure } from '@/figures/playbook/playbook-figure';
import { TriageFigure } from '@/figures/triage/triage-figure';

const ENTRY_TITLE = 'font-display text-h3 font-medium';
const ENTRY_TEXT = 'text-small text-pretty';

/** Smaller systems, in a lighter register than the flagships. */
export function Lab({ facts }: { facts: Facts }) {
  const t = useTranslations('lab');
  const mode = facts.triageMode;

  return (
    <section id={SECTIONS.lab} aria-labelledby="lab-title" className="pt-37.5">
      <h2 id="lab-title" className="font-display text-h2-sm font-normal wide:max-w-[57.5%]">
        {t('title')}
      </h2>

      {SHOW_LEARNING_FILTER ? (
        <StripRow
          id={SECTIONS.triage}
          text={
            <>
              <h3 className={ENTRY_TITLE}>{t('triage.title')}</h3>
              <p className={ENTRY_TEXT}>{t('triage.body')}</p>
              <StatusLine
                className="mt-0.5"
                segments={[
                  t('triage.status.private'),
                  t('triage.status.built'),
                  mode.known ? t(`triage.status.${mode.value}`) : null,
                ]}
              />
            </>
          }
          figure={<TriageFigure />}
        />
      ) : null}

      <StripRow
        id={SECTIONS.playbook}
        text={
          <>
            <h3 className={ENTRY_TITLE}>{t('playbook.title')}</h3>
            <p className={ENTRY_TEXT}>{t('playbook.body')}</p>
            <p className={ENTRY_TEXT}>{t.rich('playbook.milhas', RICH)}</p>
            <p className={ENTRY_TEXT}>{t.rich('playbook.fire', RICH)}</p>
          </>
        }
        figure={
          <div className="flex flex-col gap-6">
            <PlaybookFigure verdict={facts.milhasVerdict} />
            <p data-ink="wait" className="font-display text-quote font-medium text-balance wide:ml-[40.2%]">
              {t('playbook.quote')}
            </p>
          </div>
        }
      />
    </section>
  );
}
