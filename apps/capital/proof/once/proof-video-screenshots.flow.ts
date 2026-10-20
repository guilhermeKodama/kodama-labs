import fs from "node:fs";
import path from "node:path";
import { expect, flow } from "@repo/proof-video";

const out = path.resolve(__dirname, "../out");

// Proof for the change that keeps a full-resolution screenshot of every
// check: it shows in the files a recording writes, not in the product.
// Record any flow first (pnpm --filter @wallex/capital proof:record
// proof/flows/01-sign-in.flow.ts); this proof reads what that run wrote.
flow("A recording keeps a full-resolution screenshot of every check", async ({ scene, say, check, terminal }) => {
  await scene("Screenshots", "Nothing to see in the product, so the proof is the files the last recording wrote");

  await say("The manifest of the last recording names a screenshot for every check");
  const manifest = await terminal("node", [
    "-e",
    `const m = require(${JSON.stringify(path.join(out, "proof.json"))});
     const checks = m.flows.flatMap((f) => f.events).filter((e) => e.kind === "check");
     for (const c of checks) console.log(c.screenshot ?? "MISSING", "·", c.text);
     console.log(checks.length, "checks,", checks.filter((c) => c.screenshot).length, "with a screenshot");`,
  ]);
  await check("Every check of the last recording has its screenshot", async () => {
    expect(manifest.code).toBe(0);
    expect(manifest.output).not.toContain("MISSING");
    expect(manifest.output).toMatch(/(\d+) checks, \1 with a screenshot/);
  });

  await say("The files are PNGs of the 1280×720 page at twice the pixel density");
  const shots = fs.readdirSync(path.join(out, "screenshots")).filter((name) => name.endsWith(".png"));
  const size = await terminal("sips", ["-g", "pixelWidth", "-g", "pixelHeight", ...shots.map((name) => path.join(out, "screenshots", name))]);
  await check("Each screenshot is 2560×1440 pixels", async () => {
    expect(shots.length).toBeGreaterThan(0);
    expect(size.output.match(/pixelWidth: 2560/g)).toHaveLength(shots.length);
    expect(size.output.match(/pixelHeight: 1440/g)).toHaveLength(shots.length);
  });
});
