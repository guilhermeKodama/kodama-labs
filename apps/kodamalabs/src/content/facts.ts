/**
 * Facts only the owner has. Each one is either known, with its value, or
 * unknown. The page never prints a placeholder: a row, a link or a status
 * segment whose fact is unknown is simply not rendered.
 *
 * To publish a fact, replace `unknown()` with `known(value)`.
 */
export type Fact<T> = { known: true; value: T } | { known: false };

export function known<T>(value: T): Fact<T> {
  return { known: true, value };
}

export function unknown<T>(): Fact<T> {
  return { known: false };
}

function fromEnv(name: string): Fact<string> {
  const value = process.env[name]?.trim();
  return value ? known(value) : unknown();
}

export interface Facts {
  /** Current employer, only if it should be named on the page. */
  employer: Fact<string>;
  /**
   * What he is open to. The words are copy, so they live in the messages
   * (hero.facts.openTo.value); this only says whether they have been written.
   */
  openTo: Fact<true>;
  /** URL of the CV as a PDF. */
  cvUrl: Fact<string>;
  /** Month Capital went into production, as "YYYY-MM". */
  capitalInProductionSince: Fact<string>;
  /** Public address of Sentinel, once the site answers. */
  sentinelUrl: Fact<string>;
  /** Outcome of the MilhasGrupo validation, with its date as "YYYY-MM-DD". */
  milhasVerdict: Fact<{ verdict: 'go' | 'pivot' | 'kill'; date: string }>;
  /** Short commit the page was built from. Set by the image build. */
  buildCommit: Fact<string>;
  /** Day the page was built, as "YYYY-MM-DD". Set by the image build. */
  builtAt: Fact<string>;
}

export const FACTS: Facts = {
  employer: unknown(),
  openTo: unknown(),
  cvUrl: unknown(),
  capitalInProductionSince: unknown(),
  sentinelUrl: unknown(),
  milhasVerdict: unknown(),
  buildCommit: fromEnv('KODAMALABS_COMMIT'),
  builtAt: fromEnv('KODAMALABS_BUILT_AT'),
};
