import { useTranslations } from 'next-intl';

import { bind } from '@/motion/timeline';
import { TRIAGE_TIMELINE } from '@/motion/timelines/triage';

import { STRIP } from '../geometry/grid';
import { Echo } from '../primitives/echo';
import { FigureFrame } from '../primitives/figure-frame';
import { Gate } from '../primitives/gate';
import { Label } from '../primitives/label';
import { Pad, SpineLine } from '../primitives/lines';
import { Chevron, Panel } from '../primitives/shapes';
import { Strand } from '../primitives/strand';

import { KEPT_ROWS, RESTORE, ROW, SHADOW_ROWS, STRAND } from './triage-data';

const HEIGHT = 214;
const m = bind(TRIAGE_TIMELINE);

/** The learning filter: what a model would discard, the gate, and what it then discards alone. */
export function TriageFigure() {
  const t = useTranslations('figures.triage');

  return (
    <FigureFrame id="triage" sheet={STRIP} height={HEIGHT} alt={t('alt')}>
      <SpineLine x={STRIP.spine} height={HEIGHT} />
      <Label tone="muted" x={0} y={18}>
        {t('heads.shadow')}
      </Label>
      {SHADOW_ROWS.map((row, index) => {
        const top = ROW.top + index * ROW.pitch;
        return (
          <g key={row} {...m(`shadow.${row}`)}>
            <Panel kind="soft-dashed" x={0.5} y={top} width={270} height={ROW.height} rx={ROW.rx} />
            <Label x={12} y={top + ROW.baseline}>
              {t(`shadow.${row}.score`)}
            </Label>
            <Label face="ui" tone="muted" x={56} y={top + ROW.baseline}>
              {t(`shadow.${row}.item`)}
            </Label>
            <Label tone="muted" size="small" anchor="end" x={258} y={top + ROW.baseline}>
              {t('would')}
            </Label>
          </g>
        );
      })}

      <g {...m('proposal')}>
        <Pad x={271} y={STRAND - 10} width={16} height={20} />
        <Strand kind="proposed" from={[271, STRAND]} to={[287, STRAND]} />
      </g>
      <Echo shape="check" x={STRIP.spine} y={STRAND} {...m('wait')} />
      <Gate shape="dot" x={STRIP.spine} y={STRAND} {...m('gate')} />
      <Echo shape="ripple" x={STRIP.spine} y={STRAND} {...m('echo')} />
      <g {...m('committed')}>
        <Pad x={300} y={STRAND - 10} width={20} height={20} />
        <Strand kind="committed" from={[302, STRAND]} to={[STRIP.right, STRAND]} />
      </g>
      <Label x={STRIP.right} y={18} {...m('held')}>
        {t('heads.gate')}
      </Label>

      {KEPT_ROWS.map((row, index) => {
        const top = ROW.top + index * ROW.pitch;
        return (
          <g key={row} {...m(`kept.${row}`)}>
            <Panel kind="ink" x={STRIP.right + 0.5} y={top} width={473} height={ROW.height} rx={ROW.rx} />
            <Label x={330} y={top + ROW.baseline}>
              {t(`kept.${row}.score`)}
            </Label>
            <Label face="ui" x={374} y={top + ROW.baseline}>
              {t(`kept.${row}.item`)}
            </Label>
            <Label size="small" anchor="end" x={780} y={top + ROW.baseline}>
              {t('discarded')}
            </Label>
          </g>
        );
      })}
      <g {...m('limits')}>
        <Label tone="muted" x={STRIP.right} y={148}>
          {t('limits.threshold')}
        </Label>
        <Label tone="muted" x={STRIP.right} y={164}>
          {t('limits.daily')}
        </Label>
      </g>
      <g {...m('restore')}>
        <Strand kind="quiet" d={RESTORE.d} />
        <Chevron points={RESTORE.head} />
      </g>
      <Label tone="muted" x={STRIP.right} y={204} {...m('restored')}>
        {t('restored')}
      </Label>
    </FigureFrame>
  );
}
