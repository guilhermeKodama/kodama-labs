import { expect, flow } from "@repo/proof-video";
import { dialog, field, ledgerRow, openTransactions, pickFromList, toast } from "../helpers";

const NAME = "Café da prova";

flow("Create, edit, delete and restore an expense", async ({ page, scene, say, check, type }) => {
  await openTransactions(page);
  const expense = ledgerRow(page, NAME);

  await scene("Create an expense", "From the keyboard, in one dialog");
  await say("N opens the new transaction form from anywhere");
  await page.keyboard.press("n");
  const form = dialog(page, "Nova transação");
  await type(form.getByPlaceholder("0,00"), "42,50");
  await type(form.getByPlaceholder("Ex.: iFood, Invoice #0142, Aluguel"), NAME);
  await pickFromList(field(form, "Categoria").getByRole("button"), "Restaurantes");
  await form.getByRole("button", { name: "Salvar" }).click();
  await check("The expense is saved and shows up in the table", async () => {
    await expect(toast(page, `“${NAME}” criada`)).toBeVisible();
    await expect(expense.cell("amount")).toContainText("42,50");
    await expect(expense.cell("categoryId")).toHaveText("Restaurantes");
  });

  await scene("Edit in the row", "Click a cell, type, press Enter");
  await say("Change the amount without opening the form");
  await expense.cell("amount").click();
  await type(expense.cell("amount").locator("input"), "55,00");
  await page.keyboard.press("Enter");
  // Enter saves and moves the editor to the row below; Escape leaves it.
  await page.keyboard.press("Escape");
  await check("The new amount is saved", async () => {
    await expect(toast(page, `Valor de “${NAME}”`)).toBeVisible();
    await expect(expense.cell("amount")).toContainText("55,00");
  });

  await scene("Delete and undo");
  await say("Delete the expense from its row menu");
  await expense.actions.click();
  await page.getByRole("menuitem", { name: "Excluir" }).click();
  await check("The expense leaves the table and goes to the trash", async () => {
    await expect(expense.row).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Lixeira/ })).toBeVisible();
  });

  await say("Ctrl/Cmd+Z brings it back");
  await page.keyboard.press("ControlOrMeta+z");
  await check("Undo restores the expense with the edited amount", async () => {
    await expect(expense.cell("amount")).toContainText("55,00");
  });
});
