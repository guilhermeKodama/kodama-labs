import { useTranslations } from 'next-intl';

import { FigureControl } from '@/motion/figure-control';
import { bind } from '@/motion/timeline';
import { CAPITAL_HOLD_AT, CAPITAL_TIMELINE } from '@/motion/timelines/capital';

import { WIDE } from '../geometry/grid';
import { Echo } from '../primitives/echo';
import { FigureFrame } from '../primitives/figure-frame';
import { Gate } from '../primitives/gate';
import { Label } from '../primitives/label';
import { Hairline, Pad, SpineLine } from '../primitives/lines';
import { Chevron, Fill, Panel } from '../primitives/shapes';
import { Strand } from '../primitives/strand';

import {
  ACTIVE_VIEW,
  COLUMNS,
  FLOW_NODES,
  LEDGER,
  PLAN,
  PLAN_ROWS,
  VIEWS,
  flowRibbons,
  nodeBox,
} from './capital-data';

const HEIGHT = 368;
const m = bind(CAPITAL_TIMELINE);

/** The plan the assistant proposed: a drawn screen, with nothing written yet. */
function ImportPlan() {
  const t = useTranslations('figures.capital');
  const { panel, columns } = PLAN;
  const right = panel.x + panel.width;

  return (
    <>
      <g {...m('plan.frame')}>
        <Panel {...panel} />
        <Label face="ui" bold x={columns.date} y={PLAN.headBaseline}>
          {t('plan.title')}
        </Label>
        <Label tone="muted" x={104} y={PLAN.headBaseline}>
          {t('plan.state')}
        </Label>
        <Label tone="muted" anchor="end" x={columns.amount} y={PLAN.headBaseline}>
          {t('plan.count')}
        </Label>
        <Hairline from={[panel.x, PLAN.headRule]} to={[right, PLAN.headRule]} />
        <Hairline from={[panel.x, PLAN.footRule]} to={[right, PLAN.footRule]} />
      </g>
      {PLAN_ROWS.map((row, index) => {
        const y = PLAN.firstRow + index * PLAN.rowPitch;
        return (
          <g key={row} {...m(`plan.row.${row}`)}>
            <Pad x={columns.date} y={y - 14} width={columns.amount - columns.date} height={28} />
            <Label tone="muted" x={columns.date} y={y}>
              {t(`rows.${row}.date`)}
            </Label>
            <Label face="ui" tone="muted" x={columns.what} y={y}>
              {t(`rows.${row}.what`)}
            </Label>
            <Label face="ui" tone="muted" x={columns.account} y={y}>
              {t(`rows.${row}.account`)}
            </Label>
            <Label face="ui" tone="muted" x={columns.category} y={y}>
              {t(`rows.${row}.category`)}
            </Label>
            <Label tone="muted" anchor="end" x={columns.amount} y={y}>
              {t(`rows.${row}.amount`)}
            </Label>
            <Hairline dashed from={[columns.date, y + PLAN.ruleBelow]} to={[columns.amount, y + PLAN.ruleBelow]} />
          </g>
        );
      })}
      <Label tone="muted" x={columns.date} y={257} {...m('plan.more')}>
        {t('plan.more')}
      </Label>
      <Label tone="muted" x={columns.date} y={PLAN.waitingBaseline} {...m('plan.waiting')}>
        {t('plan.waiting')}
      </Label>
      <FigureControl act="confirm" at={CAPITAL_HOLD_AT} label={t('controls.confirm')}>
        <g {...m('confirm')}>
          <Fill tone="ink" {...PLAN.button} />
          <Label face="ui" bold tone="inverse" anchor="middle" x={526} y={304.5}>
            {t('plan.confirm')}
          </Label>
        </g>
      </FigureControl>
    </>
  );
}

