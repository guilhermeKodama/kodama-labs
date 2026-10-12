import { useTranslations } from 'next-intl';

import { bind } from '@/motion/timeline';
import { DEPLOY_TIMELINE } from '@/motion/timelines/deploy';

import { STRIP } from '../geometry/grid';
import { Echo } from '../primitives/echo';
import { FigureFrame } from '../primitives/figure-frame';
import { Gate } from '../primitives/gate';
import { Label } from '../primitives/label';
import { Pad, SpineLine } from '../primitives/lines';
import { Chevron, Panel } from '../primitives/shapes';
import { Strand } from '../primitives/strand';

import { DATABASES, FAILURE, MACHINE, SERVICE, SERVICES, STEP, STEPS, STRAND } from './deploy-data';

const HEIGHT = 214;
const m = bind(DEPLOY_TIMELINE);

/** The one machine: its services, its databases with their dev twins, its monitors. */
function Machine() {
  const t = useTranslations('figures.deploy');

  return (
    <g {...m('machine')}>
      <Strand kind="quiet" d={MACHINE.left} />
      <Strand kind="quiet" d={MACHINE.right} />
      <Label tone="muted" anchor="middle" x={572} y={26}>
        {t('machine')}
      </Label>
      <Strand kind="quiet" from={[668.5, 36.5]} to={[668.5, 60]} />
      <Chevron points={MACHINE.tunnelHead} />
      <Label tone="muted" size="small" anchor="end" x={658} y={54}>
        {t('tunnel')}
      </Label>
      {SERVICES.map((x, index) => (
        <Panel key={x} kind="ink" x={x} y={SERVICE.y} width={SERVICE.size} height={SERVICE.size} {...m(`service.${index}`)} />
      ))}
      <Label tone="muted" size="small" x={372} y={94}>
        {t('services.apps')}
      </Label>
      <Label tone="muted" size="small" x={660} y={94}>
        {t('services.edge1')}
      </Label>
      <Label tone="muted" size="small" x={660} y={108}>
        {t('services.edge2')}
      </Label>
      <Label tone="muted" size="small" x={714} y={94}>
        {t('services.monitoring')}
      </Label>
      {DATABASES.at.map((x) => (
        <g key={x}>
          <Panel kind="ink" x={x} y={DATABASES.y} width={SERVICE.size} height={SERVICE.size} />
          <Panel kind="dashed" x={x + DATABASES.twinOffset} y={DATABASES.y} width={SERVICE.size} height={SERVICE.size} />
        </g>
      ))}
      <Label tone="muted" size="small" x={372} y={158}>
        {t('databases')}
      </Label>
      <Label tone="muted" size="small" x={372} y={186}>
        {t('monitors')}
      </Label>
    </g>
  );
}

/** Deploys: steps to one gate, the machine behind it, and what a failed migration leaves alone. */
export function DeployFigure() {
  const t = useTranslations('figures.deploy');

  return (
    <FigureFrame id="deploy" sheet={STRIP} height={HEIGHT} alt={t('alt')}>
      <SpineLine x={STRIP.spine} height={HEIGHT} />
      {STEPS.map((step, index) => {
        const x = 0.5 + index * STEP.pitch;
        const last = index === STEPS.length - 1;
        return (
          <g key={step} {...m(`step.${step}`)}>
            <Panel kind={last ? 'panel-dashed' : 'quiet'} x={x} y={STEP.top} width={STEP.width} height={STEP.height} rx={STEP.rx} />
            <Label face="ui-small" anchor="middle" x={x + STEP.width / 2} y={74.5}>
              {t(`steps.${step}`)}
            </Label>
            {last ? null : <Strand kind="quiet" from={[x + STEP.width + 0.5, STRAND]} to={[x + STEP.pitch - 0.5, STRAND]} />}
          </g>
        );
      })}
      <g {...m('proposal')}>
        <Pad x={233} y={STRAND - 10} width={54} height={20} />
        <Strand kind="proposed" from={[233, STRAND]} to={[287, STRAND]} />
      </g>
      <Echo shape="check" x={STRIP.spine} y={STRAND} {...m('wait')} />
      <Gate shape="dot" x={STRIP.spine} y={STRAND} {...m('gate')} />
      <Label x={STRIP.right} y={18} {...m('held')}>
        {t('gate')}
      </Label>
      <g {...m('committed')}>
        <Pad x={300} y={STRAND - 10} width={74} height={20} />
        <Strand kind="committed" from={[302, STRAND]} to={[372, STRAND]} />
      </g>

      <g {...m('failure')}>
        <Pad x={190} y={84} width={96} height={76} />
        <Strand kind="proposed" d={FAILURE.d} />
      </g>
      <Strand
        kind="committed"
        from={[FAILURE.stop.x, FAILURE.stop.from]}
        to={[FAILURE.stop.x, FAILURE.stop.to]}
        {...m('failure.stop')}
      />
      <g {...m('failure.note')}>
        <Label tone="muted" x={0} y={174}>
          {t('fails.line1')}
        </Label>
        <Label tone="muted" x={0} y={190}>
          {t('fails.line2')}
        </Label>
      </g>

      <Machine />
    </FigureFrame>
  );
}
