import { useTranslations } from 'next-intl';

import { ReplayButton } from '@/components/controls/replay-button';
import { SplitRow } from '@/components/layout/split-row';
import { RICH } from '@/content/rich';

interface FlagshipProps {
  id: string;
  /** Key of the project under the `work` messages. */
  name: 'capital' | 'sentinel' | 'cosmos';
  figure: React.ReactNode;
  /** Ids of the figure's timelines, for its replay control. */
  plays: readonly string[];
  status: React.ReactNode;
}

/**
 * One flagship project, written as a decision record: what it is and the
 * proof on the left of the spine; what must not happen, the rule, its cost and
 * the option not taken on the right; then the figure and a dated status.
 */
export function Flagship({ id, name, figure, plays, status }: FlagshipProps) {
  const t = useTranslations(`work.${name}`);
  const controls = useTranslations('site.controls');
  const titleId = `${id}-title`;

  return (
    <section id={id} aria-labelledby={titleId} className="pt-37.5">
      <SplitRow
        main={
          <>
            <h2 id={titleId} className="font-display text-h2-sm font-normal wide:text-h2">
              {t('title')}
            </h2>
            <p className="mt-5 max-w-[580px] text-pretty">{t('intro')}</p>
            <p className="mt-4 max-w-[580px] text-small text-pretty">{t('proof')}</p>
          </>
        }
        side={
          <div className="flex flex-col gap-3.5 wide:pt-2.5">
            <p className="text-small">{t.rich('mustNot', RICH)}</p>
            <p data-ink="wait" className="font-display text-statement font-medium text-balance">
              {t('rule')}
            </p>
            <p className="text-small text-pretty">{t('explain')}</p>
            <p className="text-small">{t.rich('cost', RICH)}</p>
            <p className="text-small">{t.rich('notTaken', RICH)}</p>
          </div>
        }
      />
      <div className="mt-12">{figure}</div>
      <div className="mt-5 grid grid-cols-[minmax(0,1fr)] gap-y-2 wide:grid-cols-(--kl-tracks)">
        <div className="order-last flex items-start wide:order-none wide:col-span-3">
          <ReplayButton figures={plays} label={controls('replay')} />
        </div>
        <div className="wide:col-start-5">{status}</div>
      </div>
    </section>
  );
}
