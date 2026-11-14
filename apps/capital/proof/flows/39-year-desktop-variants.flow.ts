import fs from "node:fs";
import path from "node:path";
import { type Page } from "@playwright/test";
import { expect, flow } from "@repo/proof-video";
import { setTheme } from "../package/tour";

/**
 * Orçamentos › Anual at 1440px: the shipped view and the three
 * alternatives behind the temporary `?dv=` param (a, b, c), each bringing
 * fixo and variável to the desktop. With YEAR_DV_SHOTS set to a folder,
 * every view is also saved there at its full height, light and dark.
 */
flow.use({ viewport: { width: 1440, height: 900 }, hasTouch: false, isMobile: false });

const SHOTS = process.env.YEAR_DV_SHOTS;
const year = (dv?: string) => `/transactions/budgets?mode=year${dv ? `&dv=${dv}` : ""}`;

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

async function open(page: Page, dv?: string): Promise<void> {
  await page.goto(year(dv));
  await expect(page.locator("[data-budget-category='Moradia']")).toBeVisible();
}

flow("Anual on a desktop: three ways to see fixo and variável", async ({ page, scene, say, check, pause }) => {
  await scene("Hoje", "Orçamentos › Anual a 1440px, sem o parâmetro");
  await say("Without ?dv= the desktop stays exactly as shipped: no fixo/variável summary");
  await open(page);
  await check("The shipped view has no fixo/variável block", async () => {
    await expect(page.locator("[data-budget-heat]")).toBeVisible();
    await expect(page.locator("[data-kind-cards], [data-kind-split-inline], [data-heat-section], [data-stacked-chart]")).toHaveCount(0);
  });
  await fullShot(page, "current-light");

  await scene("A · Cartões Fixo e Variável", "?dv=a: um painel por tipo, abaixo dos KPIs");
  await say("Each kind gets spend so far, its share, budget, year projection, months over and its twelve months");
  await open(page, "a");
  const cards = page.locator("[data-kind-cards='row']");
  await check("Fixo and Variável cards sit under the KPIs, with their months", async () => {
    await expect(cards).toBeInViewport();
    await expect(cards.locator("[data-kind-card='fixo']")).toContainText("% do gasto");
    await expect(cards.locator("[data-kind-card='variavel']")).toContainText("Projeção do ano");
    await expect(cards.locator("[data-mini-bars]")).toHaveCount(2);
  });
  await fullShot(page, "a-light");
  await say("A card is also the Tipo filter: Fixo leaves only fixed budgets in the table");
  await cards.locator("[data-kind-card='fixo']").click();
  await check("Clicking Fixo filters the year to fixed budgets", async () => {
    await expect(page).toHaveURL(/[?&]k=fixo/);
    await expect(cards.locator("[data-kind-card='fixo']")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("[data-budget-category='Transporte']")).toHaveCount(0);
    await expect(page.locator("[data-budget-category='Moradia']")).toBeVisible();
  });
  await cards.locator("[data-kind-card='fixo']").click();
  await expect(page).not.toHaveURL(/[?&]k=/);

  await scene("B · Tabela por tipo", "?dv=b: seções Fixo e Variável com subtotal por mês");
  await say("The table groups its rows by kind, like Mensal, and each group adds up its months");
  await open(page, "b");
  await check("Fixo and Variável sections, each with a subtotal row per month", async () => {
    const fixo = page.locator("[data-heat-section='fixo']");
    const variavel = page.locator("[data-heat-section='variavel']");
    await expect(fixo).toContainText("Fixo");
    await expect(variavel).toContainText("Variável");
    const y = async (selector: string) => (await page.locator(selector).boundingBox())!.y;
    expect(await y("[data-heat-section='fixo']")).toBeLessThan(await y("[data-budget-category='Moradia']"));
    expect(await y("[data-budget-category='Moradia']")).toBeLessThan(await y("[data-heat-section='variavel']"));
    expect(await y("[data-heat-section='variavel']")).toBeLessThan(await y("[data-budget-category='Transporte']"));
    await expect(page.locator("[data-budget-category='Transporte']").getByText("Variável", { exact: true })).toHaveCount(0);
  });
  await check("The phone's split sits in the KPI strip", async () => {
    await expect(page.locator("[data-kind-split-inline]")).toBeVisible();
    await expect(page.locator("[data-kind-split-side='fixo']")).toContainText("Fixo");
  });
  await fullShot(page, "b-light");

  await scene("C · Gráfico por tipo", "?dv=c: o gráfico mensal empilhado, ao lado dos tipos");
  await say("The monthly chart moves up, stacked by kind in heartwood and resin; projection is the lighter tone");
  await open(page, "c");
  const chart = page.locator("[data-stacked-chart]");
  await check("The monthly chart is stacked by kind beside the two cards", async () => {
    await expect(chart).toBeInViewport();
    await expect(chart.locator(".recharts-bar-rectangle").first()).toBeVisible();
    const legend = page.locator("[data-budget-legend]").first();
    await expect(legend).toContainText("Fixo");
    await expect(legend).toContainText("Variável");
    await expect(page.locator("[data-kind-cards='stack']")).toBeInViewport();
    await expect(page.getByText("Gasto mensal vs orçado", { exact: true })).toHaveCount(1);
  });
  await pause(800);
  await fullShot(page, "c-light");

  await scene("No escuro", "As mesmas quatro telas no tema escuro");
  await setTheme(page, "Escuro");
  await open(page);
  await fullShot(page, "current-dark");
  for (const dv of ["a", "b", "c"]) {
    await open(page, dv);
    await fullShot(page, `${dv}-dark`);
  }
  await check("Dark: every alternative renders", async () => {
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await expect(chart).toBeVisible();
    await open(page, "a");
    await expect(cards).toBeVisible();
    await open(page, "b");
    await expect(page.locator("[data-heat-section='fixo']")).toBeVisible();
  });
  await setTheme(page, "Claro");
});
