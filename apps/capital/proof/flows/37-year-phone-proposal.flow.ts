import fs from "node:fs";
import path from "node:path";
import { type Locator, type Page } from "@playwright/test";
import { expect, flow } from "@repo/proof-video";
import { setTheme } from "../package/tour";

/**
 * Design proposal for Orçamentos › Anual on a phone: the three layouts
 * ?mv= switches between (cards, months, map), in light and dark. With
 * PROPOSAL_SHOTS set to a folder, each state is also saved there as a
 * viewport shot and a full-length one, for the pull request.
 */
const PHONE = { width: 390, height: 844 };

flow.use({ viewport: PHONE, hasTouch: true, isMobile: true });

const SHOTS = process.env.PROPOSAL_SHOTS;

/** The page's own scroller (the Page body), which holds the view. */
function scroller(page: Page): Locator {
  return page.locator("main div.overflow-auto").first();
}

async function shot(page: Page, name: string, options: { full?: boolean } = {}): Promise<void> {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished)));
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  if (!options.full) return;
  const box = scroller(page);
  const { top, height } = await box.evaluate((el) => ({ top: el.getBoundingClientRect().top, height: el.scrollHeight }));
  const scrollTop = await box.evaluate((el) => el.scrollTop);
  await page.setViewportSize({ width: PHONE.width, height: Math.min(6000, Math.ceil(top + height)) });
  await box.evaluate((el) => el.scrollTo(0, 0));
  await page.screenshot({ path: path.join(SHOTS, `${name}-full.png`) });
  await page.setViewportSize(PHONE);
  await box.evaluate((el, y) => el.scrollTo(0, y), scrollTop);
}

/** Widest sideways overflow of the document and of the page's scroller, in px. */
async function sideScroll(page: Page): Promise<number> {
  const doc = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const body = await scroller(page).evaluate((el) => el.scrollWidth - el.clientWidth);
  return Math.max(doc, body);
}

/** Smallest height among the tappable things inside a locator. */
async function smallestTap(scope: Locator): Promise<number> {
  return scope.evaluate((root) => {
    const targets = [...root.querySelectorAll<HTMLElement>("button, a[href], [role=radio]")].filter((el) => el.getClientRects().length > 0);
    return Math.min(...targets.map((el) => el.getBoundingClientRect().height));
  });
}

async function toTop(page: Page): Promise<void> {
  await scroller(page).evaluate((el) => el.scrollTo(0, 0));
}

async function openYear(page: Page, layout: string, selector: string): Promise<Locator> {
  await page.goto(`/transactions/budgets?mode=year&mv=${layout}`);
  const view = page.locator(selector);
  await expect(view).toBeVisible();
  await expect(page.locator("[data-budget-heat]")).toBeHidden();
  return view;
}

flow("Proposta A: um cartão por categoria", async ({ page, scene, say, check }) => {
  for (const theme of ["Claro", "Escuro"] as const) {
    const suffix = theme === "Claro" ? "light" : "dark";
    if (theme === "Escuro") {
      await scene("Proposta A no escuro");
      await setTheme(page, "Escuro");
    } else {
      await scene("Proposta A · cartões", "Orçamentos › Anual a 390px");
      await say("Each category is a card: its year, a bar and 12 mini-bars");
    }
    const view = await openYear(page, "cards", "[data-phone-layout=cards]");
    await check(`${theme}: KPIs, split and cards, no side scroll`, async () => {
      await expect(page.locator("[data-kind-split]")).toBeVisible();
      await expect(view.locator("[data-budget-card]")).toHaveCount(9);
      expect(await sideScroll(page)).toBeLessThanOrEqual(0);
    });
    await shot(page, `a-cards-${suffix}`, { full: true });

    const card = view.locator("[data-budget-card='Transporte']");
    await card.scrollIntoViewIfNeeded();
    await check(`${theme}: Transporte reads at a glance`, async () => {
      await expect(card).toBeInViewport();
      await expect(card).toContainText("Variável");
      await expect(card).toContainText("PF");
      await expect(card).toContainText(/no ano/);
      await expect(card.locator("[data-mini-bars] [data-bar-tone]")).toHaveCount(12);
      expect(await smallestTap(view)).toBeGreaterThanOrEqual(44);
    });

    if (theme === "Claro") await say("Tapping the card opens the year month by month");
    await card.getByRole("button").first().click();
    const list = card.locator("[data-month-list]");
    await card.evaluate((el) => el.scrollIntoView({ block: "start" }));
    await check(`${theme}: 12 months, each at least 44px`, async () => {
      await expect(card.getByRole("button").first()).toHaveAttribute("aria-expanded", "true");
      await expect(list.locator("[data-month-row]")).toHaveCount(12);
      expect(await smallestTap(list)).toBeGreaterThanOrEqual(44);
    });
    await shot(page, `a-cards-expanded-${suffix}`);
  }

  await say("A month that already happened opens in Mensal");
  await page.locator("[data-budget-card='Transporte'] [data-month-row='1'] button").click();
  await check("January opens in Mensal", async () => {
    await expect(page.getByRole("radiogroup", { name: "Visão" }).getByRole("radio", { name: "Mensal" })).toHaveAttribute("aria-checked", "true");
    await expect(page).toHaveURL(/m=\d{4}-01/);
  });
  await setTheme(page, "Claro");
});

