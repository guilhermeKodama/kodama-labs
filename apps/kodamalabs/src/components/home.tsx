import { useTranslations } from 'next-intl';

import { SpineRegion } from '@/components/layout/spine-region';
import { About } from '@/components/sections/about';
import { Contact } from '@/components/sections/contact';
import { Hero, HeroLanes } from '@/components/sections/hero';
import { Lab } from '@/components/sections/lab';
import { Method } from '@/components/sections/method';
import { Work } from '@/components/sections/work';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { FACTS, type Facts } from '@/content/facts';
import { SECTIONS } from '@/content/links';

/**
 * The whole homepage. Pure and synchronous, so it renders the same in Next
 * and in a test; `facts` is a parameter so tests can render it with every
 * fact unknown and with every fact known.
 */
export function Home({ facts = FACTS }: { facts?: Facts }) {
  const t = useTranslations('site');

  return (
    <div id={SECTIONS.top} className="kl-container">
      <a
        href={`#${SECTIONS.content}`}
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:bg-ground focus:px-3 focus:py-2 focus:font-mono focus:text-nav"
      >
        {t('skip')}
      </a>
      <SiteHeader />
      <main id={SECTIONS.content}>
        <Hero facts={facts} />
        <SpineRegion>
          <HeroLanes />
          <Work facts={facts} />
          <Lab facts={facts} />
          <Method />
        </SpineRegion>
        <About facts={facts} />
        <Contact facts={facts} />
      </main>
      <SiteFooter facts={facts} />
    </div>
  );
}
