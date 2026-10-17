import { useTranslations } from 'next-intl';

import { bind } from '@/motion/timeline';
import { SENTINEL_TIMELINE } from '@/motion/timelines/sentinel';

import { NARROW, WIDE } from '../geometry/grid';
import { wrapLabel } from '../geometry/wrap';
import { FigureFrame } from '../primitives/figure-frame';
import { Gate } from '../primitives/gate';
import { Label } from '../primitives/label';
import { GateRule, Pad } from '../primitives/lines';
import { Fill, Panel } from '../primitives/shapes';
import { Strand } from '../primitives/strand';

import {
  CANDIDATES,
  PIPELINE,
  PRICE_ENGINE,
  feeds,
  job,
  jobMark,
  lineageRules,
  nodeBox,
  nodeId,
  type Column,
  type PipelineLayout,
} from './sentinel-data';

const m = bind(SENTINEL_TIMELINE);
const W = NARROW.width;

/**
 * The narrow sheet. The pipeline keeps its three columns, with smaller nodes
 * whose names take two lines. Its candidates cannot leave to the right, so
 * they run down a lane beside the last column and fan onto a gate that lies
 * across the sheet. The alert is below it.
 */
const LAYOUT: PipelineLayout = {
  node: { width: 90, height: 34, rx: 6, pitch: 40 },
  columns: {
    sources: { x: 0.5, top: 22.5 },
    steps: { x: 116.5, top: 62.5 },
    engines: { x: 232.5, top: 42.5 },
  },
};
/** Longest line of a node's name, in characters. */
const NAME_WIDTH = 13;

const ENGINES = PIPELINE[2];
const PRICE = nodeBox(ENGINES, (ENGINES.nodes as readonly string[]).indexOf(PRICE_ENGINE), LAYOUT);
const PRICE_Y = PRICE.y + PRICE.height / 2;

const LANE = 331.5;
const GATE = { x: 276, y: 372, slot: 12 } as const;
const CARD_TOP = 404.5;

/** Where candidate `index` meets the gate, left to right. The middle one passes. */
function slot(index: number): number {
  return GATE.x + (index - (CANDIDATES.length - 1) / 2) * GATE.slot;
}

function candidatePath(index: number): string {
  const x = slot(index);
  return `M ${PRICE.x + PRICE.width} ${PRICE_Y} L ${LANE} ${PRICE_Y} L ${LANE} 312 C ${LANE} 344 ${x} 334 ${x} ${GATE.y - 6.5}`;
}

function Node({ column, index, emphasis = false }: { column: Column; index: number; emphasis?: boolean }) {
  const t = useTranslations('figures.sentinel');
  const node = column.nodes[index]!;
  const box = nodeBox(column, index, LAYOUT);
  const lines = wrapLabel(t(`${column.key}.${node}`), NAME_WIDTH);
  const first = box.y + box.height / 2 + 4 - (lines.length - 1) * 6.5;

  return (
    <>
      <Panel kind={emphasis ? 'ink' : 'panel'} {...box} />
      {lines.map((line, position) => (
        <Label key={line} face="ui-small" bold={emphasis} x={box.x + 7.5} y={first + position * 13}>
          {line}
        </Label>
      ))}
    </>
  );
}

function Pipeline() {
  const t = useTranslations('figures.sentinel');

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: lineageRules() }} />
      <g transform="translate(0 0.5)">
        {([0, 1] as const).map((gap) => (
          <g key={gap} {...m(`feeds.${gap}`)}>
            {feeds(gap, LAYOUT).map((feed) => (
              <Strand key={feed.d} kind="quiet" d={feed.d} data-lineage={feed.lineage} />
            ))}
          </g>
        ))}
        {([0, 1] as const).map((gap) => (
          <Strand key={gap} kind="committed" d={job(gap, LAYOUT).d} {...m(`job.${gap}`)} />
        ))}
      </g>
      {PIPELINE.map((column) => (
        <g key={column.key} {...m(`column.${column.key}`)}>
          <Label tone="muted" size="small" x={LAYOUT.columns[column.key].x - 0.5} y={12}>
            {t(`heads.${column.key}`)}
          </Label>
          {column.nodes.map((node, index) =>
            node === PRICE_ENGINE && column.key === 'engines' ? null : (
              <g key={node} className="fig-node" data-node={nodeId(column, node)}>
                <Node column={column} index={index} />
              </g>
            ),
          )}
        </g>
      ))}
      <g {...m('engine')}>
        <Node column={ENGINES} index={(ENGINES.nodes as readonly string[]).indexOf(PRICE_ENGINE)} emphasis />
      </g>
      {([0, 1] as const).map((gap) => (
        <Fill key={gap} tone="ink" {...jobMark(gap, LAYOUT)} r={2.4} {...m(`job.mark.${gap}`)} />
      ))}
    </>
  );
}

