import { describe, expect, it } from 'vitest';

import { BOOT_SCRIPT, PREPAINT_SCRIPT, seen } from '../scripts';

describe('seen', () => {
  it('starts a figure once two fifths of it are on screen', () => {
    expect(seen(473, 709, 900)).toBe(true);
    expect(seen(473, 709, 650)).toBe(true);
    expect(seen(700, 936, 780)).toBe(false);
    expect(seen(-200, 36, 900)).toBe(false);
  });

  it('starts a figure taller than the screen once it fills three fifths of it', () => {
    expect(seen(300, 3300, 800)).toBe(true);
    expect(seen(600, 3600, 800)).toBe(false);
  });

  it('never starts a figure that is not laid out', () => {
    expect(seen(0, 0, 900)).toBe(false);
  });
});

/** A stand-in for an element with a class list and data attributes. */
function element(dataset: Record<string, string> = {}, rect = { top: 0, bottom: 0 }) {
  const classes = new Set<string>();
  return {
    dataset,
    classList: {
      add: (name: string) => classes.add(name),
      remove: (name: string) => classes.delete(name),
      contains: (name: string) => classes.has(name),
    },
    getBoundingClientRect: () => rect,
  };
}

/** Runs an inline script the way the document would, against a stand-in page. */
function run(
  script: string,
  page: { search?: string; reduced?: boolean; hidden?: boolean; stored?: string; figures?: ReturnType<typeof element>[]; on?: boolean },
) {
  const root = element();
  if (page.on) root.classList.add('m-on');
  const timers: Array<() => void> = [];
  const window: { __m?: unknown } = {};
  const figures = page.figures ?? [];
  const document = {
    documentElement: root,
    visibilityState: page.hidden ? 'hidden' : 'visible',
    querySelectorAll: () => figures.filter((figure) => figure.dataset.state === 'idle' && !figure.dataset.from),
  };

  new Function('document', 'location', 'matchMedia', 'setTimeout', 'window', 'innerHeight', 'localStorage', script)(
    document,
    { search: page.search ?? '' },
    () => ({ matches: page.reduced ?? false }),
    (callback: () => void) => timers.push(callback),
    window,
    900,
    { getItem: () => page.stored ?? null },
  );

  return { root, window, timers };
}

describe('the script in the document head', () => {
  it('gives the visit motion', () => {
    expect(run(PREPAINT_SCRIPT, {}).root.classList.contains('m-on')).toBe(true);
  });

  it('gives none with reduced motion, ?m=off, or when the reader turned it off', () => {
    expect(run(PREPAINT_SCRIPT, { reduced: true }).root.classList.contains('m-on')).toBe(false);
    expect(run(PREPAINT_SCRIPT, { search: '?m=off' }).root.classList.contains('m-on')).toBe(false);
    expect(run(PREPAINT_SCRIPT, { stored: 'off' }).root.classList.contains('m-on')).toBe(false);
    expect(run(PREPAINT_SCRIPT, { stored: 'on' }).root.classList.contains('m-on')).toBe(true);
  });

  it('takes motion back if the controller never started, and keeps it if it did', () => {
    const failed = run(PREPAINT_SCRIPT, {});
    failed.timers.forEach((timer) => timer());
    expect(failed.root.classList.contains('m-on')).toBe(false);

    const started = run(PREPAINT_SCRIPT, {});
    started.window.__m = {};
    started.timers.forEach((timer) => timer());
    expect(started.root.classList.contains('m-on')).toBe(true);
  });
});

describe('the script at the end of the body', () => {
  function page() {
    return [
      element({ fig: 'intro', state: 'idle' }, { top: 80, bottom: 430 }),
      element({ fig: 'lanes', state: 'idle' }, { top: 473, bottom: 709 }),
      element({ fig: 'capital', state: 'idle' }, { top: 1500, bottom: 1868 }),
    ];
  }

  it('starts the figures on screen and leaves the rest waiting', () => {
    const figures = page();
    run(BOOT_SCRIPT, { on: true, figures });
    expect(figures.map((figure) => figure.dataset.state)).toEqual(['playing', 'playing', 'idle']);
  });

  it('leaves a later act of a timeline to the controller, which starts it midway', () => {
    const figures = [element({ fig: 'capital', state: 'idle', from: '2600' }, { top: 100, bottom: 400 })];
    run(BOOT_SCRIPT, { on: true, figures });
    expect(figures[0]!.dataset.state).toBe('idle');
  });

  it('starts nothing in a background tab', () => {
    const figures = page();
    run(BOOT_SCRIPT, { on: true, hidden: true, figures });
    expect(figures.every((figure) => figure.dataset.state === 'idle')).toBe(true);
  });

  it('does nothing without motion, or when a frozen frame was asked for', () => {
    const still = page();
    run(BOOT_SCRIPT, { on: false, figures: still });
    expect(still.every((figure) => figure.dataset.state === 'idle')).toBe(true);

    const frozen = page();
    run(BOOT_SCRIPT, { on: true, search: '?m=lanes@900', figures: frozen });
    expect(frozen.every((figure) => figure.dataset.state === 'idle')).toBe(true);
  });
});
