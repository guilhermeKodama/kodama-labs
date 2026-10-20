import { useTranslations } from 'next-intl';

import { bind } from '@/motion/timeline';
import { LANES_TIMELINE } from '@/motion/timelines/lanes';

import { NARROW, WIDE } from '../geometry/grid';
import { Echo } from '../primitives/echo';
import { FigureFrame } from '../primitives/figure-frame';
import { Gate } from '../primitives/gate';
import { Label } from '../primitives/label';
import { GateRule, Hairline, Pad } from '../primitives/lines';
import { Strand } from '../primitives/strand';

import { LANES, laneGeometry, type Lane } from './lanes-data';

const m = bind(LANES_TIMELINE);

/**
 * The narrow sheet: one block per lane, read top to bottom. The strand runs
 * down the left edge, the words beside it, and each lane crosses its own gate
 * rule. The four column heads of the wide figure become one line that gives
 * the reading order of every block.
 */
const SHEET = {
  heads: { y: 12, at: { system: 0, proposes: 70, held: 150, becomes: 240 } },
  firstBlock: 22,
  block: 132,
  strand: 17,
  text: 40,
  /** Within a block: baselines, where the strand starts, the gate, where it ends. */
  name: 30,
  proposes: 54,
  start: 42,
  gate: 76,
  held: 94,
  becomes: 116,
  end: 122,
} as const;

const HEIGHT = SHEET.firstBlock + SHEET.block * LANES.length + 1;

function LaneBlock({ lane, index }: { lane: Lane; index: number }) {
  const t = useTranslations(`figures.lanes.${lane.key}`);
  const work = useTranslations('work');
  const top = SHEET.firstBlock + index * SHEET.block;
  const gate = top + SHEET.gate;
  const isBar = lane.gate === 'bar';
  // The same clearances as in the wide figure, turned.
  const stop = gate - (isBar ? 6.5 : 7.5);
  const resume = gate + (isBar ? 4.5 : 7.5);
  const { proposals, strand } = laneGeometry(lane, index);

  return (
    <a className="fig-lane" href={`#${lane.section}`} data-lane={lane.key}>
      <Pad x={0} y={top + 1} width={NARROW.width} height={SHEET.block - 1} />
      <Label face="name" x={0} y={top + SHEET.name}>
        {work(`${lane.key}.title`)}
      </Label>
      <Label tone="muted" anchor="end" x={NARROW.width} y={top + SHEET.name}>
        {t('domain')}
      </Label>

      <Label x={SHEET.text} y={top + SHEET.proposes}>
        {t('proposes')}
      </Label>
      <g data-part="proposed">
        {proposals.map((proposal, position) => (
          <g key={proposal.from} {...m(`${lane.key}.proposed.${position}`, true)}>
            <Pad x={0} y={top + SHEET.start} width={34} height={stop - top - SHEET.start} />
            <Strand
              kind={proposal.passes ? 'proposed' : 'candidate'}
              from={[SHEET.strand + proposal.from - strand, top + SHEET.start]}
              to={[SHEET.strand + proposal.to - strand, stop]}
            />
          </g>
        ))}
      </g>

      {lane.decider === 'person' ? <Echo shape="wait" x={SHEET.strand} y={gate} {...m(`${lane.key}.wait`)} /> : null}
      {lane.decider === 'check' ? <Echo shape="check" x={SHEET.strand} y={gate} {...m(`${lane.key}.wait`)} /> : null}
      <Gate shape={lane.gate} across x={SHEET.strand} y={gate} {...m(`${lane.key}.gate`, true)} />
      {lane.decider === 'person' ? <Echo shape="ripple" x={SHEET.strand} y={gate} {...m(`${lane.key}.echo`)} /> : null}
      <Label x={SHEET.text} y={top + SHEET.held} {...m(`${lane.key}.held`)}>
        {t('held')}
      </Label>

      <g data-part="committed" {...m(`${lane.key}.committed`, true)}>
        <Pad x={SHEET.strand - 10} y={resume - 2} width={20} height={top + SHEET.end - resume + 4} />
        <Strand kind="committed" from={[SHEET.strand, resume]} to={[SHEET.strand, top + SHEET.end]} />
      </g>
      <Label x={SHEET.text} y={top + SHEET.becomes} {...m(`${lane.key}.becomes`)}>
        {t('becomes')}
      </Label>
    </a>
  );
}

/** The lanes on a narrow screen: the same three stories, each read downward. */
export function LanesNarrow() {
  const t = useTranslations('figures.lanes');
  const rules = [...LANES.map((_, index) => SHEET.firstBlock + index * SHEET.block), HEIGHT - 1];

  return (
    <FigureFrame id="lanes" sheet={NARROW} beside={WIDE} height={HEIGHT} alt={t('alt')} interactive>
      {(['system', 'proposes', 'held', 'becomes'] as const).map((head) => (
        <Label key={head} tone="muted" size="small" x={SHEET.heads.at[head]} y={SHEET.heads.y}>
          {t(`heads.${head}`)}
        </Label>
      ))}
      {rules.map((y, index) => (
        <Hairline key={y} from={[0, y + 0.5]} to={[NARROW.width, y + 0.5]} {...m(`rule.${index}`)} />
      ))}
      <g {...m('spine', true)}>
        {LANES.map((lane, index) => (
          <GateRule key={lane.key} y={SHEET.firstBlock + index * SHEET.block + SHEET.gate} width={NARROW.width} />
        ))}
      </g>
      {LANES.map((lane, index) => (
        <LaneBlock key={lane.key} lane={lane} index={index} />
      ))}
    </FigureFrame>
  );
}
