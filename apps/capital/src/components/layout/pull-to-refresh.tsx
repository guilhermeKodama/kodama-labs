'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';
import { RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

interface PullToRefreshProps {
  /** Awaited so the indicator knows when to stop spinning; errors are
   *  logged here, not surfaced — that stays the store layer's job. */
  onRefresh: () => Promise<void>;
  children: React.ReactNode;
  /** Escape hatch for a future (padded) route that shouldn't offer this;
   *  no current call site sets it. */
  disabled?: boolean;
}

type Phase = 'idle' | 'pulling' | 'armed' | 'refreshing';

// Module constants rather than props: one call site today. Promote to props
// if a second one ever needs a different feel.
const PULL_THRESHOLD = 64; // px of *visible* travel to arm a refresh on release
const MAX_PULL = 120; // px — hard visual ceiling on top of the rubber-band curve
const RESISTANCE_SPAN = 400; // px — raw-distance scale of the rubber-band curve
const RESISTANCE = 0.55; // iOS UIScrollView-style damping constant
const DRAG_SLOP = 10; // px of raw movement before a gesture commits to a direction
const SNAP_MS = 220; // release/settle animation duration
const MIN_SPIN_MS = 400; // floor so the spinner never just flashes on a fast refetch
const INDICATOR_TRAVEL = 40; // px of visible pull for the indicator to fully reveal

// iOS-style rubber-band easing: grows quickly at first, then asymptotically
// approaches `span` as `raw` grows. Separately hard-clamped to MAX_PULL by
// the caller, so drag distance alone can never move the indicator past a
// fixed ceiling no matter how far the finger travels.
function rubberBand(raw: number, span: number, constant: number): number {
  if (raw <= 0) return 0;
  return (raw * span * constant) / (span + constant * raw);
}

// Mirrors AppShell's local mount-check (useSyncExternalStore instead of
// setState-in-effect). Duplicated rather than shared for just 2 consumers.
function useMounted() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}

/**
 * Hand-rolled pull-to-refresh for the (padded) app routes, which scroll via
 * `document`/`body` — there is no wrapping scroll container (see AppShell).
 * Only ever active for touch input on a mobile-width viewport.
 */
