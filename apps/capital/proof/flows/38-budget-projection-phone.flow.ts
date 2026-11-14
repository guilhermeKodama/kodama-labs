import { expect, flow } from "@repo/proof-video";
import type { Page } from "@playwright/test";
import { openBudgets, panel } from "../helpers";

// 390px wide, the width the review asks for.
flow.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
flow.setTimeout(120_000);

async function openYear(page: Page) {
  await page.getByRole("radiogroup", { name: "Visão" }).getByRole("radio", { name: "Anual" }).click();
  // Below md the heatmap is hidden and the year is the category cards. "Ano (proj.)" is that table's header.
  await expect(page.locator("[data-phone-layout=cards]")).toBeVisible();
}

async function setTheme(page: Page, theme: "Claro" | "Escuro") {
  await page.goto("/settings");
  await page.getByRole("radiogroup", { name: "Tema" }).getByRole("radio", { name: theme }).click();
  await expect(page.locator("html")).toHaveClass(theme === "Escuro" ? /\bdark\b/ : /^(?!.*\bdark\b)/);
}

flow("On a phone, the projection splits by kind and Anual names its budgeted months", async ({ page, scene, say, check }) => {
  const projection = page.locator('[data-budget-kpi="projection"]');
  const budgetLabel = page.locator("[data-budget-kpi-span]");
  const chart = panel(page, "Gasto acumulado vs ritmo ideal");

  for (const theme of ["Claro", "Escuro"] as const) {
    const dark = theme === "Escuro";
    await scene(`Mensal · ${theme}`, "The totals strip, then the chart");
    if (dark) await setTheme(page, "Escuro");
    await openBudgets(page);
    await projection.scrollIntoViewIfNeeded();
    await say("Projeção fim do mês, with fixo and variável under it");
    await check(`Mensal ${dark ? "escuro" : "claro"}: the projection splits by kind`, async () => {
      await expect(page.locator("html")).toHaveClass(dark ? /\bdark\b/ : /^(?!.*\bdark\b)/);
      await expect(projection).toBeInViewport();
      await expect(projection.locator("[data-budget-projection-split]")).toHaveText(/^fixo R\$ [\d.]+ · variável R\$ [\d.]+$/);
    });
    await chart.scrollIntoViewIfNeeded();
    await check(`Mensal ${dark ? "escuro" : "claro"}: the chart draws the projection`, async () => {
      await expect(chart).toBeInViewport();
      await expect(chart.locator("[data-budget-legend]").getByText("Projeção (R$ mil)", { exact: true })).toBeVisible();
    });

    await scene(`Anual · ${theme}`, "Spend and budget over the same months");
    await openYear(page);
    await budgetLabel.scrollIntoViewIfNeeded();
    await check(`Anual ${dark ? "escuro" : "claro"}: Orçado names its months`, async () => {
      await expect(budgetLabel).toBeInViewport();
      await expect(budgetLabel).toHaveText(/^Orçado em \S+(–\S+)?$/);
      await expect(page.getByText(/^\d+% do orçado em \S+/)).toBeVisible();
    });
  }
  await setTheme(page, "Claro");
});
