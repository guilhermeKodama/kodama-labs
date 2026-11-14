import { expect, flow } from "@repo/proof-video";

/** The phone layouts of Orçamentos › Anual leave the desktop heatmap alone, whatever ?mv= says. */
flow.use({ viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false });

flow("Desktop keeps the year heatmap", async ({ page, scene, say, check }) => {
  await scene("No desktop nada muda", "Orçamentos › Anual a 1280px");
  for (const layout of ["cards", "months", "map"]) {
    if (layout === "cards") await say("Each phone layout asked for on a wide window");
    await page.goto(`/transactions/budgets?mode=year&mv=${layout}`);
    const heat = page.locator("[data-budget-heat]");
    await expect(heat).toBeVisible();
    await check(`?mv=${layout}: the heatmap, no phone layout`, async () => {
      await expect(heat).toBeInViewport();
      await expect(heat.locator("[data-budget-category='Transporte']")).toBeVisible();
      await expect(heat.locator("[data-budget-month]")).not.toHaveCount(0);
      await expect(page.locator("[data-phone-layout]")).toBeHidden();
      await expect(page.locator("[data-kind-split]")).toBeHidden();
    });
  }
});
