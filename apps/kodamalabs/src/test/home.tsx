import { Home } from '@/components/home';
import { known, unknown, type Facts } from '@/content/facts';
import type { Locale } from '@/i18n/locales';

import { messagesFor, renderWithMessages, type MessageTree } from './render';

export const NOTHING_KNOWN: Facts = {
  employer: unknown(),
  openTo: unknown(),
  cvUrl: unknown(),
  capitalInProductionSince: unknown(),
  sentinelUrl: unknown(),
  milhasVerdict: unknown(),
  buildCommit: unknown(),
  builtAt: unknown(),
};

export const EVERYTHING_KNOWN: Facts = {
  employer: known('Example Company'),
  openTo: known(true),
  cvUrl: known('https://example.com/cv.pdf'),
  capitalInProductionSince: known('2026-02'),
  sentinelUrl: known('https://sentinel.example.com/'),
  milhasVerdict: known({ verdict: 'kill', date: '2026-06-26' }),
  buildCommit: known('abc1234'),
  builtAt: known('2026-10-11'),
};

/** The whole homepage as markup, for a locale and a set of facts. */
export function renderHome(locale: Locale, facts: Facts): string {
  const messages = messagesFor(locale);
  // "What I am open to" is copy the owner has not written yet. When the fact
  // is known the message exists; stand in for it here.
  if (facts.openTo.known) {
    const openTo = ((messages.hero as MessageTree).facts as MessageTree).openTo as MessageTree;
    openTo.value = 'senior engineering roles';
  }

  return renderWithMessages(<Home facts={facts} />, locale, messages);
}
