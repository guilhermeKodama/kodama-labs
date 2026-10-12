import { useFormatter, useTranslations } from 'next-intl';

import { StatusLine } from '@/components/status-line';
import { isoMonth } from '@/content/dates';
import type { Facts } from '@/content/facts';
import { SECTIONS } from '@/content/links';
import { CapitalFigure } from '@/figures/capital/capital-figure';
import { CosmosFigure } from '@/figures/cosmos/cosmos-figure';
import { SentinelFigure } from '@/figures/sentinel/sentinel-figure';

import { Flagship } from './flagship';

/** The three flagship projects, in the order of the lanes of the first figure. */
export function Work({ facts }: { facts: Facts }) {
  const capital = useTranslations('work.capital.status');
  const sentinel = useTranslations('work.sentinel.status');
  const cosmos = useTranslations('work.cosmos.status');
  const format = useFormatter();

  const since = facts.capitalInProductionSince;
  const site = facts.sentinelUrl;

  return (
    <>
      <Flagship
        id={SECTIONS.capital}
        name="capital"
        figure={<CapitalFigure />}
        plays={['capital']}
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
        figure={<SentinelFigure />}
        plays={['sentinel']}
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
        figure={<CosmosFigure />}
        plays={['cosmos-line', 'cosmos-run']}
        status={<StatusLine segments={[cosmos('since'), cosmos('cli'), cosmos('private')]} />}
      />
    </>
  );
}
