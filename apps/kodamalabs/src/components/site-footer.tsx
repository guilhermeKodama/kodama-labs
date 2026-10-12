import { useFormatter, useTranslations } from 'next-intl';

import { isoDay } from '@/content/dates';
import type { Facts } from '@/content/facts';

import { MotionToggle } from './controls/motion-toggle';
import { LanguageLink } from './language-link';
import { Mark } from './mark';

/** Imprint, the note about the drawings, and where this build came from. */
export function SiteFooter({ facts }: { facts: Facts }) {
  const t = useTranslations('site.footer');
  const controls = useTranslations('site.controls');
  const format = useFormatter();

  return (
    <footer className="mt-30 grid grid-cols-[minmax(0,1fr)] gap-y-4 border-t border-rule pt-6 pb-14 font-mono text-foot text-muted wide:grid-cols-[23.5fr_2fr_32fr_2fr_40.5fr] wide:items-start">
      <div className="flex items-center gap-2.5">
        <Mark size={16} className="shrink-0" />
        <span>{t('place')}</span>
      </div>
      <p className="wide:col-start-3">{t('note')}</p>
      <div className="flex flex-wrap gap-x-4.5 gap-y-1 wide:col-start-5">
        {facts.buildCommit.known ? <span>{t('commit', { commit: facts.buildCommit.value })}</span> : null}
        {facts.builtAt.known ? (
          <span>
            {t('updated', {
              date: format.dateTime(isoDay(facts.builtAt.value), {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
                timeZone: 'UTC',
              }),
            })}
          </span>
        ) : null}
        <LanguageLink />
        <MotionToggle on={controls('motionOn')} off={controls('motionOff')} />
      </div>
    </footer>
  );
}
