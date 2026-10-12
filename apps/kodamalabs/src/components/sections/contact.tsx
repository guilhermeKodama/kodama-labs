import { useTranslations } from 'next-intl';

import { CopyButton } from '@/components/controls/copy-button';
import { SplitRow } from '@/components/layout/split-row';
import type { Facts } from '@/content/facts';
import { EMAIL, LINKS, SECTIONS } from '@/content/links';

/** The page ends on a plain address. No form. */
export function Contact({ facts }: { facts: Facts }) {
  const t = useTranslations('contact');
  const hero = useTranslations('hero.facts');
  const controls = useTranslations('site.controls');

  return (
    <section id={SECTIONS.contact} aria-labelledby="contact-title" className="pt-32.5">
      <SplitRow
        align="end"
        main={
          <div className="flex flex-col gap-4.5">
            <h2 id="contact-title" className="font-display text-h2-sm font-normal">
              {t('title')}
            </h2>
            <div className="flex flex-wrap items-baseline gap-x-5 self-start">
              <a href={LINKS.email} className="font-display text-mail-sm font-normal underline-offset-8 wide:text-mail">
                {EMAIL}
              </a>
              <CopyButton text={EMAIL} label={controls('copy')} done={controls('copied')} />
            </div>
          </div>
        }
        side={
          <div className="flex flex-col gap-3.5 wide:pb-2">
            <p className="text-pretty">
              {facts.openTo.known ? t('noteOpenTo', { openTo: hero('openTo.value') }) : t('note')}
            </p>
            <div className="flex flex-wrap gap-x-6 gap-y-1.5">
              <a href={LINKS.github}>{t('github')}</a>
              <a href={LINKS.linkedin}>{t('linkedin')}</a>
              {facts.cvUrl.known ? <a href={facts.cvUrl.value}>{t('cv')}</a> : null}
            </div>
          </div>
        }
      />
    </section>
  );
}
