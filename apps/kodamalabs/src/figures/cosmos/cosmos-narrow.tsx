import { useTranslations } from 'next-intl';

import { bind, scope } from '@/motion/timeline';
import { COSMOS_LINE_TIMELINE, COSMOS_RUN_TIMELINE } from '@/motion/timelines/cosmos';

import { NARROW, WIDE } from '../geometry/grid';
import { wrapLabel } from '../geometry/wrap';
import { Echo } from '../primitives/echo';
import { FigureFrame } from '../primitives/figure-frame';
import { Gate } from '../primitives/gate';
import { Label, Lines } from '../primitives/label';
import { GateRule, Hairline, Pad } from '../primitives/lines';
import { Chevron, Panel } from '../primitives/shapes';
import { Strand } from '../primitives/strand';

import { STATIONS, TRANSCRIPT } from './cosmos-data';

const line = bind(COSMOS_LINE_TIMELINE);
const run = bind(COSMOS_RUN_TIMELINE);
const W = NARROW.width;

/**
 * The narrow sheet. Act one stacks the three stations; deliveries run down
 * between them, the return loop climbs the right edge, and the gate rule is
 * above the pull request. Act two is below: the transcript, wrapped to the
 * sheet, then its own gate rule.
 */
const STRAND = 60;
/** Where words beside the strand start. */
const BESIDE = 76;

const STATION = { x: 0.5, width: 300, height: 96, top: 40.5, pitch: 124, rx: 8 } as const;
const stationTop = (index: number) => STATION.top + index * STATION.pitch;

const LINE_GATE = 430;
const PULL_REQUEST = { x: 0.5, y: 466.5, width: W - 1, height: 96, rx: 8 } as const;

/** Review hands the work back to implement: up the right edge, into its side. */
const RETURN = (() => {
  const from = stationTop(2) + STATION.height / 2;
  const to = stationTop(1) + STATION.height / 2;
  const edge = STATION.x + STATION.width;
  return {
    d: `M ${edge} ${from} C ${edge + 18} ${from} 328 ${from - 10} 328 ${from - 28} L 328 ${to + 28} C 328 ${to + 10} ${edge + 18} ${to} ${edge + 2} ${to}`,
    head: `${edge + 8},${to - 5} ${edge + 2},${to} ${edge + 8},${to + 5}`,
    note: stationTop(2) - 9,
  };
})();

const RUN_TOP = 590;
const TRANSCRIPT_WIDTH = 42;
const LINE_PITCH = 19;

/** The contents of a card: a head, who holds it, a rule, two lines. */
function Card({ x, top, width, children }: { x: number; top: number; width: number; children: [string, string, string, string] }) {
  const [name, holder, first, second] = children;
  return (
    <>
      <Label face="ui" bold x={x + 13.5} y={top + 22.5}>
        {name}
      </Label>
      <Label size="small" x={x + 13.5} y={top + 40.5}>
        {holder}
      </Label>
      <Hairline from={[x, top + 52]} to={[x + width, top + 52]} />
      <Label tone="muted" size="small" x={x + 13.5} y={top + 69.5}>
        {first}
      </Label>
      <Label tone="muted" size="small" x={x + 13.5} y={top + 84.5}>
        {second}
      </Label>
    </>
  );
}

function ExampleLine() {
  const t = useTranslations('figures.cosmos');
  const pr = PULL_REQUEST;

  return (
    <g {...scope(COSMOS_LINE_TIMELINE)}>
      <GateRule y={LINE_GATE} width={W} />
      <Lines tone="muted" max={49} x={0} y={12}>
        {t('heads.line')}
      </Lines>
      {STATIONS.map((name, index) => {
        const top = stationTop(index);
        return (
          <g key={name} {...line(`station.${name}`)}>
            <Panel x={STATION.x} y={top} width={STATION.width} height={STATION.height} rx={STATION.rx} />
            <Label tone="muted" size="small" anchor="end" x={STATION.x + STATION.width - 14.5} y={top + 22.5}>
              {t(`stations.${name}.access`)}
            </Label>
            <Card x={STATION.x} top={top} width={STATION.width}>
              {[
                t(`stations.${name}.name`),
                t(`stations.${name}.worker`),
                t(`stations.${name}.delivers1`),
                t(`stations.${name}.delivers2`),
              ]}
            </Card>
          </g>
        );
      })}
      {STATIONS.map((name, index) => {
        const from = stationTop(index) + STATION.height + 0.5;
        const to = index === STATIONS.length - 1 ? LINE_GATE - 7.5 : stationTop(index + 1) - 0.5;
        return (
          <g key={name} {...line(`delivery.${index}`, true)}>
            <Pad x={STRAND - 10} y={from} width={20} height={to - from} />
            <Strand kind="proposed" from={[STRAND, from]} to={[STRAND, to]} />
          </g>
        );
      })}
      <g {...line('return', true)}>
        <Strand kind="quiet" d={RETURN.d} />
        <Chevron points={RETURN.head} />
      </g>
      <Label tone="muted" size="small" x={BESIDE} y={RETURN.note} {...line('return.note')}>
        {t('returns')}
      </Label>

      <g {...line('held')}>
        <Lines max={38} x={BESIDE} y={LINE_GATE - 26}>
          {t('heads.gate')}
        </Lines>
      </g>
      <Echo shape="check" x={STRAND} y={LINE_GATE} {...line('wait')} />
      <Gate shape="dot" x={STRAND} y={LINE_GATE} {...line('gate')} />
      <g {...line('committed', true)}>
        <Pad x={STRAND - 10} y={LINE_GATE + 5.5} width={20} height={pr.y - LINE_GATE - 5.5} />
        <Strand kind="committed" from={[STRAND, LINE_GATE + 7.5]} to={[STRAND, pr.y - 0.5]} />
      </g>

      <g {...line('pull-request')}>
        <Panel {...pr} />
        <Panel kind="outline" x={pr.x + pr.width - 62} y={pr.y + 9} width={48} height={20} rx={10} />
        <Label face="ui-small" anchor="middle" x={pr.x + pr.width - 38} y={pr.y + 23}>
          {t('pr.state')}
        </Label>
        <Card x={pr.x} top={pr.y} width={pr.width}>
          {[t('pr.title'), t('pr.worker'), t('pr.line1'), t('pr.line2')]}
        </Card>
      </g>
    </g>
  );
}

