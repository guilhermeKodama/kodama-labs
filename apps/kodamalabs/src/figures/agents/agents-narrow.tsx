import { useTranslations } from 'next-intl';

import { bind } from '@/motion/timeline';
import { AGENTS_TIMELINE } from '@/motion/timelines/agents';

import { NARROW, STRIP } from '../geometry/grid';
import { FigureFrame } from '../primitives/figure-frame';
import { Gate } from '../primitives/gate';
import { Label, Lines } from '../primitives/label';
import { GateRule, Pad } from '../primitives/lines';
import { Panel } from '../primitives/shapes';
import { Strand } from '../primitives/strand';

import { BRANCHES, CONTRACT, MAIN, MERGED, STRAND as WIDE_STRAND } from './agents-data';

const m = bind(AGENTS_TIMELINE);
const W = NARROW.width;

/**
 * The narrow sheet: the contract at the top, branches fanning down to a gate
 * that lies across the sheet, and main running down from it. A branch keeps
 * the place it has in the wide figure, turned (what was its height is its x)
 * and drawn a little closer, to leave room for the words beside the fan.
 */
const CENTRE = W / 2;
const FAN_TOP = 56;
const GATE = 179.5;
const MERGE_END = GATE + 92;
const MAIN_END = MERGE_END + 140;
const HEIGHT = Math.ceil(MAIN_END) + 42;

const SPREAD = 0.8;
const branchX = (y: number) => CENTRE + (y - WIDE_STRAND) * SPREAD;
/** The gate covers every branch, with the same overhang as in the wide figure. */
const GATE_LENGTH = (BRANCHES.at(-1)! - BRANCHES[0]) * SPREAD + 24;

function branchPath(x: number): string {
  return `M ${CENTRE} ${FAN_TOP} C ${CENTRE} 116 ${x} 116 ${x} ${GATE - 3.5}`;
}

function mergePath(x: number): string {
  return `M ${x} ${GATE + 3.5} C ${x} ${GATE + 48} ${CENTRE} ${GATE + 46} ${CENTRE} ${MERGE_END}`;
}

/** Coding agents on a narrow screen: the same story, read downward. */
export function AgentsNarrow() {
  const t = useTranslations('figures.agents');
  const pitch = (MAIN_END - MERGE_END - 28) / (MAIN.commits.length - 1);

  return (
    <FigureFrame id="agents" sheet={NARROW} beside={STRIP} height={HEIGHT} alt={t('alt')}>
      <GateRule y={GATE} width={W} />
      <g {...m('contract')}>
        {/* The page of the wide figure, moved to the top of the sheet. */}
        <g transform={`translate(${CENTRE - 14.5} -96.5)`}>
          <Panel kind="quiet" d={CONTRACT.page} />
          <Strand kind="quiet" d={CONTRACT.fold} />
          {CONTRACT.lines.map(([y, end]) => (
            <Strand key={y} kind="quiet" from={[6, y]} to={[end, y]} />
          ))}
        </g>
        <Label tone="muted" x={CENTRE + 26} y={18}>
          {t('contract.line1')}
        </Label>
        <Label tone="muted" x={CENTRE + 26} y={33}>
          {t('contract.line2')}
        </Label>
        <Label tone="muted" x={CENTRE + 26} y={48}>
          {t('contract.line3')}
        </Label>
        <Strand kind="quiet" from={[CENTRE, 42.5]} to={[CENTRE, FAN_TOP]} />
      </g>
      {BRANCHES.map((y, index) => (
        <g key={y} {...m(`branch.${index}`, true)}>
          <Pad x={100} y={FAN_TOP} width={140} height={GATE - 3.5 - FAN_TOP} />
          <Strand kind="proposed" d={branchPath(branchX(y))} />
        </g>
      ))}
      <g {...m('worktrees')}>
        <Label tone="muted" size="small" x={0} y={100}>
          {t('worktrees.claude')}
        </Label>
        <Label tone="muted" size="small" anchor="end" x={W} y={100}>
          {t('worktrees.cursor')}
        </Label>
      </g>

      <Gate shape="bar" across x={CENTRE} y={GATE} height={GATE_LENGTH} {...m('gate', true)} />
      <g {...m('held')}>
        <Lines size="small" max={16} x={0} y={GATE + 18}>
          {t('gate')}
        </Lines>
      </g>

      {BRANCHES.slice(0, MERGED).map((y, index) => (
        <g key={y} {...m(`merge.${index}`, true)}>
          <Pad x={100} y={GATE + 3.5} width={116} height={MERGE_END - GATE - 3.5} />
          <Strand kind="committed" d={mergePath(branchX(y))} />
        </g>
      ))}
      <g {...m('main', true)}>
        <Pad x={CENTRE - 10} y={MERGE_END} width={20} height={MAIN_END - MERGE_END} />
        <Strand kind="trunk" from={[CENTRE, MERGE_END]} to={[CENTRE, MAIN_END]} />
      </g>
      {MAIN.commits.map((x, index) => {
        const y = MERGE_END + 16 + index * pitch;
        return <Strand key={x} kind="committed" from={[CENTRE - 5, y]} to={[CENTRE + 5, y]} {...m(`commit.${index}`)} />;
      })}
      <g {...m('main.label')}>
        <Label anchor="middle" x={CENTRE} y={MAIN_END + 18}>
          {t('main')}
        </Label>
        <Label tone="muted" anchor="middle" x={CENTRE} y={MAIN_END + 34}>
          {t('merged')}
        </Label>
      </g>
      <Label tone="muted" anchor="end" x={W} y={GATE + 18} {...m('closed')}>
        {t('closed')}
      </Label>
    </FigureFrame>
  );
}
