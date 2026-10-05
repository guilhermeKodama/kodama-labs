import { describe, expect, it } from "vitest";
import { canCreateOption, filterOptions, moveActive, normalizeSearch } from "@/lib/combobox";

const CATEGORIES = [
  { value: "1", label: "Alimentação" },
  { value: "2", label: "Saúde" },
  { value: "3", label: "Plano de saúde" },
  { value: "4", label: "Software" },
  { value: "5", label: "Assinaturas", keywords: ["streaming", "Netflix"] },
  { value: "6", label: "Sa" },
  { value: "7", label: "Casa" },
];

const labels = (options: { label: string }[]) => options.map((option) => option.label);

describe("normalizeSearch", () => {
  it("drops accents, case and extra spaces", () => {
    expect(normalizeSearch("  Saúde   e BEM-estar ")).toBe("saude e bem-estar");
    expect(normalizeSearch("Ação")).toBe("acao");
  });
});

describe("filterOptions", () => {
  it("returns everything for an empty query", () => {
    expect(filterOptions(CATEGORIES, "  ")).toEqual(CATEGORIES);
  });

  it("ignores accents and case", () => {
    expect(labels(filterOptions(CATEGORIES, "alimentacao"))).toEqual(["Alimentação"]);
  });

  it("ranks exact, prefix, word prefix, then substring", () => {
    expect(labels(filterOptions(CATEGORIES, "sa"))).toEqual(["Sa", "Saúde", "Plano de saúde", "Casa"]);
  });

  it("requires every word and searches keywords", () => {
    expect(labels(filterOptions(CATEGORIES, "plano saude"))).toEqual(["Plano de saúde"]);
    expect(labels(filterOptions(CATEGORIES, "netflix"))).toEqual(["Assinaturas"]);
    expect(filterOptions(CATEGORIES, "xyz")).toEqual([]);
  });
});

describe("canCreateOption", () => {
  it("offers creation only for new, non-empty names", () => {
    expect(canCreateOption(CATEGORIES, "Pets")).toBe(true);
    expect(canCreateOption(CATEGORIES, "saude")).toBe(false);
    expect(canCreateOption(CATEGORIES, "   ")).toBe(false);
  });
});

describe("moveActive", () => {
  const items = [{}, { disabled: true }, {}, {}];

  it("moves and wraps, skipping disabled rows", () => {
    expect(moveActive(items, 0, 1)).toBe(2);
    expect(moveActive(items, 3, 1)).toBe(0);
    expect(moveActive(items, 0, -1)).toBe(3);
    expect(moveActive(items, 2, -1)).toBe(0);
  });

  it("jumps to the ends and enters from nothing", () => {
    expect(moveActive(items, 2, Infinity)).toBe(3);
    expect(moveActive(items, 2, -Infinity)).toBe(0);
    expect(moveActive(items, -1, 1)).toBe(0);
    expect(moveActive(items, -1, -1)).toBe(3);
  });

  it("returns -1 when nothing can be active", () => {
    expect(moveActive([], 0, 1)).toBe(-1);
    expect(moveActive([{ disabled: true }], 0, 1)).toBe(-1);
  });
});
