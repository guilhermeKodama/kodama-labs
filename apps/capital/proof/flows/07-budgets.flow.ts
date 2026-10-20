import { expect, flow } from "@repo/proof-video";
import { budgetRow, dialog, openBudgets, pickFromList, toast } from "../helpers";

// The demo data has the category "Pets" and no budget for it, so the budget made here is the flow's own.
const CATEGORY = "Pets";

flow("Create, edit and delete a budget", async ({ page, scene, say, check, type }) => {
  await openBudgets(page);
  const budget = budgetRow(page, CATEGORY);
  const view = page.getByRole("radiogroup", { name: "Visão" });
  await expect(budget.row).toHaveCount(0);

  await scene("Create a budget", "A monthly limit for one category");
  await say("+ Orçamento asks for the category, the entity, the amount and the period");
  await page.getByRole("button", { name: "+ Orçamento" }).click();
  const create = dialog(page, "Novo orçamento");
  await pickFromList(create.getByLabel("Categoria"), CATEGORY);
  await type(create.getByLabel("Valor"), "300");
  await say("Entidade and Período keep what they offer: PF, Mensal");
  await create.getByRole("button", { name: "Criar orçamento" }).click();
  await check("Pets joins the month's table with R$ 300", async () => {
    await expect(toast(page, `Orçamento de ${CATEGORY} criado`)).toBeVisible();
    await expect(budget.amount).toHaveText(/R\$\s300$/);
  });

  await scene("Change the amount", "The budgeted figure of a row is a button");
  await say("Clicking the amount opens the editor");
  await budget.amount.click();
  const edit = dialog(page, "Editar orçamento");
  const amount = edit.getByLabel("Valor");
  await check("Editar orçamento opens on Valor, ready to type over", async () => {
    await expect(amount).toBeFocused();
    await expect(amount).toHaveValue("300");
  });
  await type(amount, "450");
  await edit.getByRole("button", { name: "Salvar" }).click();
  await check("The row shows the new amount", async () => {
    await expect(toast(page, `Orçamento de ${CATEGORY} alterado a partir de`)).toBeVisible();
    await expect(budget.amount).toHaveText(/R\$\s450$/);
  });

  await scene("The year", "Every budgeted category, month by month");
  await say("Visão switches from the month to the year");
  await view.getByRole("radio", { name: "Anual" }).click();
  const yearRow = page.locator(`div.grid:has(> span > a[title=${JSON.stringify(CATEGORY)}])`);
  await yearRow.scrollIntoViewIfNeeded();
  await check("The year's heatmap has a row for Pets", async () => {
    await expect(page).toHaveURL(/[?&]mode=year/);
    await expect(page.getByText("Ano (proj.)")).toBeVisible();
    await expect(yearRow).toBeInViewport();
  });

  await scene("Delete the budget");
  await say("Back in the month, the editor also deletes");
  await view.getByRole("radio", { name: "Mensal" }).click();
  await budget.amount.click();
  await edit.getByRole("button", { name: "Excluir…" }).click();
  const remove = dialog(page, `Excluir o orçamento de ${CATEGORY}`);
  await remove.getByRole("radio", { name: /^Todos os meses/ }).click();
  await remove.getByRole("button", { name: "Excluir", exact: true }).click();
  await check("The budget is deleted and Pets leaves the table", async () => {
    await expect(toast(page, `Orçamento de ${CATEGORY} excluído`)).toBeVisible();
    await expect(budget.row).toHaveCount(0);
  });
});
