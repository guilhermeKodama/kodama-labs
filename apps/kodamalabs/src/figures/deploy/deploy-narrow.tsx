import { useTranslations } from 'next-intl';

import { bind } from '@/motion/timeline';
import { DEPLOY_TIMELINE } from '@/motion/timelines/deploy';

import { NARROW, STRIP } from '../geometry/grid';
import { Echo } from '../primitives/echo';
import { FigureFrame } from '../primitives/figure-frame';
import { Gate } from '../primitives/gate';
import { Label } from '../primitives/label';
import { GateRule, Pad } from '../primitives/lines';
import { Chevron, Panel } from '../primitives/shapes';
import { Strand } from '../primitives/strand';

import { DATABASES, SERVICE, SERVICES, STEP, STEPS } from './deploy-data';

const m = bind(DEPLOY_TIMELINE);
const W = NARROW.width;

/**
 * The narrow sheet: the steps in a column, the strand down from the last one
 * to the gate rule, and the machine below it. The path of a failed migration
 * leaves the step sideways and stops above the rule.
 */
const STEP_PITCH = 46;
const STRAND = 0.5 + STEP.width / 2;
const stepTop = (index: number) => 0.5 + index * STEP_PITCH;
const STEPS_BOTTOM = stepTop(STEPS.length - 1) + STEP.height;

const GATE = 170;
const FAIL = { x: 120.5, stop: GATE - 12.5 } as const;

/** Top of the machine, and where each of its rows of squares starts. */
const MACHINE = 232;
const ROW = { apps: MACHINE + 14, databases: MACHINE + 62, edge: MACHINE + 134 } as const;
const MACHINE_HEIGHT = 196;
const HEIGHT = MACHINE + MACHINE_HEIGHT + 16;

/** The app services in one row, in the same groups as the wide figure. */
const APP_GROUPS = [5, 5, 2, 2, 1];
const EDGE = [14.5, 40.5];
const MONITORING = [190.5, 206.5, 222.5, 238.5];

/** Left edge of every service, in the order of the wide figure: apps, tunnel and cron, monitoring. */
function servicePositions(): Array<{ x: number; y: number }> {
  const apps: Array<{ x: number; y: number }> = [];
  let x = 14.5;
  for (const count of APP_GROUPS) {
    for (let index = 0; index < count; index++) apps.push({ x: x + index * SERVICE.pitch, y: ROW.apps });
    x += count * SERVICE.pitch + 6;
  }
  return [...apps, ...EDGE.map((left) => ({ x: left, y: ROW.edge })), ...MONITORING.map((left) => ({ x: left, y: ROW.edge }))];
}

function Machine() {
  const t = useTranslations('figures.deploy');
  const bottom = MACHINE + MACHINE_HEIGHT;
  const services = servicePositions();

  return (
    <g {...m('machine')}>
      <Strand kind="quiet" d={`M 14 ${MACHINE} L 0.5 ${MACHINE} L 0.5 ${bottom} L 14 ${bottom}`} />
      <Strand kind="quiet" d={`M ${W - 14} ${MACHINE} L ${W - 0.5} ${MACHINE} L ${W - 0.5} ${bottom} L ${W - 14} ${bottom}`} />
      <Label tone="muted" anchor="middle" x={W / 2 + 20} y={MACHINE - 10}>
        {t('machine')}
      </Label>
      {SERVICES.map((wide, index) => (
        <Panel
          key={wide}
          kind="ink"
          x={services[index]!.x}
          y={services[index]!.y}
          width={SERVICE.size}
          height={SERVICE.size}
          {...m(`service.${index}`)}
        />
      ))}
      <Label tone="muted" size="small" x={14} y={ROW.apps + 30}>
        {t('services.apps')}
      </Label>
      {DATABASES.at.map((wide, index) => {
        const x = 14.5 + index * 48;
        return (
          <g key={wide}>
            <Panel kind="ink" x={x} y={ROW.databases} width={SERVICE.size} height={SERVICE.size} />
            <Panel kind="dashed" x={x + DATABASES.twinOffset} y={ROW.databases} width={SERVICE.size} height={SERVICE.size} />
          </g>
        );
      })}
      <Label tone="muted" size="small" x={14} y={ROW.databases + 30}>
        {t('databases')}
      </Label>
      <Label tone="muted" size="small" x={14} y={ROW.databases + 52}>
        {t('monitors')}
      </Label>
      <Label tone="muted" size="small" x={62} y={ROW.edge + 4}>
        {t('services.edge1')}
      </Label>
      <Label tone="muted" size="small" x={62} y={ROW.edge + 17}>
        {t('services.edge2')}
      </Label>
      <Label tone="muted" size="small" x={MONITORING[0]! - 0.5} y={ROW.edge + 30}>
        {t('services.monitoring')}
      </Label>
      {/* The tunnel reaches the machine from outside: from below, at the tunnel's square. */}
      <Strand kind="quiet" from={[20.5, bottom + 10]} to={[20.5, ROW.edge + 18]} />
      <Chevron points={`16,${ROW.edge + 23} 20.5,${ROW.edge + 18} 25,${ROW.edge + 23}`} />
      <Label tone="muted" size="small" x={32} y={ROW.edge + 50}>
        {t('tunnel')}
      </Label>
    </g>
  );
}

