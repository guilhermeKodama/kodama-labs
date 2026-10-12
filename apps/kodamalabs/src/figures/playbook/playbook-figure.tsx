import { useFormatter, useTranslations } from 'next-intl';

import { isoDay } from '@/content/dates';
import type { Facts } from '@/content/facts';
import { bind } from '@/motion/timeline';
import { PLAYBOOK_TIMELINE } from '@/motion/timelines/playbook';

import { STRIP } from '../geometry/grid';
import { FigureFrame } from '../primitives/figure-frame';
import { Gate } from '../primitives/gate';
import { Label } from '../primitives/label';
import { Pad, SpineLine } from '../primitives/lines';
import { Strand } from '../primitives/strand';

import { AXIS, FIRE, IDEA_END, MARKS, MILHAS } from './playbook-data';

const HEIGHT = 164;
const m = bind(PLAYBOOK_TIMELINE);

/**
 * The validation playbook. MilhasGrupo's gate is a hollow ring until its
 * verdict is a recorded fact; then it is a decision like any other.
 */
export function PlaybookFigure({ verdict }: { verdict: Facts['milhasVerdict'] }) {
  const t = useTranslations('figures.playbook');
  const format = useFormatter();
  const day = (date: string) =>
    format.dateTime(isoDay(date), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

  return (
    <FigureFrame id="playbook" sheet={STRIP} height={HEIGHT} alt={t('alt')}>
      <SpineLine x={STRIP.spine} height={HEIGHT} />
      <Label x={STRIP.right} y={18} {...m('criteria')}>
        {t('criteria')}
      </Label>
      {MARKS.map((mark) => (
        <g key={mark.key} {...m(`mark.${mark.key}`)}>
          <Label tone="muted" x={mark.x} y={42}>
            {t(`marks.${mark.key}`)}
          </Label>
          <Strand kind="quiet" from={[mark.x + 0.5, 50]} to={[mark.x + 0.5, 62]} />
        </g>
      ))}
      <g {...m('milhas')}>
        <Pad x={0} y={MILHAS.y - 10} width={IDEA_END} height={20} />
        <Strand kind="proposed" from={[0, MILHAS.y]} to={[IDEA_END, MILHAS.y]} />
      </g>
      <Gate shape={verdict.known ? 'dot' : 'ring'} x={STRIP.spine} y={MILHAS.y} {...m('gate')} />
      <Label x={STRIP.right} y={60} {...m('verdict')}>
        {verdict.known
          ? t('milhas.decided', { verdict: verdict.value.verdict, date: day(verdict.value.date) })
          : t('milhas.pending')}
      </Label>

      <g {...m('fire')}>
        <Pad x={0} y={FIRE.y - 10} width={FIRE.end} height={20} />
        <Strand kind="proposed" from={[0, FIRE.y]} to={[FIRE.end, FIRE.y]} />
      </g>
      <Label x={72} y={108} {...m('fire.label')}>
        {t('fire')}
      </Label>

      <g {...m('axis')}>
        <Strand kind="quiet" from={[0, AXIS.y]} to={[294, AXIS.y]} />
        {AXIS.ticks.map((x) => (
          <Strand key={x} kind="quiet" from={[x, 136]} to={[x, 145]} />
        ))}
        <Label tone="muted" x={0} y={160}>
          {t('axis.start')}
        </Label>
        <Label tone="muted" x={110} y={160}>
          {t('axis.cap')}
        </Label>
        <Label tone="muted" x={STRIP.right} y={144.5}>
          {t('axis.verdict')}
        </Label>
      </g>
    </FigureFrame>
  );
}
