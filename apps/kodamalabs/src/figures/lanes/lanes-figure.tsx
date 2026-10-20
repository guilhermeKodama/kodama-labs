import { useTranslations } from 'next-intl';

import { bind } from '@/motion/timeline';
import { LANES_TIMELINE } from '@/motion/timelines/lanes';

import { WIDE } from '../geometry/grid';
import { Echo } from '../primitives/echo';
import { FigureFrame } from '../primitives/figure-frame';
import { Gate } from '../primitives/gate';
import { Label } from '../primitives/label';
import { Hairline, Pad, SpineLine } from '../primitives/lines';
import { Strand } from '../primitives/strand';

import { LANES, LANES_SHEET, laneGeometry, type Lane } from './lanes-data';
import { LanesNarrow } from './lanes-narrow';

const m = bind(LANES_TIMELINE);

function LaneRow({ lane, index }: { lane: Lane; index: number }) {
  const t = useTranslations(`figures.lanes.${lane.key}`);
  const work = useTranslations('work');
  const g = laneGeometry(lane, index);
  const { columns } = LANES_SHEET;

  return (
    <a className="fig-lane" href={`#${lane.section}`} data-lane={lane.key}>
      <Pad {...g.hit} />
      <Label face="name" x={columns.name} y={g.name}>
        {work(`${lane.key}.title`)}
      </Label>
      <Label tone="muted" x={columns.name} y={g.domain}>
        {t('domain')}
      </Label>

      <Label x={columns.proposes} y={g.proposesLabel}>
        {t('proposes')}
      </Label>
      <g data-part="proposed">
        {g.proposals.map((proposal, position) => (
          <g key={proposal.from} {...m(`${lane.key}.proposed.${position}`)}>
            <Pad {...g.proposedBox} />
            <Strand
              kind={proposal.passes ? 'proposed' : 'candidate'}
              from={[columns.proposes, proposal.from]}
              to={[g.proposalEnd, proposal.to]}
            />
          </g>
        ))}
      </g>

      {lane.decider === 'person' ? (
        <Echo shape="wait" x={WIDE.spine} y={g.strand} {...m(`${lane.key}.wait`)} />
      ) : null}
      {lane.decider === 'check' ? (
        <Echo shape="check" x={WIDE.spine} y={g.strand} {...m(`${lane.key}.wait`)} />
      ) : null}
      <Gate shape={lane.gate} x={WIDE.spine} y={g.strand} {...m(`${lane.key}.gate`)} />
      {lane.decider === 'person' ? (
        <Echo shape="ripple" x={WIDE.spine} y={g.strand} {...m(`${lane.key}.echo`)} />
      ) : null}
      <Label x={WIDE.right} y={g.heldLabel} {...m(`${lane.key}.held`)}>
        {t('held')}
      </Label>

      <g data-part="committed" {...m(`${lane.key}.committed`)}>
        <Pad {...g.committedBox} />
        <Strand kind="committed" from={[g.committedStart, g.strand]} to={[columns.committedEnd, g.strand]} />
      </g>
      <Label x={columns.becomes} y={g.becomesLabel} {...m(`${lane.key}.becomes`)}>
        {t('becomes')}
      </Label>
    </a>
  );
}

/**
 * Three systems, one pattern: a proposal runs dashed to the spine, is held at
 * a gate, and continues solid only after it. Reads as a table under its four
 * column heads, and each row is a link to the section that explains it.
 *
 * It plays in that order too: src/motion/timelines/lanes.ts.
 */
export function LanesWide() {
  const t = useTranslations('figures.lanes');
  const { columns, headBaseline, height, rules } = LANES_SHEET;

  return (
    <FigureFrame id="lanes" sheet={WIDE} height={height} alt={t('alt')} interactive>
      <Label tone="muted" x={columns.name} y={headBaseline}>
        {t('heads.system')}
      </Label>
      <Label tone="muted" x={columns.proposes} y={headBaseline}>
        {t('heads.proposes')}
      </Label>
      <Label tone="muted" x={WIDE.right} y={headBaseline}>
        {t('heads.held')}
      </Label>
      <Label tone="muted" x={columns.becomes} y={headBaseline}>
        {t('heads.becomes')}
      </Label>
      {rules.map((y, index) => (
        <Hairline key={y} from={[0, y]} to={[WIDE.width, y]} {...m(`rule.${index}`)} />
      ))}
      <SpineLine x={WIDE.spine} height={height} {...m('spine')} />
      {LANES.map((lane, index) => (
        <LaneRow key={lane.key} lane={lane} index={index} />
      ))}
    </FigureFrame>
  );
}

/** The first figure: drawn across on a wide screen, downward on a narrow one. */
export function LanesFigure() {
  return (
    <>
      <LanesWide />
      <LanesNarrow />
    </>
  );
}
