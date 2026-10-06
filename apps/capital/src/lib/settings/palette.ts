/**
 * The nine colors of categories and entities (mockup palette, in order).
 * Category.color and Entity.color store the light hex, which other screens
 * paint as is; swatchColor maps a stored palette hex to its theme token so
 * it follows the dark theme too.
 */
export const PALETTE = [
  { name: "gray", hex: "#737373" },
  { name: "purple", hex: "#7c3aed" },
  { name: "green", hex: "#16a34a" },
  { name: "yellow", hex: "#ca8a04" },
  { name: "cyan", hex: "#0891b2" },
  { name: "pink", hex: "#db2777" },
  { name: "blue", hex: "#2563eb" },
  { name: "orange", hex: "#ea580c" },
  { name: "red", hex: "#dc2626" },
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
