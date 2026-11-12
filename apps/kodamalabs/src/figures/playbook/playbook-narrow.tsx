import { useFormatter, useTranslations } from 'next-intl';

import { isoDay } from '@/content/dates';
import type { Facts } from '@/content/facts';
import { bind } from '@/motion/timeline';
import { PLAYBOOK_TIMELINE } from '@/motion/timelines/playbook';

import { NARROW, STRIP } from '../geometry/grid';
import { FigureFrame } from '../primitives/figure-frame';
import { Gate } from '../primitives/gate';
import { Label } from '../primitives/label';
import { GateRule, Pad } from '../primitives/lines';
import { Strand } from '../primitives/strand';

import { AXIS, FIRE, IDEA_END, MARKS } from './playbook-data';

const m = bind(PLAYBOOK_TIMELINE);
const W = NARROW.width;

/**
 * The narrow sheet: time runs down. The idea is a dashed line from day 0 at
 * the top to the gate rule (the verdict) at the bottom, with the same lengths
 * as in the wide figure; the axis is on the right edge.
 */
const TOP = 30;
const IDEA = 60;
const BESIDE = 74;
/** The gate is as far past the idea's end as the wide figure's spine is. */
const GATE = TOP + STRIP.spine;
const FIRE_X = 138;
const AXIS_X = W - 8.5;
const HEIGHT = Math.ceil(GATE) + 48;

/** The validation playbook on a narrow screen: the same story, read downward. */
export function PlaybookNarrow({ verdict }: { verdict: Facts['milhasVerdict'] }) {
  const t = useTranslations('figures.playbook');
  const format = useFormatter();
  const day = (date: string) =>
    format.dateTime(isoDay(date), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

  return (
    <FigureFrame id="playbook" sheet={NARROW} beside={STRIP} height={HEIGHT} alt={t('alt')}>
      <GateRule y={GATE} width={W} />
      <Label x={BESIDE} y={GATE - 12} {...m('criteria')}>
        {t('criteria')}
      </Label>
      {MARKS.map((mark) => (
        <g key={mark.key} {...m(`mark.${mark.key}`)}>
          <Label tone="muted" x={BESIDE} y={TOP + mark.x + 4}>
            {t(`marks.${mark.key}`)}
          </Label>
          <Strand kind="quiet" from={[IDEA - 6, TOP + mark.x + 0.5]} to={[IDEA + 6, TOP + mark.x + 0.5]} />
        </g>
      ))}
      <g {...m('milhas', true)}>
        <Pad x={IDEA - 10} y={TOP} width={20} height={IDEA_END} />
        <Strand kind="proposed" from={[IDEA, TOP]} to={[IDEA, TOP + IDEA_END]} />
      </g>
      <Gate shape={verdict.known ? 'dot' : 'ring'} x={IDEA} y={GATE} {...m('gate')} />
      <Label x={BESIDE} y={GATE + 18} {...m('verdict')}>
        {verdict.known
          ? t('milhas.decided', { verdict: verdict.value.verdict, date: day(verdict.value.date) })
          : t('milhas.pending')}
      </Label>

      <g {...m('fire', true)}>
        <Pad x={FIRE_X - 10} y={TOP} width={20} height={FIRE.end} />
        <Strand kind="proposed" from={[FIRE_X, TOP]} to={[FIRE_X, TOP + FIRE.end]} />
      </g>
      <Label x={FIRE_X - 6} y={TOP + FIRE.end + 16} {...m('fire.label')}>
        {t('fire')}
      </Label>

      <g {...m('axis')}>
        <Strand kind="quiet" from={[AXIS_X, TOP]} to={[AXIS_X, GATE - 0.5]} />
        {AXIS.ticks.map((x) => (
          <Strand key={x} kind="quiet" from={[AXIS_X - 4.5, TOP + x]} to={[AXIS_X + 4.5, TOP + x]} />
        ))}
        <Label tone="muted" anchor="end" x={AXIS_X - 9.5} y={TOP + 4}>
          {t('axis.start')}
        </Label>
        <Label tone="muted" anchor="end" x={AXIS_X - 9.5} y={TOP + MARKS[1].x + 4}>
          {t('axis.cap')}
        </Label>
        <Label tone="muted" anchor="end" x={AXIS_X - 9.5} y={GATE + 36}>
          {t('axis.verdict')}
        </Label>
      </g>
    </FigureFrame>
  );
}
