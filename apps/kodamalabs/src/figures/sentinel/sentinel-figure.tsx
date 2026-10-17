import { useTranslations } from 'next-intl';

import { bind } from '@/motion/timeline';
import { SENTINEL_TIMELINE } from '@/motion/timelines/sentinel';

import { WIDE } from '../geometry/grid';
import { FigureFrame } from '../primitives/figure-frame';
import { Gate } from '../primitives/gate';
import { Label } from '../primitives/label';
import { Pad, SpineLine } from '../primitives/lines';
import { Fill, Panel } from '../primitives/shapes';
import { Strand } from '../primitives/strand';

import {
  ALERT,
  CANDIDATES,
  PIPELINE,
  PRICE_ENGINE,
  STRAND,
  candidatePath,
  feeds,
  job,
  jobMark,
  lineageRules,
  nodeBox,
  nodeId,
  nodeLabel,
} from './sentinel-data';
import { SentinelNarrow } from './sentinel-narrow';

const HEIGHT = 270;
const m = bind(SENTINEL_TIMELINE);

/**
 * Records, steps and engines, and the one job the figure follows through
 * them. Pointing at a node traces what feeds it and what it feeds.
 */
function Pipeline() {
  const t = useTranslations('figures.sentinel');

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: lineageRules() }} />
      <g transform="translate(0 0.5)">
        {([0, 1] as const).map((gap) => (
          <g key={gap} {...m(`feeds.${gap}`)}>
            {feeds(gap).map((feed) => (
              <Strand key={feed.d} kind="quiet" d={feed.d} data-lineage={feed.lineage} />
            ))}
          </g>
        ))}
        {([0, 1] as const).map((gap) => (
          <Strand key={gap} kind="committed" d={job(gap).d} {...m(`job.${gap}`)} />
        ))}
      </g>
      {PIPELINE.map((column) => (
        <g key={column.key} {...m(`column.${column.key}`)}>
          <Label tone="muted" x={nodeBox(column, 0).x - 0.5} y={18}>
            {t(`heads.${column.key}`)}
          </Label>
          {column.nodes.map((node, index) =>
            node === PRICE_ENGINE && column.key === 'engines' ? null : (
              <g key={node} className="fig-node" data-node={nodeId(column, node)}>
                <Panel {...nodeBox(column, index)} />
                <Label face="ui-small" {...nodeLabel(column, index)}>
                  {t(`${column.key}.${node}`)}
                </Label>
              </g>
            ),
          )}
        </g>
      ))}
      {PIPELINE.filter((column) => column.key === 'engines').map((column) => {
        const index = (column.nodes as readonly string[]).indexOf(PRICE_ENGINE);
        return (
          <g key={column.key} {...m('engine')}>
            <Panel kind="ink" {...nodeBox(column, index)} />
            <Label face="ui-small" bold {...nodeLabel(column, index)}>
              {t(`engines.${PRICE_ENGINE}`)}
            </Label>
          </g>
        );
      })}
      {([0, 1] as const).map((gap) => (
        <Fill key={gap} tone="ink" {...jobMark(gap)} r={2.4} {...m(`job.mark.${gap}`)} />
      ))}
    </>
  );
}

/** What the confirmed candidate becomes: an alert written as a point to review. */
function Alert() {
  const t = useTranslations('figures.sentinel');
  const { card, severity, kind, left } = ALERT;

  return (
    <>
      <Panel {...card} {...m('alert')} />
      <g {...m('alert.tags')}>
        <Panel kind="outline" {...severity} />
        <Label face="ui-small" anchor="middle" x={severity.x + severity.width / 2} y={120.5}>
          {t('alert.severity')}
        </Label>
        <Fill tone="wash" {...kind} />
        <Label face="ui-small" anchor="middle" x={kind.x + kind.width / 2} y={120.5}>
          {t('alert.kind')}
        </Label>
      </g>
      <Label face="ui-large" bold x={left} y={151} {...m('alert.title')}>
        {t('alert.title')}
      </Label>
      <Label face="ui" tone="muted" x={left} y={172} {...m('alert.body.0')}>
        {t('alert.body1')}
      </Label>
      <Label face="ui" tone="muted" x={left} y={190} {...m('alert.body.1')}>
        {t('alert.body2')}
      </Label>
      <g {...m('notes')}>
        <Label tone="muted" x={760} y={ALERT.notes[0]}>
          {t('notes.failClosed')}
        </Label>
        <Label tone="muted" x={760} y={ALERT.notes[1]}>
          {t('notes.scope')}
        </Label>
        <Label tone="muted" x={760} y={ALERT.notes[2]}>
          {t('notes.invented')}
        </Label>
      </g>
    </>
  );
}

/** Sentinel: a pipeline over public records, an evaluator that fails closed, one alert. */
export function SentinelWide() {
  const t = useTranslations('figures.sentinel');

  return (
    <FigureFrame id="sentinel" sheet={WIDE} height={HEIGHT} alt={t('alt')}>
      <SpineLine x={WIDE.spine} height={HEIGHT} />
      <Pipeline />

      {CANDIDATES.map((y, index) => (
        <g key={y} {...m(`candidate.${index}`)}>
          <Pad x={599} y={STRAND - 30} width={97} height={60} />
          <Strand kind="proposed" d={candidatePath(y)} />
        </g>
      ))}
      <Gate shape="capsule" x={WIDE.spine} y={STRAND} height={72} {...m('gate')} />
      {/* The evaluator's place among its candidates, while it reads them. */}
      <circle data-part="echo" className="fig-gate m-transient" cx={WIDE.spine} cy={CANDIDATES[0]} r={3} {...m('reading')} />
      <Label x={WIDE.right} y={78} {...m('held')}>
        {t('gate')}
      </Label>
      <g {...m('committed')}>
        <Pad x={707} y={STRAND - 10} width={55} height={20} />
        <Strand kind="committed" from={[709, STRAND]} to={[760, STRAND]} />
      </g>

      <Alert />
    </FigureFrame>
  );
}

/** The Sentinel figure: drawn across on a wide screen, downward on a narrow one. */
export function SentinelFigure() {
  return (
    <>
      <SentinelWide />
      <SentinelNarrow />
    </>
  );
}