flow("Proposta B: mês a mês", async ({ page, scene, say, check }) => {
  for (const theme of ["Claro", "Escuro"] as const) {
    const suffix = theme === "Claro" ? "light" : "dark";
    if (theme === "Escuro") {
      await scene("Proposta B no escuro");
      await setTheme(page, "Escuro");
    } else {
      await scene("Proposta B · mês a mês", "Orçamentos › Anual a 390px");
      await say("Twelve month tiles on top, the categories of that month below");
    }
    const view = await openYear(page, "months", "[data-phone-layout=months]");
    const tiles = view.locator("[data-month-tile]");
    await check(`${theme}: 12 tiles, today's month picked`, async () => {
      await expect(tiles).toHaveCount(12);
      await expect(view.locator("[data-month-tile][aria-checked=true]")).toContainText("*");
      expect(await smallestTap(view.getByRole("radiogroup"))).toBeGreaterThanOrEqual(44);
      expect(await sideScroll(page)).toBeLessThanOrEqual(0);
    });
    await shot(page, `b-months-${suffix}`, { full: true });

    if (theme === "Claro") await say("Picking March lists March, with each category's year below it");
    await view.locator("[data-month-tile='3']").click();
    await check(`${theme}: March lists its categories`, async () => {
      await expect(view.locator("[data-month-tile='3']")).toHaveAttribute("aria-checked", "true");
      await expect(view.locator("[data-month-summary]")).toContainText(/mar/);
      const transporte = view.locator("[data-month-category='Transporte']");
      await expect(transporte).toContainText("%");
      const bar = await transporte.locator("xpath=..").getByRole("meter").boundingBox();
      expect(bar?.height ?? 0).toBeGreaterThan(4);
    });
    await toTop(page);
    await shot(page, `b-months-march-${suffix}`, { full: true });
  }
  await setTheme(page, "Claro");
});

flow("Proposta C: mapa compacto", async ({ page, scene, say, check }) => {
  for (const theme of ["Claro", "Escuro"] as const) {
    const suffix = theme === "Claro" ? "light" : "dark";
    if (theme === "Escuro") {
      await scene("Proposta C no escuro");
      await setTheme(page, "Escuro");
    } else {
      await scene("Proposta C · mapa", "Orçamentos › Anual a 390px");
      await say("The heatmap without numbers: twelve small cells per category");
    }
    const view = await openYear(page, "map", "[data-phone-layout=map]");
    const row = view.locator("[data-map-row='Transporte']");
    await row.scrollIntoViewIfNeeded();
    await check(`${theme}: 12 cells a row, no side scroll`, async () => {
      await expect(row.locator("[data-map-cell]")).toHaveCount(12);
      expect(((await row.locator("[data-map-cell]").allTextContents()).join("")).trim()).toBe("");
      expect(await smallestTap(view)).toBeGreaterThanOrEqual(44);
      expect(await sideScroll(page)).toBeLessThanOrEqual(0);
    });
    await toTop(page);
    await shot(page, `c-map-${suffix}`, { full: true });

    if (theme === "Claro") await say("Tapping a cell opens the category in a bottom sheet, that month marked");
    await row.locator("[data-map-cell='3']").click();
    const sheet = page.getByRole("dialog", { name: "Transporte" });
    await check(`${theme}: the sheet opens on March`, async () => {
      await expect(sheet).toBeVisible();
      await expect(sheet).toContainText("Orçado no ano");
      await expect(sheet.locator("[data-month-row]")).toHaveCount(12);
      await expect(sheet.locator("[data-month-row='3'] > *")).toHaveClass(/bg-fill-3/);
      expect(await smallestTap(sheet.locator("[data-month-list]"))).toBeGreaterThanOrEqual(44);
    });
    await shot(page, `c-map-sheet-${suffix}`);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  }
  await setTheme(page, "Claro");
});
