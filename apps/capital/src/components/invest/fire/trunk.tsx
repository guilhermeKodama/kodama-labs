import { TRUNK, coreX, ringCenter, type Trunk } from "@/lib/invest/fire-rings";
import { TRUNK_COLORS as C } from "@/lib/theme/chart-colors";
import { textRole } from "@/lib/theme/type-scale";
import { cn } from "@/lib/utils";

/** A milestone on the ray: its radius in the drawing and its short label ("R$ 1 mi"). */
export interface TrunkMark {
  id: string;
  r: number;
  label: string;
}

export interface TrunkText {
  /** The figure's accessible description. */
  label: string;
  /** "cerne" and "R$ 520 mil · 2020", inside the core. */
  core: string;
  coreValue: string;
  /** "hoje", over the ring of the year in progress. */
  now: string;
  /** "liberdade financeira · R$ 3,43 mi", over the target circle. */
  goal: string | null;
}

/** Stroke widths of each size, in viewBox units (the canvas boards CerneFire and CerneFireCard). */
const STROKES = {
  full: { goal: 2.5, goalDash: "7 6", future: 1.2, futureDash: "3 5", ring: 1.4 },
  compact: { goal: 7, goalDash: "18 14", future: 3, futureDash: "8 12", ring: 3 },
} as const;

/** Labels on the ray closer than this to the previous one are left out. */
const MARK_LABEL_GAP = 64;

const HALO = { stroke: C.bg, strokeWidth: 3, paintOrder: "stroke" } as const;

/** Background, target, projected rings, the year in progress, the past rings and the core. */
function Rings({ trunk, variant }: { trunk: Trunk; variant: "full" | "compact" }) {
  const s = STROKES[variant];
  const target = trunk.target ? { ...trunk.target, ...ringCenter(trunk.target.r) } : null;
  // The arrival ring sits on the target circle, which already draws it.
  let future = trunk.future.filter((ring) => !target || ring.r < target.r - 0.5);
  if (variant === "compact" && future.length > 3) {
    const step = Math.ceil(future.length / 3);
    future = future.filter((_, i) => i % step === step - 1);
  }
  return (
    <>
      <circle cx={TRUNK.center} cy={TRUNK.center} r={TRUNK.radius} fill={C.bg} />
      {target ? <circle cx={target.cx} cy={target.cy} r={target.r} fill="none" stroke={C.goal} strokeWidth={s.goal} strokeDasharray={s.goalDash} /> : null}
      <g fill="none" stroke={C.future} strokeWidth={s.future} strokeDasharray={s.futureDash}>
        {future.map((ring) => (
          <circle key={ring.year} cx={ring.cx} cy={ring.cy} r={ring.r} />
        ))}
      </g>
      {trunk.current ? <path d={trunk.current.path} fill={C.now} /> : null}
      <g stroke={C.late} strokeWidth={s.ring}>
        {trunk.past
          .map((ring, i) => ({ ring, fill: i % 2 === 0 ? C.woodA : C.woodB }))
          .reverse()
          .map(({ ring, fill }) => (
            <circle key={ring.year} cx={ring.cx} cy={ring.cy} r={ring.r} fill={fill} />
          ))}
      </g>
      {trunk.core ? <circle cx={trunk.core.cx} cy={trunk.core.cy} r={trunk.core.r} fill={C.heart} /> : null}
    </>
  );
}

/**
 * The cross-section of the trunk: the core, one ring per year, the year in
 * progress as an arc, the projected rings dashed and the FIRE number as the
 * dashed outer circle. Years, "hoje" and the milestones sit on the ray that
 * runs right from the core. Text sizes are type roles in viewBox units, so
 * they scale with the drawing and with Tamanho da letra.
 */