/** The same ledger read as a cash flow: the Chart view of the product. */
function CashFlow() {
  const t = useTranslations('figures.capital');
  const ribbons = flowRibbons();

  return (
    <>
      <g {...m('views')}>
        {VIEWS.map((view) => (
          <Label key={view.key} face="ui" tone={view.key === ACTIVE_VIEW.key ? 'ink' : 'muted'} x={view.x} y={28}>
            {t(`views.${view.key}`)}
          </Label>
        ))}
        <Hairline from={[COLUMNS[0], 36.5]} to={[WIDE.width, 36.5]} />
        <Strand
          kind="trunk"
          from={[VIEWS.find((view) => view.key === ACTIVE_VIEW.key)!.x, 36]}
          to={[ACTIVE_VIEW.end, 36]}
        />
      </g>
      {COLUMNS.slice(0, -1).map((x, column) => (
        <g key={x} {...m(`flow.ribbons.${column}`)}>
          {ribbons
            .filter((ribbon) => ribbon.column === column)
            .map((ribbon) => (
              <Fill key={ribbon.d} tone="wash" d={ribbon.d} />
            ))}
        </g>
      ))}
      {COLUMNS.map((x, column) => (
        <g key={x} {...m(`flow.nodes.${column}`)}>
          {FLOW_NODES.filter((node) => node.column === column).map((node) => (
            <Fill key={node.key} tone={node.tone} {...nodeBox(node)} />
          ))}
        </g>
      ))}
      {COLUMNS.map((x, column) => (
        <g key={x} {...m(`flow.names.${column}`)}>
          {FLOW_NODES.filter((node) => node.column === column).map((node) => (
            <Label key={node.key} face="ui-small" anchor={node.label.anchor ?? 'start'} x={node.label.x} y={node.label.y}>
              {t(`flow.${node.key}`)}
            </Label>
          ))}
        </g>
      ))}
    </>
  );
}

/**
 * Capital: a plan proposed by the assistant, my click, the ledger. After the
 * figure has played, the reader can undo the import and confirm it again.
 */
export function CapitalFigure() {
  const t = useTranslations('figures.capital');
  const y = PLAN.strand;

  return (
    <FigureFrame id="capital" sheet={WIDE} height={HEIGHT} alt={t('alt')}>
      <SpineLine x={WIDE.spine} height={HEIGHT} />
      <ImportPlan />

      <g {...m('proposal')}>
        <Pad x={584} y={y - 10} width={LEDGER.proposalEnd - 584} height={20} />
        <Strand kind="proposed" from={[584, y]} to={[LEDGER.proposalEnd, y]} />
      </g>
      <Echo shape="wait" x={WIDE.spine} y={y} {...m('wait')} />
      <Gate shape="dot" x={WIDE.spine} y={y} {...m('gate')} />
      <Echo shape="ripple" x={WIDE.spine} y={y} {...m('echo')} />
      <Label x={WIDE.right} y={288} {...m('held')}>
        {t('gate')}
      </Label>

      <g {...m('committed')}>
        <Pad x={LEDGER.committedStart - 2} y={y - 10} width={LEDGER.committedEnd - LEDGER.committedStart + 4} height={20} />
        <Strand kind="committed" from={[LEDGER.committedStart, y]} to={[LEDGER.committedEnd, y]} />
      </g>
      <Label x={LEDGER.label.x} y={LEDGER.label.y} {...m('ledger')}>
        {t('ledger')}
      </Label>
      <g {...m('undo')}>
        <Strand kind="quiet" d={LEDGER.undo} />
        <Chevron points={LEDGER.undoHead} />
      </g>
      <FigureControl act="undo" at={CAPITAL_HOLD_AT} label={t('controls.undo')}>
        <Label tone="muted" x={WIDE.right} y={LEDGER.notes} {...m('undo.note')}>
          {t('undo')}
        </Label>
      </FigureControl>
      <Label tone="muted" anchor="end" x={WIDE.width} y={LEDGER.notes}>
        {t('invented')}
      </Label>
      <Label tone="muted" x={0} y={354}>
        {t('assistant')}
      </Label>

      <CashFlow />
    </FigureFrame>
  );
}
