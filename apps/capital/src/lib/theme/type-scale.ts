/**
 * The type roles of src/app/theme.css, where their sizes are defined.
 * Components use them as Tailwind utilities (text-caption, text-body, …);
 * inline styles and SVG attributes (Recharts fontSize) use textRole().
 */
export const TEXT_ROLES = [
  "micro",
  "hint",
  "caption",
  "label",
  "body-sm",
  "button",
  "body",
  "control",
  "body-lg",
  "title-sm",
  "title",
  "amount",
  "heading",
  "kpi",
  "display",
] as const;

export type TextRole = (typeof TEXT_ROLES)[number];

/** A role's size as a CSS value, scaled by Tamanho da letra: `fontSize: textRole("caption")`. */
export function textRole(role: TextRole): string {
  return `var(--cap-font-${role})`;
}

/**
 * The value --cap-text-scale computes to on `root` (1 at Médio), for sizes
 * that JS has to know, like the ledger table's virtualized row height.
 */
export function readTextScale(root: Element, computed: (el: Element) => Pick<CSSStyleDeclaration, "getPropertyValue"> = getComputedStyle): number {
  const scale = Number.parseFloat(computed(root).getPropertyValue("--cap-text-scale"));
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}
