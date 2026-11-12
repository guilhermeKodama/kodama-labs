import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { APP_ICON, BRAND, BRAND_COLORS, ICONS, MARK_SIMPLE, markSvg, THEME_COLOR } from "@/lib/brand";

const APP = path.resolve(__dirname, "../../..");
const css = fs.readFileSync(path.join(APP, "src/app/globals.css"), "utf8");

/** The value of a custom property inside one block of globals.css. */
function token(block: ":root" | ".dark", name: string): string {
  const start = css.indexOf(`${block} {`);
  const body = css.slice(start, css.indexOf("\n}", start));
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(body);
  if (!match) throw new Error(`--${name} not found in ${block}`);
  return match[1].trim().toLowerCase();
}

describe("brand", () => {
  it("is called Cerne", () => {
    expect(BRAND).toBe("Cerne");
  });

  it("keeps its colors equal to the theme tokens", () => {
    expect(token(":root", "cap-brand")).toBe(BRAND_COLORS.heartwood);
    expect(token(":root", "cap-resin")).toBe(BRAND_COLORS.resin);
    expect(token(":root", "cap-bg-editor")).toBe(BRAND_COLORS.paper);
    expect(token(".dark", "cap-resin")).toBe(BRAND_COLORS.resinBright);
    expect(token(".dark", "cap-brand")).toBe(BRAND_COLORS.sapwood);
    expect(token(".dark", "cap-bg-editor")).toBe(BRAND_COLORS.charcoal);
    expect(THEME_COLOR).toEqual({ light: BRAND_COLORS.paper, dark: BRAND_COLORS.charcoal });
  });

  it("serves every icon under a name of its own, from the manifest, the service worker and the layout", () => {
    for (const url of Object.values(ICONS)) {
      expect(url).toMatch(/^\/icons\/cerne-[a-z0-9-]+\.png$/);
      expect(fs.existsSync(path.join(APP, "public", url))).toBe(true);
    }
    const users = ["src/app/manifest.webmanifest/route.ts", "src/app/sw.js/route.ts", "src/app/[locale]/layout.tsx"].map((file) =>
      fs.readFileSync(path.join(APP, file), "utf8"),
    );
    for (const source of users) {
      expect(source).toContain("ICONS.");
      expect(source).not.toMatch(/\/(icon-\d+|icon-maskable-\d+|badge-\d+|apple-icon)\.png/);
    }
  });

  it("serves the icon.svg that scripts/brand-icons.ts writes", () => {
    const file = fs.readFileSync(path.join(APP, "src/app/icon.svg"), "utf8").trim();
    expect(file).toBe(markSvg({ shape: MARK_SIMPLE, ...APP_ICON, radius: 14, scale: 0.75, size: 32 }));
  });

  it("draws the rings around the core inside the viewBox", () => {
    const svg = markSvg({ rings: "#000", core: "#111" });
    expect(svg).toContain('viewBox="0 0 64 64"');
    expect(svg.match(/<circle /g)).toHaveLength(4);
    expect(svg).toContain('fill="#111"');
    expect(svg).not.toContain("<rect");
  });
});
