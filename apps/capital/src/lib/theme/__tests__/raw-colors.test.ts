import { describe, expect, it } from "vitest";
import { findColorLiterals, findRawColorClasses, replaceRawColorClasses, tokenClassFor } from "../raw-colors";
import { CHART_SERIES, heatColor } from "../chart-colors";

describe("tokenClassFor", () => {
  it("maps each family to the token with the same light value", () => {
    expect(tokenClassFor("text", "neutral", "400")).toBe("text-fg-3");
    expect(tokenClassFor("bg", "neutral", "50")).toBe("bg-fill-4");
    expect(tokenClassFor("bg", "white")).toBe("bg-editor");
    expect(tokenClassFor("border", "neutral", "200")).toBe("border-stroke-3");
    expect(tokenClassFor("border-l", "neutral", "300")).toBe("border-l-stroke-1");
    expect(tokenClassFor("placeholder", "neutral", "400")).toBe("placeholder-fg-3");
    expect(tokenClassFor("accent", "neutral", "900")).toBe("accent-fg-ink");
    expect(tokenClassFor("text", "emerald", "700")).toBe("text-pos");
  });

  it("returns null when no token has that light value", () => {
    expect(tokenClassFor("text", "neutral", "800")).toBeNull();
    expect(tokenClassFor("bg", "zinc", "100")).toBeNull();
  });
});

describe("replaceRawColorClasses", () => {
  it("keeps variants, important and opacity modifiers", () => {
    const { output, unmapped } = replaceRawColorClasses(
      'className="hover:bg-neutral-200/80 !text-neutral-950 focus:border-neutral-500 placeholder:text-neutral-400 data-[state=open]:bg-white"',
    );
    expect(output).toBe('className="hover:bg-fill-2/80 !text-fg-1 focus:border-fg-muted placeholder:text-fg-3 data-[state=open]:bg-editor"');
    expect(unmapped).toEqual([]);
  });

  it("leaves unmapped classes in place and reports them", () => {
    const { output, unmapped } = replaceRawColorClasses('cn("text-sky-500", "text-neutral-400")');
    expect(output).toBe('cn("text-sky-500", "text-fg-3")');
    expect(unmapped).toEqual(["text-sky-500"]);
  });

  it("ignores token classes and look-alikes", () => {
    const source = 'className="text-fg-3 bg-fill-2 border-stroke-1 text-[12px] bg-transparent text-editor"';
    expect(findRawColorClasses(source)).toEqual([]);
    expect(replaceRawColorClasses(source).output).toBe(source);
  });
});

describe("findColorLiterals", () => {
  it("finds hex strings, CSS shorthands and color functions", () => {
    const found = findColorLiterals('stroke="#a3a3a3" outline: "2px solid #171717" background: `rgba(23,23,23,0.1)`').map((m) => m.text);
    expect(found).toEqual(['"#a3a3a3"', "solid #171717", "rgba(2"]);
  });

  it("ignores ids that look like hex, var() colors and arbitrary shadows", () => {
    const source = 'placeholder="Ex.: Invoice #0142" fill="var(--cap-chart-ink)" className="shadow-[-8px_0_24px_-12px_rgba(0,0,0,0.12)]"';
    expect(findColorLiterals(source)).toEqual([]);
  });
});

describe("chart colors", () => {
  it("references the theme variables", () => {
    expect(CHART_SERIES).toHaveLength(10);
    expect(CHART_SERIES[0]).toBe("var(--cap-chart-1)");
  });

  it("mixes the heat ink by alpha, clamped to 0..1", () => {
    expect(heatColor(0.35)).toBe("color-mix(in srgb, var(--cap-heat) 35%, transparent)");
    expect(heatColor(0.04 + 0.5 * 0.18)).toBe("color-mix(in srgb, var(--cap-heat) 13%, transparent)");
    expect(heatColor(2)).toBe("color-mix(in srgb, var(--cap-heat) 100%, transparent)");
    expect(heatColor(-1)).toBe("color-mix(in srgb, var(--cap-heat) 0%, transparent)");
  });
});