/** Deploys on a narrow screen: the same story, read downward. */
export function DeployNarrow() {
  const t = useTranslations('figures.deploy');
  const migrate = stepTop(STEPS.length - 1) + STEP.height / 2;

  return (
    <FigureFrame id="deploy" sheet={NARROW} beside={STRIP} height={HEIGHT} alt={t('alt')}>
      <GateRule y={GATE} width={W} />
      {STEPS.map((step, index) => {
        const top = stepTop(index);
        const last = index === STEPS.length - 1;
        return (
          <g key={step} {...m(`step.${step}`)}>
            <Panel kind={last ? 'panel-dashed' : 'quiet'} x={0.5} y={top} width={STEP.width} height={STEP.height} rx={STEP.rx} />
            <Label face="ui-small" anchor="middle" x={STRAND} y={top + 17}>
              {t(`steps.${step}`)}
            </Label>
            {last ? null : <Strand kind="quiet" from={[STRAND, top + STEP.height + 0.5]} to={[STRAND, top + STEP_PITCH - 0.5]} />}
          </g>
        );
      })}
      <g {...m('proposal', true)}>
        <Pad x={STRAND - 10} y={STEPS_BOTTOM} width={20} height={GATE - 7.5 - STEPS_BOTTOM} />
        <Strand kind="proposed" from={[STRAND, STEPS_BOTTOM + 0.5]} to={[STRAND, GATE - 7.5]} />
      </g>
      <Echo shape="check" x={STRAND} y={GATE} {...m('wait')} />
      <Gate shape="dot" x={STRAND} y={GATE} {...m('gate')} />
      <Label x={STRAND + 16} y={GATE + 18} {...m('held')}>
        {t('gate')}
      </Label>
      <g {...m('committed', true)}>
        <Pad x={STRAND - 10} y={GATE + 5.5} width={20} height={ROW.apps - GATE - 9.5} />
        <Strand kind="committed" from={[STRAND, GATE + 7.5]} to={[STRAND, ROW.apps - 4]} />
      </g>

      <g {...m('failure')}>
        <Pad x={STEP.width} y={migrate - 10} width={FAIL.x - STEP.width + 10} height={FAIL.stop - migrate + 10} />
        <Strand kind="proposed" d={`M ${STEP.width + 0.5} ${migrate} L ${FAIL.x} ${migrate} L ${FAIL.x} ${FAIL.stop - 1.5}`} />
      </g>
      <Strand kind="committed" from={[FAIL.x - 6.5, FAIL.stop]} to={[FAIL.x + 6.5, FAIL.stop]} {...m('failure.stop')} />
      <g {...m('failure.note')}>
        <Label tone="muted" x={FAIL.x + 13.5} y={migrate + 22}>
          {t('fails.line1')}
        </Label>
        <Label tone="muted" x={FAIL.x + 13.5} y={migrate + 38}>
          {t('fails.line2')}
        </Label>
      </g>

      <Machine />
    </FigureFrame>
  );
}
