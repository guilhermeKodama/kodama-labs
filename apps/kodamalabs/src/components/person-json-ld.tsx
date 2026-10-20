import { useTranslations } from 'next-intl';

import { EMAIL, LINKS, SITE_URL } from '@/content/links';

/**
 * Who this page is about, as schema.org data for search engines. The same
 * facts the page shows, nothing more.
 */
export function PersonJsonLd() {
  const hero = useTranslations('hero');
  const meta = useTranslations('site.meta');

  const person = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: hero('name'),
    url: SITE_URL,
    jobTitle: hero('facts.role.value'),
    description: meta('description'),
    email: EMAIL,
    sameAs: [LINKS.github, LINKS.linkedin],
  };

  // "<" is escaped so no value can close the script element.
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(person).replace(/</g, '\\u003c') }}
    />
  );
}
