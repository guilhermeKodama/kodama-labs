import { useTranslations } from 'next-intl';

import { bind, scope } from '@/motion/timeline';
import { COSMOS_LINE_TIMELINE, COSMOS_RUN_TIMELINE } from '@/motion/timelines/cosmos';

import { WIDE } from '../geometry/grid';
import { Echo } from '../primitives/echo';
import { FigureFrame } from '../primitives/figure-frame';
import { Gate } from '../primitives/gate';
import { Label } from '../primitives/label';
import { Hairline, Pad, SpineLine } from '../primitives/lines';
import { Chevron, Panel } from '../primitives/shapes';
import { Strand } from '../primitives/strand';

import {
  LINE_STRAND,
  PULL_REQUEST,
  RETURN,
  RUN,
  STATION,
  STATIONS,
  TRANSCRIPT,
  delivery,
  stationX,
} from './cosmos-data';

const HEIGHT = 372;
const line = bind(COSMOS_LINE_TIMELINE);
const run = bind(COSMOS_RUN_TIMELINE);

/** A station: a typed contract, the worker that holds it, and what it delivers. */
function Station({ name, index }: { name: (typeof STATIONS)[number]; index: number }) {
  const t = useTranslations(`figures.cosmos.stations.${name}`);
  const x = stationX(index);
  const left = x + 13.5;

  return (
    <g {...line(`station.${name}`)}>
      <Panel x={x} y={STATION.top} width={STATION.width} height={STATION.height} rx={STATION.rx} />
      <Label face="ui" bold x={left} y={47}>
        {t('name')}
      </Label>
      <Label tone="muted" size="small" anchor="end" x={x + 175.5} y={47}>
        {t('access')}
      </Label>
      <Label size="small" x={left} y={65}>
        {t('worker')}
      </Label>
      <Hairline from={[x, 76.5]} to={[x + STATION.width, 76.5]} />
      <Label tone="muted" size="small" x={left} y={94}>
        {t('delivers1')}
      </Label>
      <Label tone="muted" size="small" x={left} y={109}>
        {t('delivers2')}
      </Label>
    </g>
  );
}

/** Act one: the example line, from an objective to a draft pull request. */
function ExampleLine() {
  const t = useTranslations('figures.cosmos');
  const { card, state, left } = PULL_REQUEST;

  return (
    <g {...scope(COSMOS_LINE_TIMELINE)}>
      <Label tone="muted" x={0} y={14}>
        {t('heads.line')}
      </Label>
      <Label x={WIDE.right} y={14} {...line('held')}>
        {t('heads.gate')}
      </Label>
      {STATIONS.map((name, index) => (
        <Station key={name} name={name} index={index} />
      ))}
      {STATIONS.map((name, index) => {
        const { from, to } = delivery(index);
        return (
          <g key={name} {...line(`delivery.${index}`)}>
            <Pad x={from} y={LINE_STRAND - 10} width={to - from} height={20} />
            <Strand kind="proposed" from={[from, LINE_STRAND]} to={[to, LINE_STRAND]} />
          </g>
        );
      })}
      <Echo shape="check" x={WIDE.spine} y={LINE_STRAND} {...line('wait')} />
      <Gate shape="dot" x={WIDE.spine} y={LINE_STRAND} {...line('gate')} />
      <g {...line('committed')}>
        <Pad x={708} y={LINE_STRAND - 10} width={54} height={20} />
        <Strand kind="committed" from={[710, LINE_STRAND]} to={[760, LINE_STRAND]} />
      </g>
      <g {...line('return')}>
        <Strand kind="quiet" d={RETURN.d} />
        <Chevron points={RETURN.head} />
      </g>
      <Label tone="muted" size="small" anchor="middle" x={RETURN.note.x} y={RETURN.note.y} {...line('return.note')}>
        {t('returns')}
      </Label>

      <g {...line('pull-request')}>
        <Panel {...card} />
        <Label face="ui" bold x={left} y={47}>
          {t('pr.title')}
        </Label>
        <Panel kind="outline" {...state} />
        <Label face="ui-small" anchor="middle" x={state.x + state.width / 2} y={47.5}>
          {t('pr.state')}
        </Label>
        <Label size="small" x={left} y={65}>
          {t('pr.worker')}
        </Label>
        <Hairline from={[card.x, 76.5]} to={[card.x + card.width, 76.5]} />
        <Label tone="muted" size="small" x={left} y={94}>
          {t('pr.line1')}
        </Label>
        <Label tone="muted" size="small" x={left} y={109}>
          {t('pr.line2')}
        </Label>
      </g>
    </g>
  );
}

/** Act two: a real run, where the line stopped and waited for a person. */
function RealRun() {
  const t = useTranslations('figures.cosmos');
  const y = RUN.strand;

  return (
    <g {...scope(COSMOS_RUN_TIMELINE)}>
      <Label tone="muted" x={0} y={196}>
        {t('heads.run')}
      </Label>
      <Panel {...RUN.panel} {...run('transcript')} />
      {TRANSCRIPT.map((entry) => (
        <Label key={entry.key} tone={entry.quiet ? 'muted' : 'ink'} x={entry.x} y={entry.y} {...run(`line.${entry.key}`)}>
          {t(`run.lines.${entry.key}`)}
        </Label>
      ))}
      <g {...run('stop')}>
        <Pad x={641} y={y - 10} width={54} height={20} />
        <Strand kind="proposed" from={[641, y]} to={[695, y]} />
      </g>
      <Gate shape="ring" x={WIDE.spine} y={y} {...run('gate')} />
      <Label x={WIDE.right} y={269} {...run('held')}>
        {t('run.gate')}
      </Label>
      <g {...run('resumed')}>
        <Pad x={707} y={y - 10} width={175} height={20} />
        <Strand kind="committed" from={[709, y]} to={[880, y]} />
      </g>
      <Label x={892} y={285.5} {...run('resumed.label')}>
        {t('run.resumed')}
      </Label>
      <g {...run('after')}>
        <Label tone="muted" x={WIDE.right} y={317}>
          {t('run.then')}
        </Label>
        <Label tone="muted" x={WIDE.right} y={335}>
          {t('run.sofar')}
        </Label>
      </g>
    </g>
  );
}

/** Cosmos: a production line of agents, and a real run of it that needed a person. */
export function CosmosFigure() {
  const t = useTranslations('figures.cosmos');

  return (
    <FigureFrame sheet={WIDE} height={HEIGHT} alt={t('alt')}>
      <SpineLine x={WIDE.spine} height={HEIGHT} />
      <ExampleLine />
      <RealRun />
    </FigureFrame>
  );
}
