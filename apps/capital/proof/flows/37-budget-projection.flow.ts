import { expect, flow } from "@repo/proof-video";
import type { Locator, Page } from "@playwright/test";
import { addExpense, createInList, dialog, openBudgets, openTransactions, panel, toast } from "../helpers";

// The demo data has no category or budget with these names, so the rows are the flow's own.
const CATEGORY = "Aluguel prova";
const BILL = "Aluguel da prova";

/** The first amount on a card, keeping the minus in "−R$ 80". */
function cardMoney(text: string): number {
  const match = /([-−])?\s*R\$\s*(\d[\d.]*(?:,\d+)?)/.exec(text);
  if (!match) throw new Error(`No amount in "${text}"`);
  const value = Number(match[2].replace(/\./g, "").replace(",", "."));
  return match[1] ? -value : value;
}

/** "fixo R$ 1.085 · variável R$ 900" under the projection: the two amounts. */
async function split(card: Locator) {
  const text = await card.locator("[data-budget-projection-split]").innerText();
  const [fixo, variavel] = [...text.matchAll(/R\$\s*(\d[\d.]*)/g)].map((m) => Number(m[1].replace(/\./g, "")));
  return { fixo, variavel };
}

async function openYear(page: Page) {
  await page.getByRole("radiogroup", { name: "Visão" }).getByRole("radio", { name: "Anual" }).click();
  await expect(page.getByText("Ano (proj.)")).toBeVisible();
}

async function setTheme(page: Page, theme: "Claro" | "Escuro") {
  await page.goto("/settings");
  await page.getByRole("radiogroup", { name: "Tema" }).getByRole("radio", { name: theme }).click();
  await expect(page.locator("html")).toHaveClass(theme === "Escuro" ? /\bdark\b/ : /^(?!.*\bdark\b)/);
}

flow.setTimeout(150_000);

flow("Budget projections: a fixed bill is not stretched over the month, and Anual compares like with like", async ({ page, scene, say, check, type }) => {
  await openBudgets(page);
  const projection = page.locator('[data-budget-kpi="projection"]');
  const kindFilter = page.getByRole("radiogroup", { name: "Tipo" });
  await expect(projection).toContainText("R$");
  const before = cardMoney(await projection.innerText());

  await scene("Projeção fim do mês", "Split into fixo and variável, with the method on the label");
  await say("The card shows how the month-end number divides by kind");
  await check("The projection card splits into fixo and variável", async () => {
    await expect(projection).toBeInViewport();
    await expect(projection.locator("[data-budget-projection-split]")).toHaveText(/^fixo R\$ [\d.]+ · variável R\$ [\d.]+$/);
    const parts = await split(projection);
    expect(Math.abs(parts.fixo + parts.variavel - cardMoney(await projection.innerText()))).toBeLessThanOrEqual(1);
    await expect(projection.locator("span[title]").first()).toHaveAttribute("title", /não estica pelo dia/);
  });

  await scene("A fixed bill paid early", "R$ 2.900 of a R$ 3.000 fixed budget, halfway through the month");
  await say("+ Orçamento: a new Fixo category of R$ 3.000");
  await page.getByRole("button", { name: "+ Orçamento" }).click();
  const create = dialog(page, "Novo orçamento");
  await createInList(create.getByLabel("Categoria"), CATEGORY);
  await type(create.getByLabel("Valor"), "3000");
  await create.getByRole("radiogroup", { name: "Tipo" }).getByRole("radio", { name: "Fixo" }).click();
  await create.getByRole("button", { name: "Criar orçamento" }).click();
  await expect(toast(page, `Orçamento de ${CATEGORY} criado`)).toBeVisible();
  await say("The bill, R$ 2.900, posted today");
  await openTransactions(page);
  await addExpense(page, { description: BILL, amount: "2900", category: CATEGORY });
  await openBudgets(page);
  await say("Stretched by the day it would be about double; it ends at the budget");
  await check("The projection grows by R$ 3.000, the expected month", async () => {
    await expect(projection).toBeInViewport();
    await expect.poll(async () => cardMoney(await projection.innerText()) - before).toBe(3000);
  });
  await say("Fixo shows the same fixed number the card split named");
  const fixoPart = (await split(projection)).fixo;
  await kindFilter.getByRole("radio", { name: "Fixo" }).click();
  await check("Under Fixo the card is the fixed part of the split", async () => {
    await expect(page).toHaveURL(/[?&]k=fixo/);
    await expect.poll(async () => cardMoney(await projection.innerText())).toBe(fixoPart);
    await expect(projection.locator("[data-budget-projection-split]")).toHaveCount(0);
  });
  await kindFilter.getByRole("radio", { name: "Todos" }).click();

  await scene("The chart", "A dashed segment from today to the month-end projection");
  const chart = panel(page, "Gasto acumulado vs ritmo ideal");
  await chart.scrollIntoViewIfNeeded();
  await check("The pace chart draws the projection, total and fixo", async () => {
    await expect(chart).toBeInViewport();
    const legend = chart.locator("[data-budget-legend]");
    await expect(legend.getByText("Projeção (R$ mil)", { exact: true })).toBeVisible();
    await expect(legend.getByText("Projeção fixo (R$ mil)", { exact: true })).toBeVisible();
    await expect(chart.locator(".recharts-line-curve[stroke-dasharray]")).toHaveCount(2);
  });

  await scene("Anual", "Spend and budget over the same months");
  await openYear(page);
  const budgetLabel = page.locator("[data-budget-kpi-span]");
  await say("Orçado names the months that had a budget, and % do orçado uses only those");
  await check("Orçado names its months and explains them", async () => {
    await expect(budgetLabel).toBeInViewport();
    await expect(budgetLabel).toHaveText(/^Orçado em \S+(–\S+)?$/);
    await expect(budgetLabel).toHaveAttribute("title", /^Só os meses com orçamento: .+\. Gasto nesses meses: R\$ [\d.]+ de R\$ [\d.]+ orçados\.$/);
    await expect(page.getByText(/^\d+% do orçado em \S+/)).toBeVisible();
  });
  await say("Tendência quotes no jump past 200%, and nothing is projected below zero");
  await check("No trend past 200%, no negative month or year", async () => {
    const trends = await page.getByText(/^↑ \d+%$/).allInnerTexts();
    for (const trend of trends) expect(Number(trend.replace(/\D/g, ""))).toBeLessThanOrEqual(200);
    await expect(page.locator("[data-budget-heat]")).not.toContainText(/[-−]R\$/);
    await expect(page.getByText("Tendência", { exact: true })).toHaveAttribute("title", /últimos 3 meses fechados contra os 3 anteriores/);
  });

  await scene("Escuro", "The same two screens, then back to Claro");
  await setTheme(page, "Escuro");
  await openBudgets(page);
  await check("Mensal in the dark theme keeps the split", async () => {
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await expect(projection).toBeInViewport();
    await expect(projection.locator("[data-budget-projection-split]")).toBeVisible();
  });
  await openYear(page);
  await check("Anual in the dark theme names the budgeted months", async () => {
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await expect(budgetLabel).toHaveText(/^Orçado em /);
  });
  await setTheme(page, "Claro");
});
