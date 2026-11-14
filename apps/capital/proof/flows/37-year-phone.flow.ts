import fs from "node:fs";
import path from "node:path";
import { type Locator, type Page } from "@playwright/test";
import { expect, flow } from "@repo/proof-video";
import { setTheme } from "../package/tour";

/**
 * Orçamentos › Anual on a phone: one card per category, and its year in a
 * bottom sheet. With YEAR_PHONE_SHOTS set to a folder, each state is also
 * saved there as a 390px shot.
 */
const PHONE = { width: 390, height: 844 };

flow.use({ viewport: PHONE, hasTouch: true, isMobile: true });

const SHOTS = process.env.YEAR_PHONE_SHOTS;

function scroller(page: Page): Locator {
  return page.locator("main div.overflow-auto").first();
}

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished)));
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

async function sideScroll(page: Page): Promise<number> {
  const doc = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const body = await scroller(page).evaluate((el) => el.scrollWidth - el.clientWidth);
  return Math.max(doc, body);
}

async function smallestTap(scope: Locator): Promise<number> {
  return scope.evaluate((root) => {
    const targets = [...root.querySelectorAll<HTMLElement>("button, a[href]")].filter((el) => el.getClientRects().length > 0);
    return Math.min(...targets.map((el) => Math.round(el.getBoundingClientRect().height)));
  });
}

flow("The year on a phone is one card per category", async ({ page, scene, say, check }) => {
  const card = () => page.locator("[data-budget-card='Transporte']");

  await scene("O ano no telefone", "Orçamentos › Anual a 390px");
  await say("Each category shows its year, and the twelve months as bars");
  await page.goto("/transactions/budgets?mode=year");
  await expect(page.locator("[data-phone-layout=cards]")).toBeVisible();

  await check("Cards, the split and the KPIs, with no side scroll", async () => {
    await expect(page.locator("[data-kind-split]")).toBeVisible();
    await expect(page.locator("[data-budget-card]")).toHaveCount(9);
    await expect(page.locator("[data-budget-heat]")).toBeHidden();
    expect(await sideScroll(page)).toBeLessThanOrEqual(0);
    expect(await smallestTap(page.locator("[data-phone-layout=cards]"))).toBeGreaterThanOrEqual(44);
  });
  await shot(page, "list-light");

  await card().scrollIntoViewIfNeeded();
  await check("Transporte reads at a glance", async () => {
    await expect(card()).toBeInViewport();
    await expect(card()).toContainText("Variável");
    await expect(card()).toContainText("PF");
    await expect(card()).toContainText(/no ano/);
    await expect(card().locator("[data-mini-bars] [data-bar-tone]")).toHaveCount(12);
  });

  await say("Tapping the card opens its year in a sheet");
  await card().getByRole("button").click();
  const sheet = page.getByRole("dialog", { name: "Transporte" });
  await check("The sheet lists the twelve months", async () => {
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText("Orçado no ano");
    await expect(sheet.locator("[data-month-row]")).toHaveCount(12);
    expect(await smallestTap(sheet.locator("[data-month-list]"))).toBeGreaterThanOrEqual(44);
  });
  await shot(page, "sheet-light");

  await say("A month that already happened opens in Mensal");
  await sheet.locator("[data-month-row='1'] button").click();
  await check("January opens in Mensal", async () => {
    await expect(page.getByRole("radiogroup", { name: "Visão" }).getByRole("radio", { name: "Mensal" })).toHaveAttribute("aria-checked", "true");
    await expect(page).toHaveURL(/m=\d{4}-01/);
  });

  await scene("O mesmo no escuro");
  await setTheme(page, "Escuro");
  await say("The cards, now on the dark paper");
  await page.goto("/transactions/budgets?mode=year");
  await expect(card()).toBeVisible();
  await check("Dark: the cards stay, and the table stays away", async () => {
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await expect(page.locator("[data-phone-layout=cards]")).toBeVisible();
    await expect(page.locator("[data-budget-heat]")).toBeHidden();
    await expect(card()).toContainText("Variável");
  });
  await shot(page, "list-dark");

  await card().scrollIntoViewIfNeeded();
  await card().getByRole("button").click();
  await check("Dark: the sheet opens", async () => {
    await expect(sheet).toBeVisible();
    await expect(sheet.locator("[data-month-row]")).toHaveCount(12);
  });
  await shot(page, "sheet-dark");
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await setTheme(page, "Claro");
});
