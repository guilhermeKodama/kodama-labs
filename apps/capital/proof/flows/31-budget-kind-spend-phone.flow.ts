import { expect, flow } from "@repo/proof-video";
import { createInList, dialog, field, openBudgets, panel, pickFromList, readNumber, toast } from "../helpers";

const CATEGORY = "Plano totais cel";
const SPEND = "Gasto do plano cel";

/** The first amount on a card, keeping the minus in "−R$ 80". */
function cardMoney(text: string): number {
  const match = /([-−])?\s*R\$\s*(\d[\d.]*(?:,\d+)?)/.exec(text);
  if (!match) return readNumber(text);
  const value = Number(match[2].replace(/\./g, "").replace(",", "."));
  return match[1] ? -value : value;
}

flow.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
flow.setTimeout(120_000);

flow("On a phone, Gastos fixos and Gastos variáveis follow the filter", async ({ page, scene, say, check, type }) => {
  await openBudgets(page);
  const fixoCard = page.locator('[data-budget-kpi="fixo"]');
  const variavelCard = page.locator('[data-budget-kpi="variavel"]');
  await fixoCard.scrollIntoViewIfNeeded();
  const fixoBefore = cardMoney(await fixoCard.innerText());
  const chart = panel(page, "Gasto acumulado vs ritmo ideal");
  const legend = chart.locator("[data-budget-legend]");

  await scene("The cards", "The same two totals, on a 390px screen");
  await say("Orçamento, then a new category marked Fixo");
  await page.locator("[data-fab]").click();
  const create = dialog(page, "Novo orçamento");
  await createInList(create.getByLabel("Categoria"), CATEGORY);
  await type(create.getByLabel("Valor"), "400");
  await create.getByRole("radiogroup", { name: "Tipo" }).getByRole("radio", { name: "Fixo" }).click();
  await create.getByRole("button", { name: "Criar orçamento" }).click();
  await expect(toast(page, `Orçamento de ${CATEGORY} criado`)).toBeVisible();

  await say("An expense of R$ 80 in that category");
  await page.goto("/transactions");
  await page.locator("[data-fab]").click();
  const expense = dialog(page, "Nova transação");
  await type(expense.getByPlaceholder("0,00"), "80");
  await type(expense.getByPlaceholder("Ex.: iFood, Invoice #0142, Aluguel"), SPEND);
  await pickFromList(field(expense, "Categoria").getByRole("button"), CATEGORY);
  await expense.getByRole("button", { name: "Salvar" }).click();
  await expect(toast(page, `“${SPEND}” criada`)).toBeVisible();

  await openBudgets(page);
  await fixoCard.scrollIntoViewIfNeeded();
  await check("Gastos fixos grew by R$ 80", async () => {
    await expect(fixoCard).toBeInViewport();
    await expect(fixoCard).toContainText("Gastos fixos");
    await expect(variavelCard).toContainText("Gastos variáveis");
    expect(cardMoney(await fixoCard.innerText()) - fixoBefore).toBe(80);
  });

  await scene("The chart", "The stack is under the line, and the filter changes it");
  await chart.scrollIntoViewIfNeeded();
  await check("The pace chart names Gastos fixos and Gastos variáveis", async () => {
    await expect(chart).toBeInViewport();
    await expect(legend.getByText("Gastos fixos", { exact: true })).toBeVisible();
    await expect(legend.getByText("Gastos variáveis", { exact: true })).toBeVisible();
  });
  const kindFilter = page.getByRole("radiogroup", { name: "Tipo" });
  await kindFilter.scrollIntoViewIfNeeded();
  await kindFilter.getByRole("radio", { name: "Fixo" }).click();
  await variavelCard.scrollIntoViewIfNeeded();
  await check("Fixo keeps Gastos variáveis at zero", async () => {
    expect(readNumber(await variavelCard.innerText())).toBe(0);
    expect(cardMoney(await fixoCard.innerText()) - fixoBefore).toBe(80);
  });

  await scene("Escuro", "Then back to Claro");
  await page.goto("/settings");
  await page.getByRole("radiogroup", { name: "Tema" }).getByRole("radio", { name: "Escuro" }).click();
  await openBudgets(page);
  await chart.scrollIntoViewIfNeeded();
  await check("The chart stays readable in the dark theme", async () => {
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await expect(legend.getByText("Gastos fixos", { exact: true })).toBeVisible();
    await expect(legend.getByText("Gastos variáveis", { exact: true })).toBeVisible();
  });
  await page.goto("/settings");
  await page.getByRole("radiogroup", { name: "Tema" }).getByRole("radio", { name: "Claro" }).click();
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
});
