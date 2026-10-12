import { useTranslations } from 'next-intl';

import { EMAIL, LINKS, SECTIONS } from '@/content/links';

import { LanguageLink } from './language-link';
import { Mark } from './mark';

export function SiteHeader() {
  const t = useTranslations('site');

  return (
    <header className="flex h-18 items-center justify-between gap-6 font-mono text-nav">
      <a href={`#${SECTIONS.top}`} className="flex items-center gap-2.5 no-underline">
        <Mark size={20} className="shrink-0" />
        <span>{t('brand')}</span>
      </a>
      <nav aria-label={t('nav.label')} className="hidden items-center gap-7 nav:flex">
        <a href={`#${SECTIONS.capital}`}>{t('nav.work')}</a>
        <a href={`#${SECTIONS.lab}`}>{t('nav.lab')}</a>
        <a href={`#${SECTIONS.method}`}>{t('nav.method')}</a>
        <a href={`#${SECTIONS.about}`}>{t('nav.about')}</a>
        <LanguageLink />
        <a href={LINKS.email}>{EMAIL}</a>
      </nav>
    </header>
  );
}
