import fs from "node:fs";
import path from "node:path";
import { type Page } from "@playwright/test";
import { expect, flow } from "@repo/proof-video";
import { setTheme } from "../package/tour";

/** The desktop cards and grouped table stay off a phone. YEAR_DV_SHOTS saves the 390px year. */
flow.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

const SHOTS = process.env.YEAR_DV_SHOTS;

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

flow("A phone keeps the year cards", async ({ page, scene, say, check }) => {
  await scene("No telefone nada muda", "Orçamentos › Anual a 390px");
  await say("The phone still shows one card per category and the split card");
  await page.goto("/transactions/budgets?mode=year");
  await expect(page.locator("[data-phone-layout='cards']")).toBeVisible();
  await check("The phone view is the category cards", async () => {
    await expect(page.locator("[data-kind-split]")).toBeVisible();
    await expect(page.locator("[data-budget-card='Moradia']")).toBeVisible();
    const leaked = await page.locator("[data-kind-cards]:visible, [data-budget-heat]:visible, [data-heat-section]:visible").count();
    expect(leaked).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
  await shot(page, "phone-light");

  await scene("E no escuro");
  await setTheme(page, "Escuro");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/transactions/budgets?mode=year");
  await check("Dark: the phone cards stay", async () => {
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await expect(page.locator("[data-phone-layout='cards']")).toBeVisible();
    await expect(page.locator("[data-kind-cards]")).toBeHidden();
    await expect(page.locator("[data-budget-heat]")).toBeHidden();
  });
  await shot(page, "phone-dark");
  await setTheme(page, "Claro");
});
