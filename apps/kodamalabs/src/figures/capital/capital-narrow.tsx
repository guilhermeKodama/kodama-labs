import { useTranslations } from 'next-intl';

import { FigureControl } from '@/motion/figure-control';
import { bind, scope } from '@/motion/timeline';
import { CAPITAL_FLOW_AT, CAPITAL_HOLD_AT, CAPITAL_TIMELINE } from '@/motion/timelines/capital';

import { NARROW, WIDE } from '../geometry/grid';
import { Echo } from '../primitives/echo';
import { FigureFrame } from '../primitives/figure-frame';
import { Gate } from '../primitives/gate';
import { Label, Lines } from '../primitives/label';
import { GateRule, Hairline, Pad } from '../primitives/lines';
import { Chevron, Fill, Panel } from '../primitives/shapes';
import { Strand } from '../primitives/strand';

import { ACTIVE_VIEW, FLOW_NODES, PLAN_ROWS, VIEWS, flowRibbons, nodeBox } from './capital-data';

const m = bind(CAPITAL_TIMELINE);
const W = NARROW.width;

/**
 * The narrow sheet, top to bottom: the plan, the strand that leaves its
 * button, the gate rule, the ledger, the cash flow. A row of the plan takes
 * two lines, since its five columns do not fit side by side.
 */
const PLAN = {
  panel: { x: 0.5, y: 0.5, width: W - 1, height: 340, rx: 8 },
  left: 14,
  right: W - 14,
  headRule: 54.5,
  rowPitch: 42,
  footRule: 296.5,
  button: { x: 212, y: 304.5, width: 114, height: 28, rx: 6 },
} as const;

/** The strand leaves the middle of the button and runs down the sheet. */
const STRAND = PLAN.button.x + PLAN.button.width / 2;
const GATE = 384;
const LEDGER_END = 426;

const UNDO = {
  d: `M ${STRAND} ${LEDGER_END} C ${STRAND + 21} ${LEDGER_END} 304 418 304 398 L 304 347`,
  head: '299,353 304,347 309,353',
} as const;

/** The cash flow keeps its heights and loses width: the columns move together. */
const FLOW = {
  columns: [0, 74, 148, 222],
  /** How far down the sheet the wide chart's coordinates are moved. */
  dy: 456,
  /** Where a column's names start: in the gap after its bars. */
  nameOffset: 16,
} as const;

const HEIGHT = 796;

function ImportPlan() {
  const t = useTranslations('figures.capital');
  const { panel, left, right } = PLAN;
  const end = panel.x + panel.width;

  return (
    <>
      <g {...m('plan.frame')}>
        <Panel {...panel} />
        <Label face="ui" bold x={left} y={24}>
          {t('plan.title')}
        </Label>
        <Label tone="muted" anchor="end" x={right} y={24}>
          {t('plan.count')}
        </Label>
        <Label tone="muted" x={left} y={42}>
          {t('plan.state')}
        </Label>
        <Hairline from={[panel.x, PLAN.headRule]} to={[end, PLAN.headRule]} />
        <Hairline from={[panel.x, PLAN.footRule]} to={[end, PLAN.footRule]} />
      </g>
      {PLAN_ROWS.map((row, index) => {
        const top = PLAN.headRule + index * PLAN.rowPitch;
        return (
          <g key={row} {...m(`plan.row.${row}`)}>
            <Pad x={left} y={top + 2} width={right - left} height={PLAN.rowPitch - 2} />
            <Label face="ui" tone="muted" x={left} y={top + 18}>
              {t(`rows.${row}.what`)}
            </Label>
            <Label tone="muted" anchor="end" x={right} y={top + 18}>
              {t(`rows.${row}.amount`)}
            </Label>
            <Label tone="muted" size="small" x={left} y={top + 33}>
              {t(`rows.${row}.date`)}
            </Label>
            <Label face="ui-small" tone="muted" x={left + 52} y={top + 33}>
              {t(`rows.${row}.account`)}
            </Label>
            <Label face="ui-small" tone="muted" anchor="end" x={right} y={top + 33}>
              {t(`rows.${row}.category`)}
            </Label>
            <Hairline dashed from={[left, top + 41.5]} to={[right, top + 41.5]} />
          </g>
        );
      })}
      <Label tone="muted" x={left} y={284} {...m('plan.more')}>
        {t('plan.more')}
      </Label>
      <Label tone="muted" x={left} y={323} {...m('plan.waiting')}>
        {t('plan.waiting')}
      </Label>
      <FigureControl act="confirm" at={CAPITAL_HOLD_AT} label={t('controls.confirm')}>
        <g {...m('confirm')}>
          <Fill tone="ink" {...PLAN.button} />
          <Label face="ui" bold tone="inverse" anchor="middle" x={STRAND} y={323}>
            {t('plan.confirm')}
          </Label>
        </g>
      </FigureControl>
    </>
  );
}

