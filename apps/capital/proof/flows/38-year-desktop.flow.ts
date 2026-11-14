import fs from "node:fs";
import path from "node:path";
import { type Page } from "@playwright/test";
import { expect, flow } from "@repo/proof-video";
import { setTheme } from "../package/tour";

/** The phone cards leave the desktop heatmap alone. With YEAR_PHONE_SHOTS set, each theme is saved. */
flow.use({ viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false });

const SHOTS = process.env.YEAR_PHONE_SHOTS;

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

flow("Desktop keeps the year heatmap", async ({ page, scene, say, check }) => {
  const category = () => page.locator("[data-budget-category='Transporte']");

  await scene("No desktop nada muda", "Orçamentos › Anual a 1280px");
  await say("A wide window keeps the category by month table");
  await page.goto("/transactions/budgets?mode=year");
  const heat = page.locator("[data-budget-heat]");
  await expect(heat).toBeVisible();
  await category().scrollIntoViewIfNeeded();

  await check("The heatmap, with the name beside its kind", async () => {
    await expect(heat).toBeInViewport();
    await expect(heat.locator("[data-budget-month]")).not.toHaveCount(0);
    await expect(page.locator("[data-phone-layout]")).toBeHidden();
    await expect(page.locator("[data-kind-split]")).toBeHidden();
    const nameBox = (await category().getByRole("link", { name: "Transporte", exact: true }).boundingBox())!;
    const kindBox = (await category().getByText("Variável", { exact: true }).locator("visible=true").boundingBox())!;
    expect(Math.abs(kindBox.y - nameBox.y)).toBeLessThan(8);
    expect(nameBox.width).toBeGreaterThan(60);
  });
  await shot(page, "desktop-light");

  await scene("E no escuro");
  await setTheme(page, "Escuro");
  await page.goto("/transactions/budgets?mode=year");
  await category().scrollIntoViewIfNeeded();
  await check("Dark desktop: the heatmap holds", async () => {
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await expect(heat).toBeVisible();
    await expect(page.locator("[data-phone-layout]")).toBeHidden();
    const nameBox = (await category().getByRole("link", { name: "Transporte", exact: true }).boundingBox())!;
    const kindBox = (await category().getByText("Variável", { exact: true }).locator("visible=true").boundingBox())!;
    expect(Math.abs(kindBox.y - nameBox.y)).toBeLessThan(8);
  });
  await shot(page, "desktop-dark");
  await setTheme(page, "Claro");
});
