import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";
import { TEXT_SIZES, type TextSize } from "../text-size";
import { readTextScale, TEXT_ROLES, textRole } from "../type-scale";

const APP = join(__dirname, "../../../app");
const theme = readFileSync(join(APP, "theme.css"), "utf8");
const globals = readFileSync(join(APP, "globals.css"), "utf8");

/** The sizes the screens rendered before the roles existed (the text-[Npx] each role replaced). */
const MEDIO_PX: Record<(typeof TEXT_ROLES)[number], number> = {
  micro: 10,
  hint: 10.5,
  caption: 11,
  label: 11.5,
  "body-sm": 12,
  button: 12,
  body: 12.5,
  control: 12.5,
  "body-lg": 13,
  "title-sm": 14,
  title: 15,
  amount: 15,
  heading: 17,
  kpi: 17,
  display: 22,
};

const DENSITY_PX = { "control-h": 26, "menu-row-h": 28, "row-h": 34, "table-row-h": 36 };

/** `--name: calc(<n>px * var(--cap-text-scale))` in theme.css → n. */
function basePx(name: string): number | null {
  const match = new RegExp(`--${name}:\\s*calc\\(([\\d.]+)px \\* var\\(--cap-text-scale\\)\\);`).exec(theme);
  return match ? Number(match[1]) : null;
}

/** The --cap-text-scale each Tamanho da letra sets. */
function scaleOf(size: TextSize): number | null {
  const selector = size === "md" ? ":root" : `:root[data-text-size="${size}"]`;
  const escaped = selector.replace(/[[\]().*"]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{[^}]*?--cap-text-scale:\\s*([\\d.]+);`).exec(theme);
  return match ? Number(match[1]) : null;
}

/** What a role computes to at a text size, in px. */
const rendered = (role: (typeof TEXT_ROLES)[number], size: TextSize) => (basePx(`cap-font-${role}`) ?? NaN) * (scaleOf(size) ?? NaN);

describe("type scale (src/app/theme.css)", () => {
  it("is imported by globals.css, which keeps no numeric text-cap-* tokens", () => {
    expect(globals).toContain('@import "./theme.css";');
    expect(globals).not.toMatch(/--text-cap-|--cap-text-scale:/);
  });

  it("defines every role of TEXT_ROLES, scaled by --cap-text-scale, and nothing else", () => {
    const defined = [...theme.matchAll(/--cap-font-([a-z-]+):/g)].map((m) => m[1]);
    expect(defined).toEqual([...TEXT_ROLES]);
    for (const role of TEXT_ROLES) expect(basePx(`cap-font-${role}`), role).not.toBeNull();
  });

  it("renders Médio exactly as the text-[Npx] classes did", () => {
    expect(scaleOf("md")).toBe(1);
    for (const role of TEXT_ROLES) expect(rendered(role, "md"), role).toBe(MEDIO_PX[role]);
    expect(new Set(Object.values(MEDIO_PX))).toEqual(new Set([10, 10.5, 11, 11.5, 12, 12.5, 13, 14, 15, 17, 22]));
  });

  it("Pequeno and Grande only change the scale", () => {
    expect(TEXT_SIZES).toEqual(["sm", "md", "lg"]);
    expect(scaleOf("sm")).toBe(0.92);
    expect(scaleOf("lg")).toBe(1.14);
    for (const role of TEXT_ROLES) {
      expect(rendered(role, "sm"), role).toBeCloseTo(MEDIO_PX[role] * 0.92, 10);
      expect(rendered(role, "lg"), role).toBeCloseTo(MEDIO_PX[role] * 1.14, 10);
    }
    expect(rendered("body", "sm")).toBeCloseTo(11.5, 10);
    expect(rendered("body", "lg")).toBeCloseTo(14.25, 10);
  });

  it("scales the heights tied to text with it", () => {
    for (const [name, px] of Object.entries(DENSITY_PX)) {
      expect(basePx(`cap-${name}`), name).toBe(px);
    }
  });

  it("exposes each role as a Tailwind utility with the inherited line-height", () => {
    const block = /@theme inline \{([^}]*)\}/.exec(theme)?.[1] ?? "";
    for (const role of TEXT_ROLES) expect(block).toContain(`--text-${role}: var(--cap-font-${role});`);
    expect(block).not.toContain("--line-height");
  });

  it("textRole() gives inline styles and charts the same variable", () => {
    expect(textRole("caption")).toBe("var(--cap-font-caption)");
    expect(theme).toContain("--cap-font-caption:");
  });

  it("reads the computed scale for sizes JS lays out, 1 when it is missing", () => {
    const root = {} as Element;
    const computed = (value: string) => () => ({ getPropertyValue: (name: string) => (name === "--cap-text-scale" ? value : "") });
    expect(readTextScale(root, computed(" 1.14"))).toBe(1.14);
    expect(readTextScale(root, computed("0.92"))).toBe(0.92);
    expect(readTextScale(root, computed(""))).toBe(1);
    expect(readTextScale(root, computed("nope"))).toBe(1);
  });

  it("cn() keeps a role next to a text color, lets a later role win and merges the scaled heights", () => {
    expect(cn("text-caption", "text-fg-3")).toBe("text-caption text-fg-3");
    expect(cn("text-body text-neg", "text-title")).toBe("text-neg text-title");
    expect(cn("text-body-sm", "text-body-lg")).toBe("text-body-lg");
    expect(cn("text-[12px]", "text-label")).toBe("text-label");
    expect(cn("h-(--cap-control-h) w-(--cap-control-h)", "h-6")).toBe("w-(--cap-control-h) h-6");
  });
});
