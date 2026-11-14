import fs from "node:fs";
import path from "node:path";
import { type Page } from "@playwright/test";
import { expect, flow } from "@repo/proof-video";
import { setTheme } from "../package/tour";

/** Desktop Anual groups the year by kind and keeps the phone cards off screen. */
flow.use({ viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false });

const SHOTS = process.env.YEAR_PHONE_SHOTS;

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

flow("Desktop groups the year by kind", async ({ page, scene, say, check }) => {
  const category = () => page.locator("[data-budget-category='Transporte']");

  await scene("O ano no desktop", "Orçamentos › Anual a 1280px");
  await say("The wide window shows Fixo and Variável, then the months grouped under them");
  await page.goto("/transactions/budgets?mode=year");
  const heat = page.locator("[data-budget-heat]");
  await expect(heat).toBeVisible();
  await category().scrollIntoViewIfNeeded();

  await check("Transporte sits under Variável, and the phone cards stay hidden", async () => {
    await expect(page.locator("[data-kind-cards='row']")).toBeVisible();
    await expect(heat).toBeInViewport();
    await expect(heat.locator("[data-heat-section='variavel']")).toBeVisible();
    await expect(page.locator("[data-phone-layout]")).toBeHidden();
    await expect(page.locator("[data-kind-split]")).toBeHidden();
    const nameBox = (await category().getByRole("link", { name: "Transporte", exact: true }).boundingBox())!;
    const sectionBox = (await heat.locator("[data-heat-section='variavel']").boundingBox())!;
    expect(nameBox.y).toBeGreaterThan(sectionBox.y);
    expect(nameBox.width).toBeGreaterThan(60);
    await expect(category().getByText("Variável", { exact: true })).toHaveCount(0);
  });
  await shot(page, "desktop-light");

  await scene("E no escuro");
  await setTheme(page, "Escuro");
  await page.goto("/transactions/budgets?mode=year");
  await category().scrollIntoViewIfNeeded();
  await check("Dark desktop: the groups hold", async () => {
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await expect(heat.locator("[data-heat-section='fixo']")).toBeVisible();
    await expect(page.locator("[data-phone-layout]")).toBeHidden();
    const nameBox = (await category().getByRole("link", { name: "Transporte", exact: true }).boundingBox())!;
    const sectionBox = (await heat.locator("[data-heat-section='variavel']").boundingBox())!;
    expect(nameBox.y).toBeGreaterThan(sectionBox.y);
  });
  await shot(page, "desktop-dark");
  await setTheme(page, "Claro");
});
