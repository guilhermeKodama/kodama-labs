import fs from "node:fs";
import path from "node:path";
import { type Page } from "@playwright/test";
import { expect, flow } from "@repo/proof-video";
import { setTheme } from "../package/tour";

/** Mensal paints Fixo in heartwood, the same neutral as Anual. YEAR_DV_SHOTS saves it at 1440px. */
flow.use({ viewport: { width: 1440, height: 900 }, hasTouch: false, isMobile: false });

const SHOTS = process.env.YEAR_DV_SHOTS;
const CERNE = "rgb(91, 46, 31)";
const RESINA = "rgb(196, 134, 43)";
const MUSGO = "rgb(61, 90, 54)";

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  const body = page.locator("main div.overflow-auto").first();
  const extra = await body.evaluate((el) => el.scrollHeight - el.clientHeight);
  await page.setViewportSize({ width: 1440, height: 900 + Math.max(0, extra) + 2 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  await page.setViewportSize({ width: 1440, height: 900 });
}

function stroke(page: Page, label: "Gastos fixos" | "Gastos variáveis") {
  return page.locator("[data-budget-legend] span", { hasText: label }).locator("line").first();
}

flow("Mensal paints Fixo in heartwood", async ({ page, scene, say, check }) => {
  await scene("Fixo no cerne", "Orçamentos › Mensal a 1440px");
  await say("Fixo takes the heartwood of the year cards; variável stays resin; green stays with gains");
  await page.goto("/transactions/budgets");
  await expect(page.locator("[data-budget-kpi='fixo']")).toBeVisible();
  await check("Fixo is heartwood and variável is resin", async () => {
    await expect(stroke(page, "Gastos fixos")).toHaveCSS("stroke", CERNE);
    await expect(stroke(page, "Gastos variáveis")).toHaveCSS("stroke", RESINA);
    await expect(stroke(page, "Gastos fixos")).not.toHaveCSS("stroke", MUSGO);
  });
  await shot(page, "mensal-light");

  await scene("No escuro");
  await setTheme(page, "Escuro");
  await page.goto("/transactions/budgets");
  await expect(page.locator("[data-budget-kpi='fixo']")).toBeVisible();
  await check("Dark: Fixo is the light heartwood, not the green", async () => {
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    const color = await stroke(page, "Gastos fixos").evaluate((el) => getComputedStyle(el).stroke);
    expect(color).not.toBe("rgb(156, 192, 140)");
    expect(color).not.toBe(MUSGO);
  });
  await shot(page, "mensal-dark");
  await setTheme(page, "Claro");
});
