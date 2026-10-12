/**
 * The two scripts that run inline in the document, before the page hydrates.
 * They are written as ordinary functions and turned into source text, so they
 * are type-checked and tested; each must therefore use nothing from outside
 * its own body except what it is passed.
 */

declare global {
  interface Window {
    __m?: unknown;
  }
}

/**
 * Whether enough of a figure is on screen for it to start: two fifths of it,
 * or, for a figure taller than the screen, three fifths of the screen.
 */
export function seen(top: number, bottom: number, viewport: number): boolean {
  const visible = Math.min(bottom, viewport) - Math.max(top, 0);
  return bottom > top && (visible >= (bottom - top) * 0.4 || visible >= viewport * 0.6);
}

/**
 * In the document head, before first paint. Decides whether this visit gets
 * motion and says so with one class on <html>, so animated parts are hidden
 * from the very first frame instead of flashing in and then restarting.
 *
 * No motion with reduced motion, with `?m=off`, when the reader turned it off
 * (the footer's switch), or without JavaScript (this never runs). If the controller has not started three seconds later the class
 * is removed again, so a failed script can never leave part of the page hidden.
 */
export function prepaint(): void {
  try {
    const root = document.documentElement;
    if (new URLSearchParams(location.search).get('m') === 'off') return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    try {
      if (localStorage.getItem('kl:motion') === 'off') return;
    } catch {
      // No storage: motion stays on.
    }
    root.classList.add('m-on');
    setTimeout(function () {
      if (!window.__m) root.classList.remove('m-on');
    }, 3000);
  } catch {
    // No motion is a fine outcome.
  }
}

/**
 * At the end of the body. Starts the figures that are on screen at load, on
 * the first frame, without waiting for the page to hydrate. A page opened in
 * a background tab (or prerendered) starts nothing: the controller does, when
 * the reader gets to it.
 */
export function boot(isSeen: (top: number, bottom: number, viewport: number) => boolean): void {
  try {
    if (!document.documentElement.classList.contains('m-on')) return;
    if (document.visibilityState === 'hidden') return;
    // A frozen frame was asked for (?m=<figure>@<ms>): the controller sets it.
    if ((new URLSearchParams(location.search).get('m') || '').indexOf('@') >= 0) return;

    const waiting = document.querySelectorAll<HTMLElement>('[data-fig][data-state="idle"]:not([data-with])');
    for (let i = 0; i < waiting.length; i++) {
      const figure = waiting[i]!;
      const rect = figure.getBoundingClientRect();
      if (!isSeen(rect.top, rect.bottom, innerHeight)) continue;
      figure.dataset.state = 'playing';
      const followers = document.querySelectorAll<HTMLElement>('[data-with="' + figure.dataset.fig + '"]');
      for (let j = 0; j < followers.length; j++) followers[j]!.dataset.state = 'playing';
    }
  } catch {
    // The controller starts them once the page has hydrated.
  }
}

export const PREPAINT_SCRIPT = `(${prepaint.toString()})()`;
export const BOOT_SCRIPT = `(${boot.toString()})(${seen.toString()})`;
