import { expect, flow } from "@repo/proof-video";
import { budgetRow, createInList, dialog, field, openBudgets, openTransactions, pickFromList, toast } from "../helpers";

// Its own category, so it does not collide with the kind flow's "Plano prova".
const CATEGORY = "Plano reembolso";
const EXPENSE = "Consulta da prova";
const INCOME = "Pix da prova";

flow("Income assigned to an expense category reduces that budget", async ({ page, scene, say, check, type }) => {
  await openBudgets(page);

  await scene("The expense budget", "The category alone decides which budget an entry counts in");
  await say("A Fixo budget of R$ 500 for Plano reembolso");
  await page.getByRole("button", { name: "+ Orçamento" }).click();
  const create = dialog(page, "Novo orçamento");
  await createInList(create.getByLabel("Categoria"), CATEGORY);
  await type(create.getByLabel("Valor"), "500");
  await create.getByRole("radiogroup", { name: "Tipo" }).getByRole("radio", { name: "Fixo" }).click();
  await create.getByRole("button", { name: "Criar orçamento" }).click();
  await expect(toast(page, `Orçamento de ${CATEGORY} criado`)).toBeVisible();

  await scene("The expense and the Pix", "Any income can reimburse an expense category");
  await say("First the R$ 200 expense in that category");
  await openTransactions(page);
  await page.getByRole("button", { name: "+ Nova transação" }).click();
  const expense = dialog(page, "Nova transação");
  await type(expense.getByPlaceholder("0,00"), "200");
  await type(expense.getByPlaceholder("Ex.: iFood, Invoice #0142, Aluguel"), EXPENSE);
  await pickFromList(field(expense, "Categoria").getByRole("button"), CATEGORY);
  await expense.getByRole("button", { name: "Salvar" }).click();
  await expect(toast(page, `“${EXPENSE}” criada`)).toBeVisible();

  await say("Then an income of R$ 80 that reimburses the same category");
  await page.getByRole("button", { name: "+ Nova transação" }).click();
  const income = dialog(page, "Nova transação");
  await income.getByRole("radio", { name: "Entrada" }).click();
  await type(income.getByPlaceholder("0,00"), "80");
  await type(income.getByPlaceholder("Ex.: iFood, Invoice #0142, Aluguel"), INCOME);
  await pickFromList(field(income, "Categoria").getByRole("button"), "Reembolsos");
  const reimburses = field(income, "Reembolsa").getByRole("button").first();
  await pickFromList(reimburses, CATEGORY);
  await check("Reembolsa names Plano reembolso", async () => {
    await expect(reimburses).toHaveText(CATEGORY);
  });
  await income.getByRole("button", { name: "Salvar" }).click();
  await expect(toast(page, `“${INCOME}” criada`)).toBeVisible();

  await scene("Bruto, reembolsado, líquido", "The income counts negative inside that category's budget");
  await openBudgets(page);
  const budget = budgetRow(page, CATEGORY);
  await budget.row.scrollIntoViewIfNeeded();
  await check("Líquido R$ 120, bruto R$ 200, reembolsado R$ 80", async () => {
    await expect(budget.row).toContainText(/R\$\s*120/);
    await expect(budget.row).toContainText(/bruto\s+R\$\s*200/);
    await expect(budget.row).toContainText(/reembolsado\s+R\$\s*80/);
  });

  await scene("Escuro", "The same row, then back to Claro");
  await page.goto("/settings");
  await page.getByRole("radiogroup", { name: "Tema" }).getByRole("radio", { name: "Escuro" }).click();
  await openBudgets(page);
  await budget.row.scrollIntoViewIfNeeded();
  await check("The líquido stays on the row in the dark theme", async () => {
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await expect(budget.row).toContainText(/bruto\s+R\$\s*200/);
    await expect(budget.row).toContainText(/reembolsado\s+R\$\s*80/);
  });
  await page.goto("/settings");
  await page.getByRole("radiogroup", { name: "Tema" }).getByRole("radio", { name: "Claro" }).click();
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
});