function RealRun() {
  const t = useTranslations('figures.cosmos');

  const caption = wrapLabel(t('heads.run'), 49);
  const panelTop = RUN_TOP + 10 + caption.length * 15 + 0.5;
  // Each entry of the transcript, wrapped: a continuation is indented like the wide figure's.
  const wrapped = TRANSCRIPT.map((entry) => wrapLabel(t(`run.lines.${entry.key}`), TRANSCRIPT_WIDTH));
  const entries = TRANSCRIPT.map((entry, index) => ({
    ...entry,
    lines: wrapped[index]!,
    /** How many lines are printed above this entry. */
    first: wrapped.slice(0, index).flat().length,
  }));
  const lineCount = wrapped.flat().length;
  const panelHeight = lineCount * LINE_PITCH + 22;
  const gate = panelTop + panelHeight + 44;

  return (
    <g {...scope(COSMOS_RUN_TIMELINE)}>
      <GateRule y={gate} width={W} />
      <Lines tone="muted" max={49} x={0} y={RUN_TOP + 12}>
        {t('heads.run')}
      </Lines>
      <Panel x={0.5} y={panelTop} width={W - 1} height={panelHeight} rx={8} {...run('transcript')} />
      {entries.map((entry) => (
        <g key={entry.key} {...run(`line.${entry.key}`)}>
          {entry.lines.map((text, index) => (
            <Label
              key={text}
              tone={entry.quiet ? 'muted' : 'ink'}
              x={index === 0 ? entry.x : 30}
              y={panelTop + 24 + (entry.first + index) * LINE_PITCH}
            >
              {text}
            </Label>
          ))}
        </g>
      ))}
      <g {...run('stop', true)}>
        <Pad x={STRAND - 10} y={panelTop + panelHeight} width={20} height={gate - 6.5 - panelTop - panelHeight} />
        <Strand kind="proposed" from={[STRAND, panelTop + panelHeight + 0.5]} to={[STRAND, gate - 6.5]} />
      </g>
      <Gate shape="ring" x={STRAND} y={gate} {...run('gate')} />
      <Label x={BESIDE} y={gate - 10} {...run('held')}>
        {t('run.gate')}
      </Label>
      <g {...run('resumed', true)}>
        <Pad x={STRAND - 10} y={gate + 4.5} width={20} height={42} />
        <Strand kind="committed" from={[STRAND, gate + 6.5]} to={[STRAND, gate + 44]} />
      </g>
      <Label x={BESIDE} y={gate + 30} {...run('resumed.label')}>
        {t('run.resumed')}
      </Label>
      <g {...run('after')}>
        <Label tone="muted" x={0} y={gate + 68}>
          {t('run.then')}
        </Label>
        <Label tone="muted" x={0} y={gate + 84}>
          {t('run.sofar')}
        </Label>
      </g>
    </g>
  );
}

/** How tall the sheet is: act two grows with its wrapped transcript. */
function useHeight(): number {
  const t = useTranslations('figures.cosmos');
  const caption = wrapLabel(t('heads.run'), 49).length;
  const lines = TRANSCRIPT.reduce((count, entry) => count + wrapLabel(t(`run.lines.${entry.key}`), TRANSCRIPT_WIDTH).length, 0);
  return RUN_TOP + 10 + caption * 15 + 0.5 + lines * LINE_PITCH + 22 + 44 + 92;
}

/** Cosmos on a narrow screen: the same two acts, read downward. */
export function CosmosNarrow() {
  const t = useTranslations('figures.cosmos');

  return (
    <FigureFrame sheet={NARROW} beside={WIDE} height={useHeight()} alt={t('alt')}>
      <ExampleLine />
      <RealRun />
    </FigureFrame>
  );
}
