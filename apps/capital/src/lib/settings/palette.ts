/**
 * The nine colors of categories and entities: Cerne hues (canvas board
 * CerneCharts), in the order of the Tailwind colors they replaced (gray,
 * purple, green, yellow, cyan, pink, blue, orange, red), so
 * scripts/remap-brand-colors.ts can move stored values one to one.
 * Category.color and Entity.color store the light hex, which other screens
 * paint as is; swatchColor maps a stored palette hex to its theme token so
 * it follows the dark theme too.
 */
export const PALETTE = [
  { name: "casca", hex: "#8c7b68" },
  { name: "jacaranda", hex: "#6e4a5e" },
  { name: "musgo", hex: "#3d5a36" },
  { name: "ipe", hex: "#c9a227" },
  { name: "salvia", hex: "#8a9a7b" },
  { name: "argila", hex: "#b07a5a" },
  { name: "ardosia", hex: "#4f6470" },
  { name: "resina", hex: "#c4862b" },
  { name: "urucum", hex: "#7a3b26" },
] as const;

export type PaletteName = (typeof PALETTE)[number]["name"];

/** The palette color a stored value names (a hex of the palette, any case, or a palette name); null otherwise. */
export function paletteName(stored: string | null | undefined): PaletteName | null {
  const value = stored?.trim().toLowerCase();
  if (!value) return null;
  return PALETTE.find((p) => p.hex === value || p.name === value)?.name ?? null;
}

/** The value to store for a palette color. */
export function paletteHex(name: PaletteName): string {
  return PALETTE.find((p) => p.name === name)!.hex;
}

/** CSS color for a stored value: the theme token of a palette color, the value itself otherwise, a neutral dot when empty. */
export function swatchColor(stored: string | null | undefined): string {
  const name = paletteName(stored);
  if (name) return `var(--cap-cat-${name})`;
  return stored?.trim() || "var(--cap-text-4)";
}
