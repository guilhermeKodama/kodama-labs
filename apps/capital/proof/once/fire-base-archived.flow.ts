import path from "node:path";
import { expect, flow } from "@repo/proof-video";

const repo = path.resolve(__dirname, "../../../..");

// Proof for the FIRE base fix: an archived broker's holdings no longer count
// as invested. Showing it in the product takes an archived broker that still
// holds assets, which the demo data does not have, so the proof runs the
// route test that builds exactly that case.
flow("The FIRE base leaves out an archived broker, like the Carteira", async ({ scene, say, check, terminal }) => {
  await scene("FIRE base", "The invested amount behind Independência financeira, compared with the Carteira");

  await say("A broker with a R$ 3.000 holding counts while open, and stops counting once archived");
  const run = await terminal(
    "pnpm",
    ["--filter", "@wallex/capital", "exec", "vitest", "run", "src/server/modules/fire/__tests__/fire-goal.test.ts", "-t", "archived broker"],
    { cwd: repo },
  );
  await check("The test passes: archiving the broker takes its R$ 3.000 out of the FIRE base", async () => {
    expect(run.code).toBe(0);
    expect(run.output).toMatch(/Tests\s+1 passed/);
  });

  await say("The rest of the FIRE routes still pass with the narrower base");
  const all = await terminal("pnpm", ["--filter", "@wallex/capital", "exec", "vitest", "run", "src/server/modules/fire"], { cwd: repo });
  await check("Every FIRE route test passes", async () => {
    expect(all.code).toBe(0);
    expect(all.output).not.toMatch(/failed/);
  });
});
