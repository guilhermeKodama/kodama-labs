import { expect, flow } from "@repo/proof-video";

/** The `?dv=` alternatives are desktop only: a phone keeps the shipped year cards. */
flow.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

flow("A phone ignores the desktop alternatives", async ({ page, scene, say, check }) => {
  await scene("No telefone nada muda", "Orçamentos › Anual a 390px com ?dv=");
  for (const dv of ["a", "b", "c"]) {
    await say(`?dv=${dv} on a phone still shows the category cards and the split card`);
    await page.goto(`/transactions/budgets?mode=year&dv=${dv}`);
    await expect(page.locator("[data-phone-layout='cards']")).toBeVisible();
    await check(`?dv=${dv}: the phone view is the shipped one`, async () => {
      await expect(page.locator("[data-kind-split]")).toBeVisible();
      await expect(page.locator("[data-budget-card='Moradia']")).toBeVisible();
      await expect(page.locator("[data-kind-cards], [data-kind-split-inline], [data-heat-section], [data-stacked-chart]")).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    });
  }
});
