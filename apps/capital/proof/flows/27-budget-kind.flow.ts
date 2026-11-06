import { expect, flow } from "@repo/proof-video";
import { budgetRow, createInList, dialog, openBudgets, readNumber, toast } from "../helpers";

// The demo data has no budget and no category with this name.
const CATEGORY = "Plano prova";

flow("A budget is fixo or variável, and the month can show one kind", async ({ page, scene, say, check, type }) => {
  await openBudgets(page);
  const budget = budgetRow(page, CATEGORY);
  const kindFilter = page.getByRole("radiogroup", { name: "Tipo" });
  const fixo = page.locator('[data-budget-subtotal="fixo"]');
  await fixo.scrollIntoViewIfNeeded();
  const fixoBefore = readNumber(await fixo.innerText());

  await scene("Fixo or variável", "One budget per category; the kind is a property of that budget");
  await say("+ Orçamento asks for the category, the amount and the kind");
  await page.getByRole("button", { name: "+ Orçamento" }).click();
  const create = dialog(page, "Novo orçamento");
  await createInList(create.getByLabel("Categoria"), CATEGORY);
  await type(create.getByLabel("Valor"), "500");
  await create.getByRole("radiogroup", { name: "Tipo" }).getByRole("radio", { name: "Fixo" }).click();
  await create.getByRole("button", { name: "Criar orçamento" }).click();
  await budget.row.scrollIntoViewIfNeeded();
  await check("Plano prova is Fixo, orçado R$ 500", async () => {
    await expect(toast(page, `Orçamento de ${CATEGORY} criado`)).toBeVisible();
    await expect(budget.row).toContainText("Fixo");
    await expect(budget.amount).toHaveText(/R\$\s*500$/);
  });

  await scene("Filter and subtotals", "Todos, Fixo or Variável; the totals follow the filter");
  await say("Variável hides a budget marked Fixo");
  await kindFilter.getByRole("radio", { name: "Variável" }).click();
  await check("Variável hides Plano prova", async () => {
    await expect(page).toHaveURL(/[?&]k=variavel/);
    await expect(budget.row).toHaveCount(0);
  });
  await say("Fixo brings it back, and Variável drops out of the month");
  await kindFilter.getByRole("radio", { name: "Fixo" }).click();
  const variavel = page.locator('[data-budget-subtotal="variavel"]');
  const total = page.locator('[data-budget-subtotal="total"]');
  await fixo.scrollIntoViewIfNeeded();
  await check("Fixo shows Plano prova and the three subtotals", async () => {
    await expect(budget.row).toBeVisible();
    await expect(budget.row).toContainText("Fixo");
    await expect(fixo).toContainText("Fixo");
    expect(readNumber(await fixo.innerText()) - fixoBefore).toBe(500);
    expect(readNumber(await variavel.innerText())).toBe(0);
    await expect(variavel).toContainText("Variável");
    await expect(total).toContainText("Total");
  });

  await scene("Escuro", "The same month, then back to Claro");
  await say("Ajustes › Tema › Escuro");
  await page.goto("/settings");
  await page.getByRole("radiogroup", { name: "Tema" }).getByRole("radio", { name: "Escuro" }).click();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await openBudgets(page);
  await kindFilter.getByRole("radio", { name: "Fixo" }).click();
  await budget.row.scrollIntoViewIfNeeded();
  await check("Plano prova stays Fixo in the dark theme", async () => {
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await expect(budget.row).toContainText("Fixo");
    expect(readNumber(await fixo.innerText()) - fixoBefore).toBe(500);
    expect(readNumber(await page.locator('[data-budget-subtotal="variavel"]').innerText())).toBe(0);
  });
  await page.goto("/settings");
  await page.getByRole("radiogroup", { name: "Tema" }).getByRole("radio", { name: "Claro" }).click();
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
});
