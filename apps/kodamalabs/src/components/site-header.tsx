import { useTranslations } from 'next-intl';

import { EMAIL, LINKS, SECTIONS } from '@/content/links';

import { LanguageLink } from './language-link';
import { Mark } from './mark';

/** A link of the header. Its padding makes it a comfortable target for a thumb without moving the text. */
const NAV_LINK = '-my-2 py-2';

/**
 * The imprint and the way around the page. On a phone the section links stay,
 * closer together, and wrap under the imprint if they must; the address is
 * left to the facts just below, where it is the first thing in reach.
 */
export function SiteHeader() {
  const t = useTranslations('site');

  return (
    <header className="flex min-h-18 flex-wrap items-center justify-between gap-x-4 gap-y-2 py-4 font-mono text-nav nav:gap-x-6">
      <a href={`#${SECTIONS.top}`} className={`flex items-center gap-2.5 no-underline ${NAV_LINK}`}>
        <Mark size={20} className="shrink-0" />
        <span>{t('brand')}</span>
      </a>
      <nav aria-label={t('nav.label')} className="flex flex-wrap items-center gap-x-3.5 gap-y-2 nav:gap-x-7">
        <a href={`#${SECTIONS.capital}`} className={NAV_LINK}>
          {t('nav.work')}
        </a>
        <a href={`#${SECTIONS.lab}`} className={NAV_LINK}>
          {t('nav.lab')}
        </a>
        <a href={`#${SECTIONS.method}`} className={NAV_LINK}>
          {t('nav.method')}
        </a>
        <a href={`#${SECTIONS.about}`} className={NAV_LINK}>
          {t('nav.about')}
        </a>
        <LanguageLink />
        <a href={LINKS.email} className={`hidden nav:inline ${NAV_LINK}`}>
          {EMAIL}
        </a>
      </nav>
    </header>
  );
}
