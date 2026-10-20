import os from "node:os";
import path from "node:path";
import { expect, flow } from "@repo/proof-video";
import { settingsNav } from "../helpers";

const BACKUP = path.join(os.tmpdir(), `remap-brand-colors-proof-${Date.now()}.json`);
const tsx = (...args: string[]) => ["exec", "tsx", ...args];

// Proof for the one-off script that moves stored colors to the Cerne swatches.
// The demo data already uses the new swatches, so the flow first puts the old
// Tailwind blue on Moradia, the state production is in.
flow("remap-brand-colors moves stored colors to the Cerne swatches, with a backup and a way back", async ({ page, scene, say, check, terminal }) => {
  await scene("Before", "Moradia still holds the old Tailwind blue (#2563eb)");
  const seed = await terminal("pnpm", tsx("proof/once/remap-brand-colors.seed.ts", "Moradia", "#2563eb"));
  expect(seed.code).toBe(0);

  await say("A dry run lists what would change and touches nothing");
  const dry = await terminal("pnpm", tsx("scripts/remap-brand-colors.ts", "--dry-run"));
  await check("The dry run would move Moradia from #2563eb to ardósia (#4f6470)", async () => {
    expect(dry.code).toBe(0);
    expect(dry.output).toMatch(/category \S+ \(user \S+\): #2563eb -> #4f6470/);
    expect(dry.output).toMatch(/dry run: would remap 1 colors/);
  });

  await scene("Apply", "A backup first, then the change, then a recount");
  const apply = await terminal("pnpm", tsx("scripts/remap-brand-colors.ts", "--backup", BACKUP));
  await check("Applied with a backup, and no old swatch left", async () => {
    expect(apply.code).toBe(0);
    expect(apply.output).toContain(`backup of 1 rows written to ${BACKUP}`);
    expect(apply.output).toMatch(/remapped 1 colors .*; 0 old swatches left/);
  });

  await page.goto("/settings");
  await settingsNav(page, "Categorias").click();
  await page.getByRole("main").getByRole("button", { name: /^Moradia/ }).first().click();
  await check("In Ajustes › Categorias, Moradia now shows the Ardósia swatch", async () => {
    await expect(page.getByRole("radio", { name: "Ardósia" })).toHaveAttribute("aria-checked", "true");
  });

  await scene("The way back", "--reverse puts the backed-up color back");
  const reverse = await terminal("pnpm", tsx("scripts/remap-brand-colors.ts", "--reverse", BACKUP));
  await check("Reverse restores the one row from the backup", async () => {
    expect(reverse.code).toBe(0);
    expect(reverse.output).toContain(`restored 1 of 1 rows from ${BACKUP}`);
  });
  await say("Applied again, so the proof data stays on the new swatches");
  const again = await terminal("pnpm", tsx("scripts/remap-brand-colors.ts", "--backup", `${BACKUP}.2`));
  await check("Re-applied: no old swatch left", async () => {
    expect(again.output).toMatch(/0 old swatches left/);
  });
});
