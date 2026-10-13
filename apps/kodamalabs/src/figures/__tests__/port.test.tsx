import { describe, expect, it } from 'vitest';

import { unknown } from '@/content/facts';
import { mockupSignatures, signatures } from '@/test/mockup';
import { renderWithMessages } from '@/test/render';

import { AgentsWide } from '../agents/agents-figure';
import { CapitalWide } from '../capital/capital-figure';
import { CosmosWide } from '../cosmos/cosmos-figure';
import { DeployWide } from '../deploy/deploy-figure';
import { LanesWide } from '../lanes/lanes-figure';
import { PlaybookWide } from '../playbook/playbook-figure';
import { SentinelWide } from '../sentinel/sentinel-figure';
import { TriageWide } from '../triage/triage-figure';

/** The wide drawing of each figure, rendered, beside the name of its drawing in the mockup. */
const FIGURES = [
  { name: 'lanes', node: <LanesWide /> },
  { name: 'capital', node: <CapitalWide /> },
  { name: 'sentinel', node: <SentinelWide /> },
  { name: 'cosmos', node: <CosmosWide /> },
  { name: 'triage', node: <TriageWide /> },
  { name: 'playbook', node: <PlaybookWide verdict={unknown()} /> },
  { name: 'agents', node: <AgentsWide /> },
  { name: 'deploy', node: <DeployWide /> },
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
