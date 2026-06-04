import { cn } from '@/lib/utils';

interface MarkProps {
  size?: number;
  className?: string;
}

const base = (className?: string) => cn('text-emerald-400', className);

/**
 * Option 1 — Vitruvian.
 * Circle inscribed in square with center pivot. The Renaissance ideal of
 * proportion reduced to pure geometry. Reads as: harmony, fundamentals,
 * the act of measuring.
 */
export function VitruvianMark({ size = 24, className }: MarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={base(className)}
      aria-hidden="true"
    >
      <line
        x1="12"
        y1="2.6"
        x2="12"
        y2="21.4"
        stroke="currentColor"
        strokeWidth="0.55"
        opacity="0.3"
      />
      <line
        x1="2.6"
        y1="12"
        x2="21.4"
        y2="12"
        stroke="currentColor"
        strokeWidth="0.55"
        opacity="0.3"
      />
      <circle cx="12" cy="12" r="9.4" stroke="currentColor" strokeWidth="1.15" />
      <rect
        x="5.4"
        y="5.4"
        width="13.2"
        height="13.2"
        stroke="currentColor"
        strokeWidth="1.15"
      />
      <circle cx="12" cy="12" r="1.25" fill="currentColor" />
    </svg>
  );
}

/**
 * Option 2 — Aerial Screw.
 * Da Vinci's helicopter, abstracted as a rising helix with a focal apex.
 * Reads as: ascent, defying gravity, an idea nobody's tried yet.
 */
export function HelixMark({ size = 24, className }: MarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={base(className)}
      aria-hidden="true"
    >
      <line
        x1="12"
        y1="3"
        x2="12"
        y2="19"
        stroke="currentColor"
        strokeWidth="0.55"
        opacity="0.35"
      />
      <ellipse
        cx="12"
        cy="8"
        rx="4"
        ry="1.4"
        stroke="currentColor"
        strokeWidth="1.1"
      />
      <ellipse
        cx="12"
        cy="13"
        rx="6.5"
        ry="1.9"
        stroke="currentColor"
        strokeWidth="1.1"
      />
      <ellipse
        cx="12"
        cy="18.5"
        rx="8.5"
        ry="2.4"
        stroke="currentColor"
        strokeWidth="1.1"
      />
      <circle cx="12" cy="3" r="1.4" fill="currentColor" />
    </svg>
  );
}

/**
 * Option 3 — Drafting Compass.
 * Hinge housing at the top, two legs swinging from it, a curved adjustment
 * brace between them, the arc still fresh on the page, distinct needle and
 * pencil tips. Reads unambiguously as a drafting compass at 16px+.
 */
export function CompassMark({ size = 24, className }: MarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={base(className)}
      aria-hidden="true"
    >
      {/* Arc the compass just drew on the page. */}
      <path
        d="M 4 19 Q 12 22.8 20 19"
        stroke="currentColor"
        strokeWidth="0.95"
        strokeLinecap="round"
        opacity="0.55"
      />

      {/* Left leg — the needle side. */}
      <line
        x1="12"
        y1="6.2"
        x2="4.8"
        y2="20"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />

      {/* Right leg — the pencil side. */}
      <line
        x1="12"
        y1="6.2"
        x2="19.2"
        y2="20"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />

      {/* Curved adjustment brace between the legs — the unmistakable
          compass tell. */}
      <path
        d="M 8.6 13 Q 12 11.2 15.4 13"
        stroke="currentColor"
        strokeWidth="0.95"
        strokeLinecap="round"
        opacity="0.7"
      />

      {/* Hinge housing at the top — a small rounded body, not just a dot. */}
      <rect
        x="9.8"
        y="2.6"
        width="4.4"
        height="4"
        rx="1.1"
        fill="currentColor"
      />

      {/* Adjustment thumbscrew next to the hinge. */}
      <circle cx="15.2" cy="4.4" r="0.7" fill="currentColor" opacity="0.7" />

      {/* Pencil tip — small filled triangle pointing out and down. */}
      <path
        d="M 19.2 20 L 20.6 22.4 L 17.7 21.9 Z"
        fill="currentColor"
      />

      {/* Needle tip — sharper, slightly smaller triangle. */}
      <path
        d="M 4.8 20 L 3.4 22.4 L 6.3 21.9 Z"
        fill="currentColor"
        opacity="0.85"
      />
    </svg>
  );
}

