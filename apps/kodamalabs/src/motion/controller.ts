/**
 * The script of the motion layer. It never draws a frame: CSS plays every
 * animation. This module moves figures between their states (see verbs.css),
 * inks the spine as the reader scrolls, and offers a few hooks for looking at
 * a timeline:
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
  /** Runs a finished figure backwards to a point of its timeline and holds it there. */
  undo(id: string, ms: number): void;
  /** Lets a held figure play on to its end. */
  resume(id: string): void;
  /** Turns motion on or off for this visit and the next ones. */
  enable(on: boolean): void;
  /** State of every figure, by id. */
  state(): Record<string, string>;
}

const SLOW_RATE = 0.25;
/** How much faster than it played a figure runs backwards. */
const REWIND_RATE = 4;
/** How far down the screen the spine is inked: it leads the reader. */
const INK_REACH = 0.86;

/** Where the reader's choice of motion is kept. Read before paint by scripts.ts. */
export const MOTION_KEY = 'kl:motion';

function figures(): Figure[] {
  return [...document.querySelectorAll<Figure>('[data-fig][data-state]')];
}

export function startMotion(): () => void {
  const query = new URLSearchParams(location.search).get('m') ?? '';
  const slow = query === 'slow';
  const frozen = /^([a-z-]+)@(\d+)$/.exec(query);
  const spine = document.querySelector<HTMLElement>('[data-spine]');
  const timers = new Set<number>();

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

  let inked = 0;
  /** Inks the spine down to `y` (in the viewport). It never goes back up. */
  function ink(y: number): void {
    if (!spine) return;
    const reach = y - spine.getBoundingClientRect().top;
    if (reach <= inked) return;
    inked = reach;
    spine.style.setProperty('--ink', `${Math.round(inked)}px`);
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
    // The line is there before anything arrives at it.
    ink(figure.getBoundingClientRect().bottom);
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
      ink(figure.getBoundingClientRect().bottom);
      for (const animation of figure.getAnimations({ subtree: true })) {
        animation.pause();
        animation.currentTime = ms;
      }
    }
  }

  /** Holds a figure at a point of its timeline: what is after it has not happened. */
  function hold(figure: Figure, ms: number): void {
    figure.dataset.state = 'held';
    for (const animation of figure.getAnimations({ subtree: true })) {
      animation.pause();
      animation.playbackRate = 1;
      animation.currentTime = ms;
    }
  }

  function undo(id: string, ms: number): void {
    for (const figure of group(id)) {
      if (figure.dataset.state !== 'done') continue;
      const run = begin(figure);
      figure.dataset.state = 'playing';
      const animations = figure.getAnimations({ subtree: true });
      const end = Math.max(ms, ...animations.map((animation) => Number(animation.effect?.getComputedTiming().endTime ?? 0)));
      for (const animation of animations) {
        animation.currentTime = end;
        animation.playbackRate = -REWIND_RATE;
        animation.play();
      }
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        if (runs.get(figure) === run) hold(figure, ms);
      }, (end - ms) / REWIND_RATE);
      timers.add(timer);
    }
  }

  function resume(id: string): void {
    for (const figure of group(id)) {
      if (figure.dataset.state !== 'held') continue;
      figure.dataset.state = 'playing';
      for (const animation of figure.getAnimations({ subtree: true })) animation.play();
      void settle(figure);
    }
  }

  /**
   * Starts the waiting figures that have come on screen, pauses the ones that
   * left it, inks the spine and the sentences the reader has reached. Nothing
   * is on screen while the tab is in the background.
   */
  function look(): void {
    const visible = document.visibilityState !== 'hidden';
    const viewport = window.innerHeight;
    const measured = figures().map((figure) => ({ figure, rect: figure.getBoundingClientRect() }));
    const sentences = [...document.querySelectorAll<HTMLElement>('[data-ink="wait"]')].map((sentence) => ({
      sentence,
      rect: sentence.getBoundingClientRect(),
    }));

    for (const { figure, rect } of measured) {
      const { state } = figure.dataset;
      if (state === 'idle' && !figure.dataset.with && visible && seen(rect.top, rect.bottom, viewport)) {
        for (const member of group(figure.dataset.fig ?? '')) play(member);
      } else if (state === 'playing') {
        figure.dataset.inview = String(visible && rect.bottom > 0 && rect.top < viewport);
      }
    }
    if (!visible) return;

    ink(viewport * INK_REACH);
    for (const { sentence, rect } of sentences) {
      if (rect.top < viewport * INK_REACH && rect.bottom > 0) sentence.dataset.ink = 'on';
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

  /** A sentence that has been inked is plain text again. */
  function onInked(event: TransitionEvent): void {
    const target = event.target as HTMLElement;
    if (target.dataset?.ink === 'on') target.dataset.ink = 'done';
  }

  function enable(on: boolean): void {
    try {
      localStorage.setItem(MOTION_KEY, on ? 'on' : 'off');
    } catch {
      // Private mode: the choice lasts for this visit only.
    }
    document.documentElement.classList.toggle('m-on', on);
    if (on) look();
  }

  // Figures the inline boot script already started.
  for (const figure of figures()) {
    if (figure.dataset.state === 'playing') {
      ink(figure.getBoundingClientRect().bottom);
      void settle(figure);
    }
  }

  if (frozen) seek(frozen[1]!, Number(frozen[2]));
  look();

  window.addEventListener('scroll', onMove, { passive: true });
  window.addEventListener('resize', onMove);
  // No frame is drawn in a background tab, so this one does not wait for a frame.
  document.addEventListener('visibilitychange', look);
  document.addEventListener('transitionend', onInked);

  const api: MotionApi = {
    replay,
    seek,
    undo,
    resume,
    enable,
    state: () => Object.fromEntries(figures().map((figure) => [figure.dataset.fig ?? '', figure.dataset.state ?? ''])),
  };
  window.__m = api;

  return () => {
    window.removeEventListener('scroll', onMove);
    window.removeEventListener('resize', onMove);
    document.removeEventListener('visibilitychange', look);
    document.removeEventListener('transitionend', onInked);
    cancelAnimationFrame(scheduled);
    for (const timer of timers) window.clearTimeout(timer);
    delete window.__m;
  };
}