export function PullToRefresh({ onRefresh, children, disabled = false }: PullToRefreshProps) {
  const isMobile = useIsMobile();
  const mounted = useMounted();
  const t = useTranslations('common');
  const active = isMobile && !disabled;

  const [phase, setPhase] = useState<Phase>('idle');
  const phaseRef = useRef<Phase>('idle');
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const contentRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const iconRef = useRef<SVGSVGElement>(null);

  const activePointerIdRef = useRef<number | null>(null);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  // Set once a tracked pointer has moved past DRAG_SLOP on a dominant
  // downward path — distinguishes "this is a pull" from "this was a tap"
  // (which must be left completely alone for native click handling) and
  // from a normal scroll/horizontal swipe.
  const confirmedRef = useRef(false);
  const settleTimeoutRef = useRef<number | undefined>(undefined);

  // Writes the pull distance straight to the DOM — no setState — so
  // dragging stays smooth at 60fps. React state only tracks the coarse
  // idle/pulling/armed/refreshing phase, which changes a handful of times
  // per gesture, never once per pointermove.
  const applyPull = useCallback((distance: number) => {
    if (contentRef.current) {
      contentRef.current.style.transform = `translateY(${distance}px)`;
    }
    if (indicatorRef.current) {
      indicatorRef.current.style.transform = `translateY(${distance - INDICATOR_TRAVEL}px)`;
      indicatorRef.current.style.opacity = String(Math.min(distance / INDICATOR_TRAVEL, 1));
    }
    if (iconRef.current) {
      const progress = Math.min(distance / PULL_THRESHOLD, 1);
      iconRef.current.style.transform = `rotate(${progress * 180}deg)`;
    }
  }, []);

  // Establishes the resting inline styles once refs exist. Deliberately not
  // expressed as JSX `style` props — a static style object there would be
  // re-applied by React on every phase-driven re-render, stomping the
  // imperative drag/settle writes mid-gesture.
  useEffect(() => {
    if (contentRef.current) contentRef.current.style.transition = 'none';
    if (indicatorRef.current) indicatorRef.current.style.transition = 'none';
    applyPull(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, active]);

  useEffect(() => () => window.clearTimeout(settleTimeoutRef.current), []);

  const withSettleTransition = useCallback((run: () => void) => {
    const els = [contentRef.current, indicatorRef.current];
    for (const el of els) {
      if (el) el.style.transition = `transform ${SNAP_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
    }
    run();
    window.clearTimeout(settleTimeoutRef.current);
    settleTimeoutRef.current = window.setTimeout(() => {
      for (const el of els) if (el) el.style.transition = 'none';
    }, SNAP_MS);
  }, []);

  const snapToIdle = useCallback(() => {
    withSettleTransition(() => applyPull(0));
    if (contentRef.current) contentRef.current.style.willChange = '';
    if (iconRef.current) iconRef.current.style.transform = '';
    setPhase('idle');
  }, [applyPull, withSettleTransition]);

  const runRefresh = useCallback(async () => {
    setPhase('refreshing');
    withSettleTransition(() => applyPull(PULL_THRESHOLD));
    if (iconRef.current) iconRef.current.style.transform = ''; // animate-spin owns rotation now

    const minDuration = new Promise<void>((resolve) => {
      window.setTimeout(resolve, MIN_SPIN_MS);
    });

    try {
      await Promise.all([onRefresh(), minDuration]);
    } catch (error) {
      console.error('[PullToRefresh] onRefresh rejected:', error);
    } finally {
      snapToIdle();
    }
  }, [onRefresh, applyPull, withSettleTransition, snapToIdle]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerType !== 'touch') return; // trackpad/mouse: never hijack drag/selection
      if (phaseRef.current === 'refreshing') return; // one refresh at a time
      if (activePointerIdRef.current !== null) return; // a second finger: ignore
      if (window.scrollY > 0) return; // only from the very top of the page

      activePointerIdRef.current = event.pointerId;
      startXRef.current = event.clientX;
      startYRef.current = event.clientY;
      confirmedRef.current = false;
      // No setPointerCapture here: capturing on every touchstart at scrollY
      // 0 — including plain taps on a button that happens to sit up there —
      // would be enough to disrupt native click resolution on tap targets.
      // Capture is deferred to the point the gesture is actually confirmed.
    },
    []
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (activePointerIdRef.current !== event.pointerId) return;

      const dx = event.clientX - startXRef.current;
      const dy = event.clientY - startYRef.current;

      if (!confirmedRef.current) {
        if (Math.hypot(dx, dy) < DRAG_SLOP) return; // not enough movement to tell intent yet

        const isDownwardPull = dy > 0 && dy > Math.abs(dx) && window.scrollY === 0;
        if (!isDownwardPull) {
          // Diagonal/horizontal/upward, or the page already scrolled out
          // from under us: not our gesture. Stop tracking and leave this
          // touch to native scrolling, untouched.
          activePointerIdRef.current = null;
          return;
        }

        confirmedRef.current = true;
        if (contentRef.current) contentRef.current.style.willChange = 'transform';
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Ignorable — worst case the gesture doesn't survive the finger
          // leaving this element's bounds.
        }
      }

      const resisted = Math.min(rubberBand(dy, RESISTANCE_SPAN, RESISTANCE), MAX_PULL);
      applyPull(resisted);

      const nextPhase: Phase = resisted >= PULL_THRESHOLD ? 'armed' : 'pulling';
      setPhase((prev) => {
        if (prev === nextPhase) return prev;
        if (nextPhase === 'armed' && prev !== 'armed') navigator.vibrate?.(10);
        return nextPhase;
      });
    },
    [applyPull]
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (activePointerIdRef.current !== event.pointerId) return;
      activePointerIdRef.current = null;

      if (!confirmedRef.current) return; // a tap, or never crossed the slop threshold

      confirmedRef.current = false;
      if (phaseRef.current === 'armed') {
        void runRefresh();
      } else {
        snapToIdle();
      }
    },
    [runRefresh, snapToIdle]
  );

  const handlePointerCancel = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (activePointerIdRef.current !== event.pointerId) return;
      activePointerIdRef.current = null;
      const wasConfirmed = confirmedRef.current;
      confirmedRef.current = false;
      // The browser took the gesture away from us (e.g. an OS edge-swipe) —
      // always treat this as an aborted pull, never a deliberate release.
      if (wasConfirmed && phaseRef.current !== 'refreshing') snapToIdle();
    },
    [snapToIdle]
  );

  // pointermove's preventDefault() does not stop the paired native touchmove
  // from scrolling the page — they're independent event streams for the
  // same physical gesture. Only a real touchmove listener explicitly marked
  // non-passive can block the scroll, and React attaches its own touch
  // listeners as passive, so this has to be wired by hand (same approach
  // vaul uses internally for its own drag-to-dismiss).
  useEffect(() => {
    const el = contentRef.current;
    if (!el || !active) return;

    const onTouchMove = (event: TouchEvent) => {
      if (confirmedRef.current && event.cancelable) event.preventDefault();
    };
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => el.removeEventListener('touchmove', onTouchMove);
  }, [active]);

  // If disabled (or the viewport crosses the mobile breakpoint) mid-gesture,
  // the pointer handlers below get detached on the next render — without
  // this, an in-flight drag would be left stuck at whatever transform it
  // last had.
  useEffect(() => {
    if (!active && phaseRef.current !== 'idle') {
      activePointerIdRef.current = null;
      confirmedRef.current = false;
      snapToIdle();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const isVisuallyActive = phase === 'armed' || phase === 'refreshing';

  return (
    <>
      {mounted &&
        active &&
        createPortal(
          <div
            ref={indicatorRef}
            className="pt-safe pointer-events-none fixed inset-x-0 top-0 z-40 flex justify-center opacity-0"
          >
            <div
              aria-hidden="true"
              className={cn(
                'mt-2 flex size-9 items-center justify-center rounded-full border shadow-lg shadow-black/30 backdrop-blur-sm transition-colors duration-200',
                isVisuallyActive
                  ? 'border-transparent bg-gradient-to-br from-emerald-400 to-cyan-500'
                  : 'border-slate-800 bg-slate-900/90'
              )}
            >
              <RefreshCw
                ref={iconRef}
                className={cn(
                  'size-4 transition-colors duration-200',
                  isVisuallyActive ? 'text-white' : 'text-slate-400',
                  phase === 'refreshing' && 'animate-spin'
                )}
              />
            </div>
            <span className="sr-only" role="status" aria-live="polite">
              {phase === 'refreshing' ? t('refreshing') : ''}
            </span>
          </div>,
          document.body
        )}
      <div
        ref={contentRef}
        onPointerDown={active ? handlePointerDown : undefined}
        onPointerMove={active ? handlePointerMove : undefined}
        onPointerUp={active ? handlePointerUp : undefined}
        onPointerCancel={active ? handlePointerCancel : undefined}
      >
        {children}
      </div>
    </>
  );
}
