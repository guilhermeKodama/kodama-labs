import { expect, flow } from "@repo/proof-video";
import { budgetRow, createInList, dialog, field, openBudgets, pickFromList, readNumber, toast } from "../helpers";

// 390px wide, the width the review asked to see. Its own category, so a shared proof run does not collide.
const CATEGORY = "Plano celular";
flow.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
flow.setTimeout(120_000);

flow("Budgets on a phone: kind, filter and a reimbursement", async ({ page, scene, say, check, type }) => {
  await openBudgets(page);
  const budget = budgetRow(page, CATEGORY);
  const fixo = page.locator('[data-budget-subtotal="fixo"]');
  await fixo.scrollIntoViewIfNeeded();
  const fixoBefore = readNumber(await fixo.innerText());

  await scene("Fixo on a phone", "The floating button opens the same dialog");
  await say("Orçamento, then a new category marked Fixo");
  await page.locator("[data-fab]").click();
  const create = dialog(page, "Novo orçamento");
  await createInList(create.getByLabel("Categoria"), CATEGORY);
  await type(create.getByLabel("Valor"), "500");
  await create.getByRole("radiogroup", { name: "Tipo" }).getByRole("radio", { name: "Fixo" }).click();
  await create.getByRole("button", { name: "Criar orçamento" }).click();
  await budget.row.scrollIntoViewIfNeeded();
  await check("Plano celular is Fixo at R$ 500", async () => {
    await expect(toast(page, `Orçamento de ${CATEGORY} criado`)).toBeVisible();
    await expect(budget.row).toContainText("Fixo");
    await expect(budget.amount).toHaveText(/R\$\s*500$/);
  });

  await scene("The filter", "Variável hides it; Fixo keeps only the fixo total");
  const kindFilter = page.getByRole("radiogroup", { name: "Tipo" });
  await kindFilter.scrollIntoViewIfNeeded();
  await kindFilter.getByRole("radio", { name: "Variável" }).click();
  await check("Variável hides Plano celular", async () => {
    await expect(budget.row).toHaveCount(0);
  });
  await kindFilter.getByRole("radio", { name: "Fixo" }).click();
  await fixo.scrollIntoViewIfNeeded();
  await check("Fixo shows the row and Fixo, Variável, Total", async () => {
    await expect(budget.row).toBeVisible();
    expect(readNumber(await fixo.innerText()) - fixoBefore).toBe(500);
    expect(readNumber(await page.locator('[data-budget-subtotal="variavel"]').innerText())).toBe(0);
    await expect(page.locator('[data-budget-subtotal="variavel"]')).toContainText("Variável");
    await expect(page.locator('[data-budget-subtotal="total"]')).toContainText("Total");
  });

  await scene("Reembolso", "An income can name the expense category it pays back");
  await say("An income of R$ 80 that reimburses Plano celular");
  await page.goto("/transactions");
  await page.locator("[data-fab]").click();
  const income = dialog(page, "Nova transação");
  await income.getByRole("radio", { name: "Entrada" }).click();
  await type(income.getByPlaceholder("0,00"), "80");
  await type(income.getByPlaceholder("Ex.: iFood, Invoice #0142, Aluguel"), "Pix do celular");
  await pickFromList(field(income, "Categoria").getByRole("button"), "Reembolsos");
  const reimburses = field(income, "Reembolsa").getByRole("button").first();
  await pickFromList(reimburses, CATEGORY);
  await check("Reembolsa names Plano celular", async () => {
    await reimburses.scrollIntoViewIfNeeded();
    await expect(reimburses).toBeInViewport();
    await expect(reimburses).toHaveText(CATEGORY);
  });
  await income.getByRole("button", { name: "Salvar" }).click();
  await expect(toast(page, "“Pix do celular” criada")).toBeVisible();

  await openBudgets(page);
  await budget.row.scrollIntoViewIfNeeded();
  await check("The phone row shows reembolsado R$ 80", async () => {
    await expect(budget.row).toContainText(/reembolsado\s+R\$\s*80/);
    await expect(budget.row).toContainText(/R\$\s*80/);
  });

  await scene("Escuro", "Then back to Claro");
  await page.goto("/settings");
  await page.getByRole("radiogroup", { name: "Tema" }).getByRole("radio", { name: "Escuro" }).click();
  await openBudgets(page);
  await budget.row.scrollIntoViewIfNeeded();
  await check("The reimbursement stays visible in the dark theme", async () => {
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await expect(budget.row).toContainText(/reembolsado\s+R\$\s*80/);
  });
  await page.goto("/settings");
  await page.getByRole("radiogroup", { name: "Tema" }).getByRole("radio", { name: "Claro" }).click();
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
});
