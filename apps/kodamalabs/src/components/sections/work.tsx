import { useFormatter, useTranslations } from 'next-intl';

import { StatusLine } from '@/components/status-line';
import { isoMonth } from '@/content/dates';
import type { Facts } from '@/content/facts';
import { SECTIONS } from '@/content/links';
import { FigureSlot } from '@/figures/figure-slot';

import { Flagship } from './flagship';

/** The three flagship projects, in the order of the lanes of the first figure. */
export function Work({ facts }: { facts: Facts }) {
  const capital = useTranslations('work.capital.status');
  const sentinel = useTranslations('work.sentinel.status');
  const cosmos = useTranslations('work.cosmos.status');
  const figures = useTranslations('figures');
  const format = useFormatter();

  const since = facts.capitalInProductionSince;
  const site = facts.sentinelUrl;

  return (
    <>
      <Flagship
        id={SECTIONS.capital}
        name="capital"
        figure={<FigureSlot width={1200} height={368} alt={figures('capital.alt')} />}
        status={
          <StatusLine
            segments={[
              since.known
                ? capital('inProductionSince', {
                    since: format.dateTime(isoMonth(since.value), {
                      month: 'long',
                      year: 'numeric',
                      timeZone: 'UTC',
                    }),
                  })
                : capital('inProduction'),
              capital('private'),
              capital('noDemo'),
            ]}
          />
        }
      />
      <Flagship
        id={SECTIONS.sentinel}
        name="sentinel"
        figure={<FigureSlot width={1200} height={270} alt={figures('sentinel.alt')} />}
        status={
          <StatusLine
            segments={[
              site.known
                ? sentinel.rich('site', {
                    host: new URL(site.value).host,
                    site: (chunks) => <a href={site.value}>{chunks}</a>,
                  })
                : null,
              sentinel('moving'),
            ]}
          />
        }
      />
      <Flagship
        id={SECTIONS.cosmos}
        name="cosmos"
        figure={<FigureSlot width={1200} height={372} alt={figures('cosmos.alt')} />}
        status={<StatusLine segments={[cosmos('since'), cosmos('cli'), cosmos('private')]} />}
      />
    </>
  );
}