/**
 * Option 4 — Mechanism.
 * Eight-toothed gear with a central hub. The most directly mechanical of
 * the five — reads as contraption, gadget, Inspector Gadget vibe.
 */
export function GearMark({ size = 24, className }: MarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={base(className)}
      aria-hidden="true"
    >
      <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
        <line x1="12" y1="2" x2="12" y2="4.4" />
        <line x1="12" y1="19.6" x2="12" y2="22" />
        <line x1="2" y1="12" x2="4.4" y2="12" />
        <line x1="19.6" y1="12" x2="22" y2="12" />
        <line x1="4.93" y1="4.93" x2="6.7" y2="6.7" />
        <line x1="19.07" y1="4.93" x2="17.3" y2="6.7" />
        <line x1="4.93" y1="19.07" x2="6.7" y2="17.3" />
        <line x1="19.07" y1="19.07" x2="17.3" y2="17.3" />
      </g>
      <circle cx="12" cy="12" r="5.4" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </svg>
  );
}

/**
 * Option 5 — Ornithopter Wing.
 * A stylized wing arc with three feather ribs, lifted from da Vinci's
 * flying-machine sketches. Reads as: flight, ambition, the impossible
 * being attempted.
 */
export function WingMark({ size = 24, className }: MarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={base(className)}
      aria-hidden="true"
    >
      <path
        d="M 2.5 19 Q 8 4.5 22 7 Q 17 12.5 3.5 19.8 Z"
        stroke="currentColor"
        fill="currentColor"
        fillOpacity="0.12"
        strokeWidth="1.15"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <line
        x1="7.5"
        y1="16.5"
        x2="11"
        y2="8.8"
        stroke="currentColor"
        strokeWidth="0.8"
        strokeLinecap="round"
        opacity="0.55"
      />
      <line
        x1="11.5"
        y1="15.5"
        x2="15"
        y2="8.3"
        stroke="currentColor"
        strokeWidth="0.8"
        strokeLinecap="round"
        opacity="0.45"
      />
      <line
        x1="15.5"
        y1="14"
        x2="19"
        y2="7.8"
        stroke="currentColor"
        strokeWidth="0.75"
        strokeLinecap="round"
        opacity="0.35"
      />
    </svg>
  );
}

export type BrandOption = {
  id: 'vitruvian' | 'helix' | 'compass' | 'gear' | 'wing';
  name: string;
  tagline: string;
  description: string;
  Component: (props: MarkProps) => React.ReactElement;
};

export const BRAND_OPTIONS: readonly BrandOption[] = [
  {
    id: 'vitruvian',
    name: 'Vitruvian',
    tagline: 'Geometric harmony',
    description:
      'Circle, inscribed square, center pivot. The Renaissance ideal of proportion reduced to pure structure. The most foundational of the five — reads as harmony, fundamentals, the act of measuring.',
    Component: VitruvianMark,
  },
  {
    id: 'helix',
    name: 'Aerial Screw',
    tagline: "Da Vinci's helicopter",
    description:
      'A rising helix with a focal apex. Three loops growing wider as they descend, central shaft holding the structure. Reads as ascent, lift, an idea nobody has tried yet.',
    Component: HelixMark,
  },
  {
    id: 'compass',
    name: 'Drafting Compass',
    tagline: "The inventor's tool",
    description:
      'Two arms swinging from a pivot, the arc still fresh on the page. The most "act of inventing" of the five — reads as construction, precision, deliberate craft.',
    Component: CompassMark,
  },
  {
    id: 'gear',
    name: 'Mechanism',
    tagline: 'Contraption',
    description:
      'Eight-toothed gear with central hub. The most directly mechanical — reads as contraption, gadget, the Inspector-Gadget tinkerer who builds things that click together.',
    Component: GearMark,
  },
  {
    id: 'wing',
    name: 'Ornithopter Wing',
    tagline: 'Flying machine',
    description:
      'Stylized wing arc with three feather ribs, lifted from da Vinci\'s ornithopter sketches. Reads as flight, ambition, the impossible being attempted.',
    Component: WingMark,
  },
] as const;
