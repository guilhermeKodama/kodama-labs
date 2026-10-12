import { useTranslations } from 'next-intl';

import { bind } from '@/motion/timeline';
import { AGENTS_TIMELINE } from '@/motion/timelines/agents';

import { STRIP } from '../geometry/grid';
import { FigureFrame } from '../primitives/figure-frame';
import { Gate } from '../primitives/gate';
import { Label } from '../primitives/label';
import { Pad, SpineLine } from '../primitives/lines';
import { Panel } from '../primitives/shapes';
import { Strand } from '../primitives/strand';

import { BRANCHES, CONTRACT, MAIN, MERGED, STRAND, branchPath, mergePath } from './agents-data';

const HEIGHT = 234;
const m = bind(AGENTS_TIMELINE);

/** Coding agents: a written contract, branches to one gate, and what merges into main. */
export function AgentsFigure() {
  const t = useTranslations('figures.agents');

  return (
    <FigureFrame id="agents" sheet={STRIP} height={HEIGHT} alt={t('alt')}>
      <SpineLine x={STRIP.spine} height={HEIGHT} />
      <g {...m('contract')}>
        <Panel kind="quiet" d={CONTRACT.page} />
        <Strand kind="quiet" d={CONTRACT.fold} />
        {CONTRACT.lines.map(([y, end]) => (
          <Strand key={y} kind="quiet" from={[6, y]} to={[end, y]} />
        ))}
        <Label tone="muted" x={0} y={158}>
          {t('contract.line1')}
        </Label>
        <Label tone="muted" x={0} y={174}>
          {t('contract.line2')}
        </Label>
        <Label tone="muted" x={0} y={190}>
          {t('contract.line3')}
        </Label>
        <Strand kind="quiet" from={[29, STRAND]} to={[44, STRAND]} />
      </g>
      {BRANCHES.map((y, index) => (
        <g key={y} {...m(`branch.${index}`)}>
          <Pad x={44} y={40} width={247} height={160} />
          <Strand kind="proposed" d={branchPath(y)} />
        </g>
      ))}
      <g {...m('worktrees')}>
        <Label tone="muted" size="small" x={150} y={34}>
          {t('worktrees.claude')}
        </Label>
        <Label tone="muted" size="small" x={150} y={220}>
          {t('worktrees.cursor')}
        </Label>
      </g>

      <Gate shape="bar" x={STRIP.spine} y={STRAND} height={174} {...m('gate')} />
      <Label x={STRIP.right} y={18} {...m('held')}>
        {t('gate')}
      </Label>

      {BRANCHES.slice(0, MERGED).map((y, index) => (
        <g key={y} {...m(`merge.${index}`)}>
          <Pad x={298} y={40} width={142} height={130} />
          <Strand kind="committed" d={mergePath(y)} />
        </g>
      ))}
      <g {...m('main')}>
        <Pad x={MAIN.from} y={STRAND - 10} width={MAIN.to - MAIN.from} height={20} />
        <Strand kind="trunk" from={[MAIN.from, STRAND]} to={[MAIN.to, STRAND]} />
      </g>
      {MAIN.commits.map((x, index) => (
        <Strand key={x} kind="committed" from={[x, 115]} to={[x, 125]} {...m(`commit.${index}`)} />
      ))}
      <g {...m('main.label')}>
        <Label x={712} y={124}>
          {t('main')}
        </Label>
        <Label tone="muted" x={712} y={140}>
          {t('merged')}
        </Label>
      </g>
      <Label tone="muted" x={STRIP.right} y={199} {...m('closed')}>
        {t('closed')}
      </Label>
    </FigureFrame>
  );
}
