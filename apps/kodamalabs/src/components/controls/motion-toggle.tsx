'use client';

import { useEffect, useState } from 'react';

import type { MotionApi } from '@/motion/controller';

import { QUIET_CONTROL } from './replay-button';

/**
 * Turns the page's motion off and on, and remembers it. It appears once the
 * page is running, and not at all for a reader whose system asks for reduced
 * motion: there the page is already still, and the switch would do nothing.
 */
export function MotionToggle({ on, off }: { on: string; off: string }) {
  const [state, setState] = useState<'unknown' | 'on' | 'off'>('unknown');

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const root = document.documentElement;
    const read = () => setState(root.classList.contains('m-on') ? 'on' : 'off');
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  if (state === 'unknown') return null;

  return (
    <button
      type="button"
      aria-pressed={state === 'on'}
      className={QUIET_CONTROL}
      onClick={() => (window.__m as MotionApi | undefined)?.enable(state !== 'on')}
    >
      {state === 'on' ? on : off}
    </button>
  );
}
