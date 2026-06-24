import type { ContributionPhase, PhaseProfile, PhaseShape } from './types';
import { MONTHS_PER_YEAR } from './rates';

/**
 * Default 3-phase horizon: curto (0–3y), médio (3–10y), longo (10y+).
 * Boundaries are intentionally generic; the UI lets the user fine-tune them.
 */
export function defaultPhaseBoundaries(): Array<Pick<PhaseShape, 'label' | 'fromMonth' | 'toMonth'>> {
  return [
    { label: 'curto', fromMonth: 0, toMonth: 3 * MONTHS_PER_YEAR },
    { label: 'medio', fromMonth: 3 * MONTHS_PER_YEAR, toMonth: 10 * MONTHS_PER_YEAR },
    { label: 'longo', fromMonth: 10 * MONTHS_PER_YEAR, toMonth: null },
  ];
}

/** Relative contribution intensity per phase for each guided profile. */
const PROFILE_INTENSITIES: Record<Exclude<PhaseProfile, 'custom'>, [number, number, number]> = {
  // Rigoroso no início e afrouxa.
  front_loaded: [1.5, 1.0, 0.7],
  constant: [1.0, 1.0, 1.0],
  // Cresce com a renda.
  back_loaded: [0.7, 1.0, 1.3],
};

/** Build the phase shape (boundaries + relative intensities) for a profile. */
export function buildPhaseShape(profile: PhaseProfile): PhaseShape[] {
  const bounds = defaultPhaseBoundaries();
  const intensities = profile === 'custom' ? [1, 1, 1] : PROFILE_INTENSITIES[profile];
  return bounds.map((b, i) => ({ ...b, intensity: intensities[i] }));
}

/** Resolve a shape + solved base contribution into concrete phases. */
export function resolvePhases(shape: PhaseShape[], baseContribution: number): ContributionPhase[] {
  return shape.map((s) => ({
    fromMonth: s.fromMonth,
    toMonth: s.toMonth,
    monthlyContribution: Math.max(0, baseContribution * s.intensity),
    label: s.label,
  }));
}

/** Derive a shape (intensities relative to the first phase) from concrete phases. */
export function phasesToShape(phases: ContributionPhase[]): PhaseShape[] {
  const base = phases.find((p) => p.monthlyContribution > 0)?.monthlyContribution ?? 1;
  return phases.map((p) => ({
    fromMonth: p.fromMonth,
    toMonth: p.toMonth,
    intensity: p.monthlyContribution / base,
    label: p.label,
  }));
}