export function TrunkFigure({ trunk, marks, text, className }: { trunk: Trunk; marks: TrunkMark[]; text: TrunkText; className?: string }) {
  const y = trunk.lineY;
  const core = trunk.core;
  const rayStart = core ? coreX(core.r, y) : TRUNK.center;
  const goalTop = trunk.target ? ringCenter(trunk.target.r).cy - trunk.target.r : TRUNK.center - TRUNK.radius;

  const markLabels: { id: string; x: number; label: string }[] = [];
  for (const mark of [...marks].sort((a, b) => a.r - b.r)) {
    const x = coreX(mark.r, y);
    if (markLabels.every((kept) => Math.abs(kept.x - x) >= MARK_LABEL_GAP)) markLabels.push({ id: mark.id, x, label: mark.label });
  }

  return (
    <svg viewBox={`0 0 ${TRUNK.size} ${TRUNK.size}`} role="img" aria-label={text.label} className={cn("h-auto w-full", className)}>
      <Rings trunk={trunk} variant="full" />
      {core && core.r >= TRUNK.coreTextMinR ? (
        <>
          <text x={core.cx} y={core.cy - 4.6} textAnchor="middle" className="font-title" fill={C.heartInk} style={{ fontSize: textRole("display") }}>
            {text.core}
          </text>
          <text x={core.cx} y={core.cy + 17.4} textAnchor="middle" className="font-mono" fill={C.heartMuted} style={{ fontSize: textRole("body-lg") }}>
            {text.coreValue}
          </text>
        </>
      ) : null}
      <line x1={rayStart} y1={y} x2={TRUNK.center + TRUNK.radius + 6} y2={y} stroke={C.ray} strokeWidth={1} />
      {trunk.labels.map((label) =>
        label.kind === "now" ? (
          <text key="now" x={label.x} y={y - 10} textAnchor="middle" fontWeight={600} fill={C.resinInk} {...HALO} style={{ fontSize: textRole("body-sm") }}>
            {text.now}
          </text>
        ) : (
          <text key={`${label.kind}-${label.text}`} x={label.x} y={y - 10} textAnchor={label.kind === "core" ? "end" : "middle"} className="font-mono" fill={C.text} {...HALO} style={{ fontSize: textRole("label") }}>
            {label.text}
          </text>
        ),
      )}
      <g fill={C.goal}>
        {marks.map((mark) => (
          <rect key={mark.id} x={-4} y={-4} width={8} height={8} transform={`translate(${coreX(mark.r, y).toFixed(1)} ${y}) rotate(45)`} />
        ))}
      </g>
      {markLabels.map((mark) => (
        <text key={mark.id} x={mark.x} y={y + 18} textAnchor="middle" fill={C.muted} {...HALO} style={{ fontSize: textRole("label") }}>
          {mark.label}
        </text>
      ))}
      {text.goal ? (
        <text x={TRUNK.center} y={Math.max(26, goalTop - 14)} textAnchor="middle" fontWeight={600} fill={C.resinInk} style={{ fontSize: textRole("body-lg") }}>
          {text.goal}
        </text>
      ) : null}
    </svg>
  );
}

/** The small trunk of the Aportes card: the rings and the progress in the core. */
export function TrunkBadge({ trunk, label, center, className }: { trunk: Trunk; label: string; center: string; className?: string }) {
  const core = trunk.core;
  const at = core ?? { cx: TRUNK.center, cy: TRUNK.center, r: 0 };
  return (
    <div className={cn("relative shrink-0", className)}>
      <svg viewBox={`0 0 ${TRUNK.size} ${TRUNK.size}`} role="img" aria-label={label} className="size-full">
        <Rings trunk={trunk} variant="compact" />
      </svg>
      <span
        aria-hidden
        className={cn("absolute -translate-x-1/2 -translate-y-1/2 font-mono text-kpi tabular-nums", at.r >= 70 ? "text-trunk-heart-ink" : "text-fg-1")}
        style={{ left: `${(at.cx / TRUNK.size) * 100}%`, top: `${(at.cy / TRUNK.size) * 100}%` }}
      >
        {center}
      </span>
    </div>
  );
}

/** Aportes and rendimento of a ring as one bar on its track; a loss shows in the negative color. */
export function RingBar({ aportes, rendimento, className }: { aportes: number; rendimento: number; className?: string }) {
  const total = Math.max(aportes, 0) + Math.abs(rendimento);
  const share = (value: number) => `${total > 0 ? (value / total) * 100 : 0}%`;
  return (
    <div className={cn("flex overflow-hidden bg-trunk-track", className)}>
      <span className="bg-trunk-aportes" style={{ width: share(Math.max(aportes, 0)) }} />
      <span className={rendimento < 0 ? "bg-neg" : "bg-pos"} style={{ width: share(Math.abs(rendimento)) }} />
    </div>
  );
}
