import { useTranslations } from 'next-intl';

import { bind } from '@/motion/timeline';
import { TRIAGE_TIMELINE } from '@/motion/timelines/triage';

import { NARROW, STRIP } from '../geometry/grid';
import { Echo } from '../primitives/echo';
import { FigureFrame } from '../primitives/figure-frame';
import { Gate } from '../primitives/gate';
import { Label, Lines } from '../primitives/label';
import { GateRule, Pad } from '../primitives/lines';
import { Chevron, Panel } from '../primitives/shapes';
import { Strand } from '../primitives/strand';

import { KEPT_ROWS, ROW, SHADOW_ROWS } from './triage-data';

const m = bind(TRIAGE_TIMELINE);
const W = NARROW.width;

/**
 * The narrow sheet: shadow rows above the gate rule, discarded rows below it.
 * The strand runs down the right edge of the rows; the loop that restores a
 * discard climbs a lane on the left.
 */
const ROWS = { x: 20.5, width: W - 21 } as const;
const STRAND = 326;
const SHADOW_TOP = 22.5;
const GATE = 208;
const KEPT_TOP = 228.5;
const HEIGHT = 396;

const rowTop = (first: number, index: number) => first + index * ROW.pitch;
const shadowBottom = rowTop(SHADOW_TOP, SHADOW_ROWS.length - 1) + ROW.height;

/** From the last discarded row, up the left lane, into the last shadow row. */
const RESTORE = (() => {
  const from = rowTop(KEPT_TOP, KEPT_ROWS.length - 1) + ROW.height / 2;
  const to = rowTop(SHADOW_TOP, SHADOW_ROWS.length - 1) + ROW.height / 2;
  return {
    d: `M ${ROWS.x} ${from} C 12 ${from} 8.5 ${from - 6} 8.5 ${from - 14} L 8.5 ${to + 14} C 8.5 ${to + 6} 12 ${to} 18 ${to}`,
    head: `13,${to - 5} 19,${to} 13,${to + 5}`,
  };
})();

/** The learning filter on a narrow screen: the same story, read downward. */
export function TriageNarrow() {
  const t = useTranslations('figures.triage');
  const right = ROWS.x + ROWS.width - 11.5;

  return (
    <FigureFrame id="triage" sheet={NARROW} beside={STRIP} height={HEIGHT} alt={t('alt')}>
      <GateRule y={GATE} width={W} />
      <Label tone="muted" x={ROWS.x - 0.5} y={12}>
        {t('heads.shadow')}
      </Label>
      {SHADOW_ROWS.map((row, index) => {
        const top = rowTop(SHADOW_TOP, index);
        return (
          <g key={row} {...m(`shadow.${row}`)}>
            <Panel kind="soft-dashed" x={ROWS.x} y={top} width={ROWS.width} height={ROW.height} rx={ROW.rx} />
            <Label x={ROWS.x + 11.5} y={top + ROW.baseline}>
              {t(`shadow.${row}.score`)}
            </Label>
            <Label face="ui" tone="muted" x={ROWS.x + 55.5} y={top + ROW.baseline}>
              {t(`shadow.${row}.item`)}
            </Label>
            <Label tone="muted" size="small" anchor="end" x={right} y={top + ROW.baseline}>
              {t('would')}
            </Label>
          </g>
        );
      })}

      <g {...m('proposal', true)}>
        <Pad x={STRAND - 10} y={shadowBottom} width={20} height={GATE - 7.5 - shadowBottom} />
        <Strand kind="proposed" from={[STRAND, shadowBottom + 0.5]} to={[STRAND, GATE - 7.5]} />
      </g>
      <g {...m('held')}>
        <Lines max={41} x={ROWS.x - 0.5} y={GATE - 26}>
          {t('heads.gate')}
        </Lines>
      </g>
      <Echo shape="check" x={STRAND} y={GATE} {...m('wait')} />
      <Gate shape="dot" x={STRAND} y={GATE} {...m('gate')} />
      <Echo shape="ripple" x={STRAND} y={GATE} {...m('echo')} />
      <g {...m('committed', true)}>
        <Pad x={STRAND - 10} y={GATE + 5.5} width={20} height={KEPT_TOP - GATE - 5.5} />
        <Strand kind="committed" from={[STRAND, GATE + 7.5]} to={[STRAND, KEPT_TOP - 0.5]} />
      </g>

      {KEPT_ROWS.map((row, index) => {
        const top = rowTop(KEPT_TOP, index);
        return (
          <g key={row} {...m(`kept.${row}`)}>
            <Panel kind="ink" x={ROWS.x} y={top} width={ROWS.width} height={ROW.height} rx={ROW.rx} />
            <Label x={ROWS.x + 11.5} y={top + ROW.baseline}>
              {t(`kept.${row}.score`)}
            </Label>
            <Label face="ui" x={ROWS.x + 55.5} y={top + ROW.baseline}>
              {t(`kept.${row}.item`)}
            </Label>
            <Label size="small" anchor="end" x={right} y={top + ROW.baseline}>
              {t('discarded')}
            </Label>
          </g>
        );
      })}
      <g {...m('limits')}>
        <Label tone="muted" x={ROWS.x - 0.5} y={346}>
          {t('limits.threshold')}
        </Label>
        <Label tone="muted" x={ROWS.x - 0.5} y={362}>
          {t('limits.daily')}
        </Label>
      </g>
      <g {...m('restore', true)}>
        <Strand kind="quiet" d={RESTORE.d} />
        <Chevron points={RESTORE.head} />
      </g>
      <Label tone="muted" x={ROWS.x - 0.5} y={386} {...m('restored')}>
        {t('restored')}
      </Label>
    </FigureFrame>
  );
}
