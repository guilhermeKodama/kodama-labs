import fs from "node:fs";
import path from "node:path";
import { type Page } from "@playwright/test";
import { expect, flow } from "@repo/proof-video";
import { setTheme } from "../package/tour";

/**
 * Orçamentos › Anual at 1440px: Fixo and Variável cards above the year
 * table grouped by kind, with the monthly chart unchanged. With
 * YEAR_DV_SHOTS set, the full page is saved, light and dark.
 */
flow.use({ viewport: { width: 1440, height: 900 }, hasTouch: false, isMobile: false });

const SHOTS = process.env.YEAR_DV_SHOTS;

async function fullShot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  const body = page.locator("main div.overflow-auto").first();
  const extra = await body.evaluate((el) => el.scrollHeight - el.clientHeight);
  await page.setViewportSize({ width: 1440, height: 900 + Math.max(0, extra) + 2 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  await page.setViewportSize({ width: 1440, height: 900 });
}

flow("Anual on a desktop shows fixo and variável", async ({ page, scene, say, check }) => {
  await scene("Fixo e variável", "Orçamentos › Anual a 1440px");
  await say("Two cards under the KPIs, then the months grouped into Fixo and Variável");
  await page.goto("/transactions/budgets?mode=year");
  const cards = page.locator("[data-kind-cards='row']");
  await expect(page.locator("[data-budget-category='Moradia']")).toBeVisible();

  await check("The cards and the grouped table, with the chart as it was", async () => {
    await expect(cards).toBeInViewport();
    await expect(cards.locator("[data-kind-card='fixo']")).toContainText("% do gasto");
    await expect(cards.locator("[data-mini-bars]")).toHaveCount(2);
    const fixo = page.locator("[data-heat-section='fixo']");
    const variavel = page.locator("[data-heat-section='variavel']");
    await expect(fixo).toContainText("Fixo");
    await expect(variavel).toContainText("Variável");
    const y = async (selector: string) => (await page.locator(selector).boundingBox())!.y;
    expect(await y("[data-kind-cards='row']")).toBeLessThan(await y("[data-heat-section='fixo']"));
    expect(await y("[data-heat-section='fixo']")).toBeLessThan(await y("[data-budget-category='Moradia']"));
    expect(await y("[data-budget-category='Moradia']")).toBeLessThan(await y("[data-heat-section='variavel']"));
    expect(await y("[data-heat-section='variavel']")).toBeLessThan(await y("[data-budget-category='Transporte']"));
    await expect(page.locator("[data-kind-split-inline], [data-stacked-chart]")).toHaveCount(0);
    await expect(page.getByText("Gasto mensal vs orçado", { exact: true })).toHaveCount(1);
    await expect(page.locator("[data-budget-legend]").first()).toContainText("Realizado");
  });
  await fullShot(page, "anual-light");

  await say("A card is the Tipo filter: Fixo leaves only the fixed budgets");
  await cards.locator("[data-kind-card='fixo']").click();
  await check("Clicking Fixo filters the year to fixed budgets", async () => {
    await expect(page).toHaveURL(/[?&]k=fixo/);
    await expect(cards.locator("[data-kind-card='fixo']")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("[data-budget-category='Transporte']")).toHaveCount(0);
    await expect(page.locator("[data-budget-category='Moradia']")).toBeVisible();
    await expect(page.locator("[data-heat-section='variavel']")).toHaveCount(0);
  });
  await cards.locator("[data-kind-card='fixo']").click();
  await expect(page).not.toHaveURL(/[?&]k=/);

  await scene("No escuro");
  await setTheme(page, "Escuro");
  await page.goto("/transactions/budgets?mode=year");
  await expect(page.locator("[data-budget-category='Moradia']")).toBeVisible();
  await check("Dark: the cards and the groups", async () => {
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await expect(cards).toBeVisible();
    await expect(page.locator("[data-heat-section='fixo']")).toBeVisible();
  });
  await fullShot(page, "anual-dark");
  await setTheme(page, "Claro");
});
