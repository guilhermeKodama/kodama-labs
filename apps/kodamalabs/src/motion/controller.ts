/**
 * The script of the motion layer. It never draws a frame: CSS plays every
 * animation. This module only moves figures between their three states (see
 * verbs.css) and offers a few hooks for looking at a timeline:
 *
 *   ?m=off            no motion at all (decided before paint, in scripts.ts)
 *   ?m=slow           everything at a quarter of the speed
 *   ?m=<figure>@<ms>  freeze that figure at that point of its timeline
 *   ?m=all@<ms>       the same, for every figure
 *
 * The same is available from the console as `window.__m`.
 */
import { seen } from './scripts';

type Figure = HTMLElement | SVGElement;

export interface MotionApi {
  /** Plays a figure (or `all`) from the start. */
  replay(id: string): void;
  /** Freezes a figure (or `all`) at a point of its timeline, in ms from its trigger. */
  seek(id: string, ms: number): void;
  /** State of every figure, by id. */
  state(): Record<string, string>;
}

const SLOW_RATE = 0.25;

function figures(): Figure[] {
  return [...document.querySelectorAll<Figure>('[data-fig][data-state]')];
}

export function startMotion(): () => void {
  const query = new URLSearchParams(location.search).get('m') ?? '';
  const slow = query === 'slow';
  const frozen = /^([a-z-]+)@(\d+)$/.exec(query);

  /** Each start of a figure gets a number, so a superseded run cannot end the new one. */
  const runs = new WeakMap<Figure, number>();

  function begin(figure: Figure): number {
    const run = (runs.get(figure) ?? 0) + 1;
    runs.set(figure, run);
    return run;
  }

  /** A figure and the figures that start together with it. */
  function group(id: string): Figure[] {
    return figures().filter(
      (figure) => id === 'all' || figure.dataset.fig === id || figure.dataset.with === id,
    );
  }

  /** Marks a playing figure done once all its animations have finished. */
  async function settle(figure: Figure): Promise<void> {
    const run = begin(figure);
    // Asking for the animations applies the pending style change first.
    const animations = figure.getAnimations({ subtree: true });
    if (slow) for (const animation of animations) animation.playbackRate = SLOW_RATE;
    await Promise.allSettled(animations.map((animation) => animation.finished));
    if (runs.get(figure) === run && figure.dataset.state === 'playing') {
      figure.dataset.state = 'done';
      delete figure.dataset.inview;
    }
  }

  function play(figure: Figure): void {
    figure.dataset.state = 'playing';
    void settle(figure);
  }

  /** Back to the first frame: `done` drops the animations, reading layout applies that. */
  function rewind(figure: Figure): void {
    figure.dataset.state = 'done';
    void figure.getBoundingClientRect();
  }

  function replay(id: string): void {
    for (const figure of group(id)) {
      rewind(figure);
      play(figure);
    }
  }

  function seek(id: string, ms: number): void {
    for (const figure of group(id)) {
      rewind(figure);
      begin(figure);
      figure.dataset.state = 'playing';
      for (const animation of figure.getAnimations({ subtree: true })) {
        animation.pause();
        animation.currentTime = ms;
      }
    }
  }

  /**
   * Starts the waiting figures that have come on screen, and pauses the ones
   * that left it. Nothing is on screen while the tab is in the background.
   */
  function look(): void {
    const visible = document.visibilityState !== 'hidden';
    const viewport = window.innerHeight;
    const measured = figures().map((figure) => ({ figure, rect: figure.getBoundingClientRect() }));

    for (const { figure, rect } of measured) {
      const { state } = figure.dataset;
      if (state === 'idle' && !figure.dataset.with && visible && seen(rect.top, rect.bottom, viewport)) {
        for (const member of group(figure.dataset.fig ?? '')) play(member);
      } else if (state === 'playing') {
        figure.dataset.inview = String(visible && rect.bottom > 0 && rect.top < viewport);
      }
    }
  }

  let scheduled = 0;
  function onMove(): void {
    if (scheduled) return;
    scheduled = requestAnimationFrame(() => {
      scheduled = 0;
      look();
    });
  }

  // Figures the inline boot script already started.
  for (const figure of figures()) {
    if (figure.dataset.state === 'playing') void settle(figure);
  }

  if (frozen) seek(frozen[1]!, Number(frozen[2]));
  look();

  window.addEventListener('scroll', onMove, { passive: true });
  window.addEventListener('resize', onMove);
  // No frame is drawn in a background tab, so this one does not wait for a frame.
  document.addEventListener('visibilitychange', look);

  const api: MotionApi = {
    replay,
    seek,
    state: () => Object.fromEntries(figures().map((figure) => [figure.dataset.fig ?? '', figure.dataset.state ?? ''])),
  };
  window.__m = api;

  return () => {
    window.removeEventListener('scroll', onMove);
    window.removeEventListener('resize', onMove);
    document.removeEventListener('visibilitychange', look);
    cancelAnimationFrame(scheduled);
    delete window.__m;
  };
}
