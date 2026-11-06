import { expect, flow } from "@repo/proof-video";
import { createInList, dialog, field, openBudgets, openTransactions, panel, pickFromList, readNumber, swatchColor, toast } from "../helpers";

// Its own category, so a shared proof run does not collide with Plano prova / Plano reembolso / Plano celular.
const CATEGORY = "Plano totais";
const SPEND = "Gasto do plano";

/** Fixo, variável, the cumulative line, the ideal pace and the orçado mark, each a different painted color. The two cards use the chart's fixo and variável. */
async function expectDistinctPaceColors(legend: import("@playwright/test").Locator, fixoCard: import("@playwright/test").Locator, variavelCard: import("@playwright/test").Locator) {
  const [fixo, variavel, cumulative, ideal, budget] = await Promise.all([
    swatchColor(legend, "Gastos fixos"),
    swatchColor(legend, "Gastos variáveis"),
    swatchColor(legend, /Gasto acumulado/),
    swatchColor(legend, /Ritmo ideal/),
    swatchColor(legend, "Orçado"),
  ]);
  expect(new Set([fixo, variavel, cumulative, ideal, budget]).size).toBe(5);
  expect(await swatchColor(fixoCard, "Gastos fixos")).toBe(fixo);
  expect(await swatchColor(variavelCard, "Gastos variáveis")).toBe(variavel);
}

/** The first amount on a card, keeping the minus in "−R$ 80". */
function cardMoney(text: string): number {
  const match = /([-−])?\s*R\$\s*(\d[\d.]*(?:,\d+)?)/.exec(text);
  if (!match) return readNumber(text);
  const value = Number(match[2].replace(/\./g, "").replace(",", "."));
  return match[1] ? -value : value;
}

flow.setTimeout(120_000);

flow("Gastos fixos and Gastos variáveis follow the filter, and the pace chart stacks them", async ({ page, scene, say, check, type }) => {
  await openBudgets(page);
  const fixoCard = page.locator('[data-budget-kpi="fixo"]');
  const variavelCard = page.locator('[data-budget-kpi="variavel"]');
  await fixoCard.scrollIntoViewIfNeeded();
  const fixoBefore = cardMoney(await fixoCard.innerText());
  const chart = panel(page, "Gasto acumulado vs ritmo ideal");
  const legend = chart.locator("[data-budget-legend]");

  await scene("Two cards", "Gastos fixos and Gastos variáveis sit with the other totals");
  await say("+ Orçamento, a new category marked Fixo");
  await page.getByRole("button", { name: "+ Orçamento" }).click();
  const create = dialog(page, "Novo orçamento");
  await createInList(create.getByLabel("Categoria"), CATEGORY);
  await type(create.getByLabel("Valor"), "400");
  await create.getByRole("radiogroup", { name: "Tipo" }).getByRole("radio", { name: "Fixo" }).click();
  await create.getByRole("button", { name: "Criar orçamento" }).click();
  await expect(toast(page, `Orçamento de ${CATEGORY} criado`)).toBeVisible();

  await say("An expense of R$ 120 in that category");
  await openTransactions(page);
  await page.keyboard.press("n");
  const expense = dialog(page, "Nova transação");
  await type(expense.getByPlaceholder("0,00"), "120");
  await type(expense.getByPlaceholder("Ex.: iFood, Invoice #0142, Aluguel"), SPEND);
  await pickFromList(field(expense, "Categoria").getByRole("button"), CATEGORY);
  await expense.getByRole("button", { name: "Salvar" }).click();
  await expect(toast(page, `“${SPEND}” criada`)).toBeVisible();

  await openBudgets(page);
  await fixoCard.scrollIntoViewIfNeeded();
  await check("Gastos fixos grew by the R$ 120, líquido", async () => {
    await expect(fixoCard).toContainText("Gastos fixos");
    await expect(variavelCard).toContainText("Gastos variáveis");
    expect(cardMoney(await fixoCard.innerText()) - fixoBefore).toBe(120);
  });

  await scene("The chart", "Fixo and variável stack under the cumulative line");
  await say("The legend names both, and the tooltip shows their values");
  await chart.scrollIntoViewIfNeeded();
  const surface = chart.locator(".recharts-surface");
  const box = await surface.boundingBox();
  if (!box) throw new Error("The pace chart has no surface");
  await page.mouse.move(box.x + box.width * 0.72, box.y + box.height * 0.45);
  await check("The pace chart stacks Gastos fixos and Gastos variáveis", async () => {
    await expect(legend.getByText("Gastos fixos", { exact: true })).toBeVisible();
    await expect(legend.getByText("Gastos variáveis", { exact: true })).toBeVisible();
    await expect(legend.getByText("Gasto acumulado", { exact: false })).toBeVisible();
    await expect(chart.locator(".recharts-tooltip-wrapper")).toContainText("Gastos fixos");
    await expect(chart.locator(".recharts-tooltip-wrapper")).toContainText(/R\$/);
    await expectDistinctPaceColors(legend, fixoCard, variavelCard);
  });

  await scene("The filter", "Variável hides the fixo spend; Fixo hides the variável spend");
  await page.mouse.move(0, 0);
  await say("Variável: Gastos fixos goes to zero and leaves the chart");
  const kindFilter = page.getByRole("radiogroup", { name: "Tipo" });
  await kindFilter.getByRole("radio", { name: "Variável" }).click();
  await fixoCard.scrollIntoViewIfNeeded();
  await check("Variável keeps Gastos fixos at zero", async () => {
    expect(readNumber(await fixoCard.innerText())).toBe(0);
    await expect(legend.getByText("Gastos fixos", { exact: true })).toHaveCount(0);
    await expect(legend.getByText("Gastos variáveis", { exact: true })).toBeVisible();
  });
  await say("Fixo: Gastos variáveis goes to zero and the R$ 120 stays");
  await kindFilter.getByRole("radio", { name: "Fixo" }).click();
  await variavelCard.scrollIntoViewIfNeeded();
  await check("Fixo keeps Gastos variáveis at zero", async () => {
    expect(readNumber(await variavelCard.innerText())).toBe(0);
    expect(cardMoney(await fixoCard.innerText()) - fixoBefore).toBe(120);
    await expect(legend.getByText("Gastos variáveis", { exact: true })).toHaveCount(0);
    await expect(legend.getByText("Gastos fixos", { exact: true })).toBeVisible();
  });

  await scene("Escuro", "The same cards and chart, then back to Claro");
  await say("Ajustes › Tema › Escuro");
  await page.goto("/settings");
  await page.getByRole("radiogroup", { name: "Tema" }).getByRole("radio", { name: "Escuro" }).click();
  await openBudgets(page);
  await page.getByRole("radiogroup", { name: "Tipo" }).getByRole("radio", { name: "Todos" }).click();
  await chart.scrollIntoViewIfNeeded();
  await check("Both kinds stay on the chart in the dark theme", async () => {
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await expect(fixoCard).toContainText("Gastos fixos");
    await expect(legend.getByText("Gastos fixos", { exact: true })).toBeVisible();
    await expect(legend.getByText("Gastos variáveis", { exact: true })).toBeVisible();
    await expectDistinctPaceColors(legend, fixoCard, variavelCard);
  });
  await page.goto("/settings");
  await page.getByRole("radiogroup", { name: "Tema" }).getByRole("radio", { name: "Claro" }).click();
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
});
