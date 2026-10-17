/**
 * The Cosmos figure, in two acts.
 *
 * The line: three stations, each a typed contract with a worker, hand their
 * deliveries on; one gate checks every contract; a draft pull request comes
 * out. The run: a real run of that line, where a worker was refused a command
 * outside its authority, escalated, and the line stopped until a person
 * answered.
 */

export const STATIONS = ['plan', 'implement', 'review'] as const;

export const STATION = { top: 24.5, width: 190, height: 96, pitch: 244, rx: 8 } as const;

export function stationX(index: number): number {
  return 0.5 + index * STATION.pitch;
}

/** The strand of the line: deliveries travel at this height. */
export const LINE_STRAND = 72.5;

/** A delivery leaves a station's right edge and stops at the next one, or at the gate. */
export function delivery(index: number): { from: number; to: number } {
  const from = stationX(index) + STATION.width + 0.5;
  return { from, to: index === STATIONS.length - 1 ? 695 : stationX(index + 1) - 0.5 };
}

/** Review sends the work back to implement, with a note. */
export const RETURN = {
  d: 'M 583 121 C 583 141 571 148 551 148 L 371 148 C 351 148 339 141 339 123',
  head: '334,129 339,123 344,129',
  note: { x: 461, y: 165 },
} as const;

export const PULL_REQUEST = {
  card: { x: 760.5, y: 24.5, width: 439, height: 96, rx: 8 },
  state: { x: 1136.5, y: 33.5, width: 48, height: 20, rx: 10 },
  left: 776,
} as const;

/** Lines of the run's transcript, by their key under `figures.cosmos.run.lines`. */
export const TRANSCRIPT = [
  { key: 'station', x: 16, y: 231, quiet: true },
  { key: 'command', x: 16, y: 250, quiet: false },
  { key: 'refused', x: 30, y: 269, quiet: false },
  { key: 'escalated', x: 16, y: 288, quiet: false },
  { key: 'question1', x: 16, y: 307, quiet: false },
  { key: 'question2', x: 30, y: 326, quiet: false },
  { key: 'stopped', x: 16, y: 345, quiet: true },
] as const;

export const RUN = {
  panel: { x: 0.5, y: 206.5, width: 640, height: 150, rx: 8 },
  strand: 281.5,
} as const;
