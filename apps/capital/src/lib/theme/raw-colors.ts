/**
 * Raw color detection and the palette → token mapping behind the theme
 * tokens in src/app/globals.css. Used by the no-raw-colors guard test and
 * by scripts/codemod-color-tokens.ts, which rewrites palette classes that
 * slip back in (e.g. when a branch written before the tokens is merged).
 */

const PALETTES = [
  "slate", "gray", "zinc", "neutral", "stone", "red", "orange", "amber", "yellow", "lime", "green", "emerald",
  "teal", "cyan", "sky", "blue", "indigo", "violet", "purple", "fuchsia", "pink", "rose", "black", "white",
];

// Longest first, so "border-t" is preferred over "border" where both fit.
const UTILITIES = [
  "inset-shadow", "ring-offset", "placeholder", "decoration", "border-x", "border-y", "border-t", "border-r", "border-b",
  "border-l", "border-s", "border-e", "border", "divide", "outline", "accent", "shadow", "caret", "stroke", "fill",
  "ring", "text", "from", "via", "bg", "to",
];

/**
 * One palette color class with its variants, e.g. `hover:bg-neutral-200/80`.
 * Groups: 1 variants (`hover:`), 2 important, 3 utility, 4 palette,
 * 5 shade, 6 opacity modifier.
 */
export const RAW_COLOR_CLASS = new RegExp(
  `(?<![\\w-])((?:[a-z0-9@\\[\\]&*_=-]+:)*)(!?)(${UTILITIES.join("|")})-(${PALETTES.join("|")})(?:-(\\d{2,3}))?(\\/(?:\\d+(?:\\.\\d+)?|\\[[^\\]\\s]+\\]))?(?![\\w-])`,
  "g",
);

type Family = "text" | "bg" | "border" | "accent";

const FAMILY: Record<string, Family> = {
  text: "text", placeholder: "text", caret: "text", decoration: "text", fill: "text", stroke: "text",
  bg: "bg", from: "bg", via: "bg", to: "bg",
  border: "border", "border-x": "border", "border-y": "border", "border-t": "border", "border-r": "border",
  "border-b": "border", "border-l": "border", "border-s": "border", "border-e": "border",
  divide: "border", outline: "border", ring: "border", "ring-offset": "border",
  accent: "accent",
};

/** Palette color → token, per utility family. The light values are identical. */
const TOKENS: Record<Family, Record<string, string>> = {
  text: {
    "neutral-950": "fg-1",
    "neutral-900": "fg-ink",
    "neutral-700": "fg-strong",
    "neutral-600": "fg-2",
    "neutral-500": "fg-muted",
    "neutral-400": "fg-3",
    "neutral-300": "fg-4",
    white: "editor",
    "emerald-700": "pos",
    "emerald-800": "pos-ink",
    "red-600": "neg",
    "red-800": "neg-ink",
    "amber-600": "warn",
    "amber-700": "warn-strong",
    "amber-800": "warn-ink",
  },
  bg: {
    white: "editor",
    "neutral-50": "fill-4",
    "neutral-100": "fill-3",
    "neutral-200": "fill-2",
    "neutral-300": "fill-1",
    "neutral-600": "fg-2",
    "neutral-700": "fg-strong",
    "neutral-900": "fg-ink",
    "neutral-950": "fg-1",
    black: "scrim",
    "emerald-50": "pos-wash",
    "red-50": "neg-wash",
    "red-500": "neg-solid",
    "amber-50": "warn-wash",
    "amber-500": "warn-solid",
  },
  border: {
    white: "editor",
    "neutral-200": "stroke-3",
    "neutral-300": "stroke-1",
    "neutral-400": "fg-3",
    "neutral-500": "fg-muted",
    "neutral-900": "fg-ink",
    "neutral-950": "fg-1",
    "emerald-200": "pos-soft",
    "red-200": "neg-soft",
    "amber-200": "warn-soft",
  },
  accent: {
    "neutral-900": "fg-ink",
    "neutral-950": "fg-1",
  },
};

export interface RawColorMatch {
  index: number;
  text: string;
  /** The token class that replaces it, or null when no token has that light value. */
  replacement: string | null;
}

export function tokenClassFor(utility: string, palette: string, shade?: string): string | null {
  const family = FAMILY[utility];
  if (!family) return null;
  const token = TOKENS[family][shade ? `${palette}-${shade}` : palette];
  return token ? `${utility}-${token}` : null;
}

export function findRawColorClasses(source: string): RawColorMatch[] {
  const out: RawColorMatch[] = [];
  for (const m of source.matchAll(RAW_COLOR_CLASS)) {
    const [text, variants, important, utility, palette, shade, opacity] = m;
    const token = tokenClassFor(utility, palette, shade);
    out.push({ index: m.index ?? 0, text, replacement: token ? `${variants}${important}${token}${opacity ?? ""}` : null });
  }
  return out;
}

/** Rewrites every mappable palette class; returns the classes it could not map. */
export function replaceRawColorClasses(source: string): { output: string; unmapped: string[] } {
  const unmapped: string[] = [];
  const output = source.replace(
    RAW_COLOR_CLASS,
    (text: string, variants: string, important: string, utility: string, palette: string, shade?: string, opacity?: string) => {
      const token = tokenClassFor(utility, palette, shade);
      if (!token) {
        unmapped.push(text);
        return text;
      }
      return `${variants}${important}${token}${opacity ?? ""}`;
    },
  );
  return { output, unmapped };
}

/**
 * Color literals outside the token system: whole-string hex colors
 * ("#a3a3a3"), hex in CSS shorthands ("2px solid #171717") and
 * rgb()/hsl()/oklch() calls. Shadows written as Tailwind arbitrary values
 * (`shadow-[…rgba(0,0,0,0.12)]`) are depth, not palette, and are skipped.
 */
const COLOR_LITERALS = [
  /["'`]#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})["'`]/g,
  /\b(?:solid|dashed|dotted|double)\s+#[0-9a-fA-F]{3,8}\b/g,
  /\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(\s*[\d.]/g,
];

export function findColorLiterals(source: string): RawColorMatch[] {
  const shadowSpans = [...source.matchAll(/shadow-\[[^\]\s]*\]/g)].map((m) => [m.index ?? 0, (m.index ?? 0) + m[0].length]);
  const out: RawColorMatch[] = [];
  for (const re of COLOR_LITERALS) {
    for (const m of source.matchAll(re)) {
      const index = m.index ?? 0;
      if (shadowSpans.some(([start, end]) => index >= start && index < end)) continue;
      out.push({ index, text: m[0], replacement: null });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

/**
 * Deliberate color literals. Each entry allows literals on lines of one
 * file (path relative to src/) that contain `line`.
 */
export const ALLOWED_COLOR_LITERALS: { file: string; line: string; reason: string }[] = [
  {
    file: "components/settings/settings-screen.tsx",
    line: "const COLORS = [",
    reason: "category color picker: the hex is stored on the category (Category.color), not a theme color",
  },
];

export function isAllowedColorLiteral(file: string, lineText: string): boolean {
  return ALLOWED_COLOR_LITERALS.some((entry) => entry.file === file && lineText.includes(entry.line));
}

export function lineOf(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (source.charCodeAt(i) === 10) line++;
  return line;
}
