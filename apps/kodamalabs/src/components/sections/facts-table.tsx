import { useTranslations } from 'next-intl';

import { Rule } from '@/components/layout/rule';
import type { Facts } from '@/content/facts';
import { EMAIL, LINKS } from '@/content/links';
import { bind } from '@/motion/timeline';
import { INTRO_TIMELINE } from '@/motion/timelines/intro';

const m = bind(INTRO_TIMELINE);

interface Fact {
  label: string;
  value: React.ReactNode;
}

/** The ruled facts beside the lede: the answers a hiring reader looks for first. */
export function FactsTable({ facts }: { facts: Facts }) {
  const t = useTranslations('hero.facts');

  const rows: Fact[] = [
    {
      label: t('role.label'),
      value: facts.employer.known ? t('role.valueAt', { employer: facts.employer.value }) : t('role.value'),
    },
    { label: t('based.label'), value: t('based.value') },
    { label: t('experience.label'), value: t('experience.value') },
    ...(facts.openTo.known ? [{ label: t('openTo.label'), value: t('openTo.value') }] : []),
    {
      label: t('contact.label'),
      value: (
        <span className="flex flex-wrap gap-x-3.5 gap-y-1">
          <a href={LINKS.email}>{EMAIL}</a>
          <a href={LINKS.github}>{t('contact.github')}</a>
          <a href={LINKS.linkedin}>{t('contact.linkedin')}</a>
          {facts.cvUrl.known ? <a href={facts.cvUrl.value}>{t('contact.cv')}</a> : null}
        </span>
      ),
    },
  ];

  // One hairline above each row and one under the last. They are drawn in
  // when the page loads, so they are elements, with a pixel of padding each.
  return (
    <dl className="flex flex-col pb-px">
      {rows.map((row, index) => (
        <div
          key={row.label}
          className="relative grid grid-cols-[78px_minmax(0,1fr)] items-baseline gap-3 pt-[9px] pb-[7px]"
        >
          <dt className="font-mono text-label text-muted">
            <Rule {...m(`facts.rule.${index}`)} />
            {index === rows.length - 1 ? <Rule edge="below" {...m(`facts.rule.${rows.length}`)} /> : null}
            {row.label}
          </dt>
          <dd className="text-fact">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
