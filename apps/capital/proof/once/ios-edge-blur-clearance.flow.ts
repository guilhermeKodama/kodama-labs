import { expect, flow } from "@repo/proof-video";

// iOS 26 draws a blur from the top of an installed web app down past the
// status bar. Chromium has neither the installed-app mode nor the blur, so
// this proof runs the rule that adds the clearance there.
flow("The installed iOS app keeps its top bar below the edge blur", async ({ scene, say, check, terminal }) => {
  await scene("Desfoque do iOS 26", "Only the installed iOS app gets the extra 12pt under the status bar");
  await say("The CSS rule, scoped to the installed app on iOS 26 and later");
  const rule = await terminal("grep", ["-n", "-A5", "display-mode: standalone) {", "src/app/globals.css"]);
  await check("globals.css adds 12pt to the top clearance there", async () => {
    expect(rule.output).toContain("@supports (-webkit-touch-callout: none) and (anchor-name: --a)");
    expect(rule.output).toContain("--safe-top: calc(env(safe-area-inset-top, 0px) + 12px);");
  });
  await say("The test that pins it");
  const test = await terminal("pnpm", ["exec", "vitest", "run", "src/lib/theme/__tests__/safe-area.test.ts"]);
  await check("The safe-area test passes", async () => {
    expect(test.code).toBe(0);
    expect(test.output).toMatch(/2 passed/);
  });
});