/** Sentinel on a narrow screen: the same story, read downward. */
export function SentinelNarrow() {
  const t = useTranslations('figures.sentinel');

  // The card grows with its text; the notes follow it.
  const body = [...wrapLabel(t('alert.body1'), 46), ...wrapLabel(t('alert.body2'), 46)];
  const firstBody = wrapLabel(t('alert.body1'), 46).length;
  const bodyTop = CARD_TOP + 80;
  const cardHeight = 80 + (body.length - 1) * 17 + 16;
  const notes = (['failClosed', 'scope', 'invented'] as const).map((note) => wrapLabel(t(`notes.${note}`), 49));
  const notesTop = CARD_TOP + cardHeight + 24;
  const height = notesTop + notes.flat().length * 15 + (notes.length - 1) * 3;

  return (
    <FigureFrame id="sentinel" sheet={NARROW} beside={WIDE} height={height} alt={t('alt')}>
      <GateRule y={GATE.y} width={W} />
      <Pipeline />

      {CANDIDATES.map((y, index) => (
        <g key={y} {...m(`candidate.${index}`, true)}>
          <Pad x={GATE.x - 40} y={PRICE_Y - 10} width={W - GATE.x + 40} height={GATE.y - PRICE_Y + 4} />
          <Strand kind="proposed" d={candidatePath(index)} />
        </g>
      ))}
      <Gate shape="capsule" across x={GATE.x} y={GATE.y} height={72} {...m('gate')} />
      {/* The evaluator's place among its candidates, while it reads them. */}
      <circle data-part="echo" className="fig-gate m-transient" cx={slot(0)} cy={GATE.y} r={3} {...m('reading', true)} />
      <Label x={0} y={GATE.y - 10} {...m('held')}>
        {t('gate')}
      </Label>
      <g {...m('committed', true)}>
        <Pad x={GATE.x - 10} y={GATE.y + 5} width={20} height={CARD_TOP - GATE.y - 5} />
        <Strand kind="committed" from={[GATE.x, GATE.y + 7]} to={[GATE.x, CARD_TOP - 0.5]} />
      </g>

      <Panel x={0.5} y={CARD_TOP} width={W - 1} height={cardHeight} rx={10} {...m('alert')} />
      <g {...m('alert.tags')}>
        <Panel kind="outline" x={14.5} y={CARD_TOP + 14} width={58} height={20} rx={10} />
        <Label face="ui-small" anchor="middle" x={43.5} y={CARD_TOP + 28}>
          {t('alert.severity')}
        </Label>
        <Fill tone="wash" x={80} y={CARD_TOP + 13.5} width={100} height={21} rx={4} />
        <Label face="ui-small" anchor="middle" x={130} y={CARD_TOP + 28}>
          {t('alert.kind')}
        </Label>
      </g>
      <Label face="ui-large" bold x={14} y={CARD_TOP + 58.5} {...m('alert.title')}>
        {t('alert.title')}
      </Label>
      {([0, 1] as const).map((part) => (
        <g key={part} {...m(`alert.body.${part}`)}>
          {(part === 0 ? body.slice(0, firstBody) : body.slice(firstBody)).map((line, index) => (
            <Label
              key={line}
              face="ui"
              tone="muted"
              x={14}
              y={bodyTop + ((part === 0 ? 0 : firstBody) + index) * 17}
            >
              {line}
            </Label>
          ))}
        </g>
      ))}
      <g {...m('notes')}>
        {notes.flatMap((lines, note) =>
          lines.map((line, index) => (
            <Label
              key={line}
              tone="muted"
              x={0}
              y={notesTop + 10 + (notes.slice(0, note).flat().length + index) * 15 + note * 3}
            >
              {line}
            </Label>
          )),
        )}
      </g>
    </FigureFrame>
  );
}
