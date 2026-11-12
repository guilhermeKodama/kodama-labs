'use client';

import { useEffect, useRef, useState } from 'react';

import type { MotionApi } from './controller';

interface FigureControlProps {
  /**
   * undo: run the finished figure back to `at` and hold it there.
   * confirm: let the held figure play on.
   */
  act: 'undo' | 'confirm';
  /** The point of the timeline the figure is held at, in ms. */
  at: number;
  /** What the control does, for a reader who cannot see the drawing. */
  label: string;
  /** The drawn control. */
  children: React.ReactNode;
}

/** The state a figure has to be in for each act to mean something. */
const ACTS_IN = { undo: 'done', confirm: 'held' } as const;

/**
 * A part of a drawing the reader can act on. It is a control only while its
 * act would do something: with motion off, or in any other state of the
 * figure, it is just part of the drawing, with no role and no focus.
 */
export function FigureControl({ act, at, label, children }: FigureControlProps) {
  const ref = useRef<SVGGElement>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const figure = ref.current?.closest<SVGElement>('[data-fig]');
    if (!figure) return;

    const read = () =>
      setLive(document.documentElement.classList.contains('m-on') && figure.dataset.state === ACTS_IN[act]);
    read();
    const figureObserver = new MutationObserver(read);
    figureObserver.observe(figure, { attributes: true, attributeFilter: ['data-state'] });
    figureObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => figureObserver.disconnect();
  }, [act]);

  function run() {
    const motion = window.__m as MotionApi | undefined;
    const id = ref.current?.closest<SVGElement>('[data-fig]')?.dataset.fig;
    if (!live || !motion || !id) return;
    if (act === 'undo') motion.undo(id, at);
    else motion.resume(id);
  }

  return (
    <g
      ref={ref}
      className="fig-control"
      data-act={act}
      {...(live
        ? {
            role: 'button',
            tabIndex: 0,
            'aria-label': label,
            onClick: run,
            onKeyDown: (event: React.KeyboardEvent) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              run();
            },
          }
        : {})}
    >
      {children}
    </g>
  );
}
