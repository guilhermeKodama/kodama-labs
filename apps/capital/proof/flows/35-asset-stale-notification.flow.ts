import { expect, flow } from "@repo/proof-video";

/**
 * F1: the "ativo sem cotação" push. Its toggle is a real control in
 * Notificações; the send itself is not, since this proof environment
 * never configures VAPID keys on purpose (no real push from a demo run) —
 * runNotifications exits before even looking at a holding when push isn't
 * configured, so there is nothing truthful a terminal() call against the
 * running server could show for the sender. What is provable without a
 * push device, and would fail if sendAssetStale regressed, is the
 * notifications/__tests__/senders.test.ts suite itself, run for real
 * against this run's database.
 */

flow("Ativo sem cotação: the Notificações toggle, and the sender's own tests", async ({ page, scene, say, check, terminal }) => {
  await scene("The toggle in Notificações", "On by default, like a card bill closing");
  await page.goto("/settings");
  await page.getByRole("navigation").getByRole("button", { name: "Notificações", exact: true }).click();
  const toggle = page.getByRole("switch", { name: "Ativo sem cotação atualizada" });
  await check("The toggle starts on", async () => {
    await expect(toggle).toBeVisible();
    await expect(toggle).toBeChecked();
  });
  await say("Turn it off, reload, and it stays off — the same settings PATCH every toggle on this screen already uses");
  await toggle.click();
  await check("It saved as off", async () => {
    await expect(toggle).not.toBeChecked();
  });
  await page.reload();
  await check("...and is still off after a reload", async () => {
    await expect(page.getByRole("switch", { name: "Ativo sem cotação atualizada" })).not.toBeChecked();
  });
  await say("Back on, the default every other flow and the push itself expect");
  await page.getByRole("switch", { name: "Ativo sem cotação atualizada" }).click();
  await check("It's back on", async () => {
    await expect(page.getByRole("switch", { name: "Ativo sem cotação atualizada" })).toBeChecked();
  });

  await scene("The sender itself", "Nothing to see on screen without a real push device — the proof is its own test suite, run now");
  await say("sendAssetStale: one push per stale or never-priced linked holding, never for a manual one, never when the toggle above is off");
  const tests = await terminal("pnpm", ["exec", "vitest", "run", "src/server/modules/notifications/__tests__/senders.test.ts", "-t", "sendAssetStale"]);
  await check("Both of its tests pass, against this run's own database", async () => {
    expect(tests.code).toBe(0);
    expect(tests.output).toMatch(/Tests\s+2 passed/);
  });
});
