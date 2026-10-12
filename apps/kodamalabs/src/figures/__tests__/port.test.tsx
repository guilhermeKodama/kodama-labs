import { describe, expect, it } from 'vitest';

import { unknown } from '@/content/facts';
import { mockupSignatures, signatures } from '@/test/mockup';
import { renderWithMessages } from '@/test/render';

import { AgentsFigure } from '../agents/agents-figure';
import { CapitalFigure } from '../capital/capital-figure';
import { CosmosFigure } from '../cosmos/cosmos-figure';
import { DeployFigure } from '../deploy/deploy-figure';
import { LanesFigure } from '../lanes/lanes-figure';
import { PlaybookFigure } from '../playbook/playbook-figure';
import { SentinelFigure } from '../sentinel/sentinel-figure';
import { TriageFigure } from '../triage/triage-figure';

/** Each figure, rendered, beside the name of its drawing in the mockup. */
const FIGURES = [
  { name: 'lanes', node: <LanesFigure /> },
  { name: 'capital', node: <CapitalFigure /> },
  { name: 'sentinel', node: <SentinelFigure /> },
  { name: 'cosmos', node: <CosmosFigure /> },
  { name: 'triage', node: <TriageFigure /> },
  { name: 'playbook', node: <PlaybookFigure verdict={unknown()} /> },
  { name: 'agents', node: <AgentsFigure /> },
  { name: 'deploy', node: <DeployFigure /> },
] as const;

/**
 * The one line that differs on purpose: the mockup shows the owner where a
 * fact goes ("[GO / PIVOT / KILL], [DATE]"), and the page never prints that.
 */
const OWNER_FACT = /MilhasGrupo · verdict/;

describe.each(FIGURES)('$name figure', ({ name, node }) => {
  it('is the drawing of the approved mockup: same shapes, same notation, same words', () => {
    const ours = signatures(renderWithMessages(node)).filter((line) => !OWNER_FACT.test(line));
    const theirs = mockupSignatures(name).filter((line) => !OWNER_FACT.test(line));
    expect(ours).toEqual(theirs);
  });
});
