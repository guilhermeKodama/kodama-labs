/**
 * The Cerne brand: the product name and the mark, a cross-section of a
 * trunk with eccentric growth rings around a resin core (the design
 * canvas). The in-app logo (components/cap/logo.tsx) draws the same
 * geometry with theme tokens; this module also serves the places CSS
 * cannot reach — the manifest, the browser theme color and the generated
 * icon files (scripts/brand-icons.ts) — so the hex values below must match
 * --cap-brand / --cap-resin / --cap-bg-editor in src/app/globals.css
 * (src/lib/__tests__/brand.test.ts checks it).
 */

export const BRAND = "Cerne";

/** Where people ask for access and write to the team (the homepage, the closed sign-up page). */
export const CONTACT_EMAIL = "contato@kodamavending.com.br";

export interface Ring {
  cx: number;
  cy: number;
  r: number;
  /** Stroke width in viewBox units. */
  w: number;
}

export interface MarkShape {
  rings: readonly Ring[];
  core: { cx: number; cy: number; r: number };
}

/** viewBox of every mark: 0 0 64 64. */
export const MARK_VIEWBOX = 64;

/** Three rings and the core: large sizes (sign-in, 404, app icons). */
export const MARK_FULL: MarkShape = {
  rings: [
    { cx: 32, cy: 32, r: 26, w: 3.2 },
    { cx: 30.4, cy: 33.2, r: 18.5, w: 3 },
    { cx: 28.8, cy: 34.4, r: 11.5, w: 2.8 },
  ],
  core: { cx: 27.6, cy: 35.3, r: 5 },
};

/** Two rings and a larger core: small sizes (sidebar, navigation icon, 32px). */
export const MARK_SIMPLE: MarkShape = {
  rings: [
    { cx: 32, cy: 32, r: 26, w: 5 },
    { cx: 30.4, cy: 33.2, r: 17, w: 4.6 },
  ],
  core: { cx: 28.8, cy: 34.4, r: 9 },
};

/** One ring and the core: favicon sizes (16–48px). */
export const MARK_TINY: MarkShape = {
  rings: [{ cx: 32, cy: 32, r: 22, w: 8 }],
  core: { cx: 29, cy: 34, r: 9 },
};

/** Brand colors (light theme values of the tokens, plus the icon tones). */
export const BRAND_COLORS = {
  /** --cap-brand (light): cerne, the heartwood. */
  heartwood: "#5b2e1f",
  /** --cap-resin (light). */
  resin: "#c4862b",
  /** --cap-resin (dark): the core on a dark ground. */
  resinBright: "#e0a04a",
  /** --cap-text-1 (dark): alburno, the sapwood. */
  sapwood: "#f2ebdd",
  /** --cap-bg-editor (light). */
  paper: "#fbf8f2",
  /** --cap-bg-editor (dark): carvão. */
  charcoal: "#1f1a17",
} as const;

/** Browser and manifest theme colors: the page surface of each theme. */
export const THEME_COLOR = { light: BRAND_COLORS.paper, dark: BRAND_COLORS.charcoal } as const;

export interface MarkSvgOptions {
  shape?: MarkShape;
  rings: string;
  core: string;
  /** Background square behind the mark; none when absent. */
  background?: string;
  /** Corner radius of the background in viewBox units (0 = full bleed). */
  radius?: number;
  /** Fraction of the canvas the mark spans (1 = edge to edge). */
  scale?: number;
  /** Rendered size in px (width and height attributes). */
  size?: number;
}

const fmt = (n: number) => Number(n.toFixed(3)).toString();

/** The mark as a standalone SVG document (icons, icon.svg). */
export function markSvg({ shape = MARK_FULL, rings, core, background, radius = 14, scale = 1, size = MARK_VIEWBOX }: MarkSvgOptions): string {
  const offset = (MARK_VIEWBOX * (1 - scale)) / 2;
  const transform = scale === 1 ? "" : ` transform="translate(${fmt(offset)} ${fmt(offset)}) scale(${fmt(scale)})"`;
  const bg = background ? `<rect width="64" height="64" rx="${fmt(radius)}" fill="${background}"/>` : "";
  const circles = shape.rings
    .map((ring) => `<circle cx="${fmt(ring.cx)}" cy="${fmt(ring.cy)}" r="${fmt(ring.r)}" stroke-width="${fmt(ring.w)}"/>`)
    .join("");
  const c = shape.core;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">` +
    bg +
    `<g${transform}><g fill="none" stroke="${rings}">${circles}</g>` +
    `<circle cx="${fmt(c.cx)}" cy="${fmt(c.cy)}" r="${fmt(c.r)}" fill="${core}"/></g>` +
    `</svg>`
  );
}

/** The app icon look: sapwood rings and a resin core on heartwood. */
export const APP_ICON = {
  rings: BRAND_COLORS.sapwood,
  core: BRAND_COLORS.resinBright,
  background: BRAND_COLORS.heartwood,
} as const;

/**
 * Where the icon files are served (written by scripts/brand-icons.ts). New
 * artwork gets new names: launchers, the browser and Cloudflare cache an
 * icon by its URL, and a query string does not always get past them.
 */
export const ICONS = {
  apple: "/icons/cerne-apple-180.png",
  app192: "/icons/cerne-192.png",
  app512: "/icons/cerne-512.png",
  maskable512: "/icons/cerne-maskable-512.png",
  badge: "/icons/cerne-badge-96.png",
} as const;