/** A node's name, and its amount when it has one, each on a line of its own. */
function nameAndAmount(label: string): string[] {
  const space = label.lastIndexOf(' ');
  return /^\d/.test(label.slice(space + 1)) ? [label.slice(0, space), label.slice(space + 1)] : [label];
}

function CashFlow() {
  const t = useTranslations('figures.capital');
  const { columns, dy } = FLOW;
  const ribbons = flowRibbons(columns);
  const last = columns.length - 1;

  return (
    <>
      <g {...m('views')}>
        {VIEWS.map((view) => (
          <Label
            key={view.key}
            face="ui"
            tone={view.key === ACTIVE_VIEW.key ? 'ink' : 'muted'}
            x={view.x - VIEWS[0].x}
            y={484}
          >
            {t(`views.${view.key}`)}
          </Label>
        ))}
        <Hairline from={[0, 492.5]} to={[W, 492.5]} />
        <Strand
          kind="trunk"
          from={[VIEWS.find((view) => view.key === ACTIVE_VIEW.key)!.x - VIEWS[0].x, 492]}
          to={[ACTIVE_VIEW.end - VIEWS[0].x, 492]}
        />
      </g>
      <g transform={`translate(0 ${dy})`}>
        {columns.slice(0, -1).map((x, column) => (
          <g key={x} {...m(`flow.ribbons.${column}`)}>
            {ribbons
              .filter((ribbon) => ribbon.column === column)
              .map((ribbon) => (
                <Fill key={ribbon.d} tone="wash" d={ribbon.d} />
              ))}
          </g>
        ))}
        {columns.map((x, column) => (
          <g key={x} {...m(`flow.nodes.${column}`)}>
            {FLOW_NODES.filter((node) => node.column === column).map((node) => (
              <Fill key={node.key} tone={node.tone} {...nodeBox(node, columns)} />
            ))}
          </g>
        ))}
        {columns.map((x, column) => (
          <g key={x} {...m(`flow.names.${column}`)}>
            {FLOW_NODES.filter((node) => node.column === column).flatMap((node) => {
              // The last column has room beside it for the whole name on one line.
              const lines = column === last ? [t(`flow.${node.key}`)] : nameAndAmount(t(`flow.${node.key}`));
              const first = node.label.y - (lines.length - 1) * 6;
              return lines.map((line, index) => (
                <Label key={`${node.key}.${index}`} face="ui-small" x={x + FLOW.nameOffset} y={first + index * 13}>
                  {line}
                </Label>
              ));
            })}
          </g>
        ))}
      </g>
    </>
  );
}

/**
 * Capital on a narrow screen: the same story, read downward. The sheet is
 * taller than a phone, so it plays in two acts: the plan, the gate and the
 * ledger, and then, when the reader reaches it, the cash flow.
 */
export function CapitalNarrow() {
  const t = useTranslations('figures.capital');
  const bottom = PLAN.panel.y + PLAN.panel.height;

  return (
    <FigureFrame sheet={NARROW} beside={WIDE} height={HEIGHT} alt={t('alt')}>
      <g {...scope(CAPITAL_TIMELINE)}>
        <GateRule y={GATE} width={W} />
        <ImportPlan />

        <g {...m('proposal', true)}>
          <Pad x={STRAND - 10} y={bottom} width={20} height={GATE - 7.5 - bottom} />
          <Strand kind="proposed" from={[STRAND, bottom]} to={[STRAND, GATE - 7.5]} />
        </g>
        <Echo shape="wait" x={STRAND} y={GATE} {...m('wait')} />
        <Gate shape="dot" x={STRAND} y={GATE} {...m('gate')} />
        <Echo shape="ripple" x={STRAND} y={GATE} {...m('echo')} />
        <Label x={0} y={GATE - 10} {...m('held')}>
          {t('gate')}
        </Label>

        <g {...m('committed', true)}>
          <Pad x={STRAND - 10} y={GATE + 5.5} width={20} height={LEDGER_END - GATE - 3.5} />
          <Strand kind="committed" from={[STRAND, GATE + 7.5]} to={[STRAND, LEDGER_END]} />
        </g>
        <Label anchor="end" x={STRAND - 12} y={LEDGER_END - 6} {...m('ledger')}>
          {t('ledger')}
        </Label>
        <g {...m('undo', true)}>
          <Strand kind="quiet" d={UNDO.d} />
          <Chevron points={UNDO.head} />
        </g>
        <FigureControl act="undo" at={CAPITAL_HOLD_AT} label={t('controls.undo')}>
          {/* Room for a thumb around one line of text. */}
          <Pad x={0} y={430} width={190} height={30} />
          <Label tone="muted" x={0} y={448} {...m('undo.note')}>
            {t('undo')}
          </Label>
        </FigureControl>
      </g>

      <g {...scope(CAPITAL_TIMELINE, CAPITAL_FLOW_AT)}>
        <CashFlow />
      </g>
      <Label tone="muted" x={0} y={752}>
        {t('invented')}
      </Label>
      <Lines tone="muted" max={49} x={0} y={770}>
        {t('assistant')}
      </Lines>
    </FigureFrame>
  );
}
