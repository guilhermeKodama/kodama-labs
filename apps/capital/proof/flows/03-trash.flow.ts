import { expect, flow } from "@repo/proof-video";
import { dialog, field, ledgerRow, openTransactions, pickFromList, toast, trashRow } from "../helpers";

const NAME = "Ração da prova";

flow("Delete an expense and restore it from the trash", async ({ page, scene, say, check, type }) => {
  await openTransactions(page);
  const expense = ledgerRow(page, NAME);
  const trash = dialog(page, "Lixeira");
  const deleted = trashRow(page, NAME);

  await scene("Create an expense", "The flow only deletes what it made itself");
  await say("N opens the new transaction form");
  await page.keyboard.press("n");
  const form = dialog(page, "Nova transação");
  await type(form.getByPlaceholder("0,00"), "37,80");
  await type(form.getByPlaceholder("Ex.: iFood, Invoice #0142, Aluguel"), NAME);
  await pickFromList(field(form, "Categoria").getByRole("button"), "Pets");
  await form.getByRole("button", { name: "Salvar" }).click();
  await check("The expense is saved and shows up in the table", async () => {
    await expect(toast(page, `“${NAME}” criada`)).toBeVisible();
    await expect(expense.cell("amount")).toContainText("37,80");
  });

  await scene("Delete it", "Deleted transactions wait 30 days in the trash");
  await say("Delete the expense from its row menu");
  await expense.actions.click();
  await page.getByRole("menuitem", { name: "Excluir" }).click();
  await check("The row leaves the table", async () => {
    await expect(toast(page, `“${NAME}” excluída`)).toBeVisible();
    await expect(expense.row).toHaveCount(0);
  });

  await say("The header now has a trash button with a count");
  await page.getByRole("button", { name: /^Lixeira · \d+$/ }).click();
  await check("The trash lists the deleted expense", async () => {
    await expect(trash).toBeVisible();
    await expect(deleted.row).toContainText(NAME);
    await expect(deleted.row).toContainText("37,80");
  });

  await scene("Restore it", "Each row in the trash has its own Restaurar button");
  await say("Restore the expense");
  await deleted.restore.click();
  await check("The expense leaves the trash", async () => {
    await expect(toast(page, `“${NAME}” restaurada`)).toBeVisible();
    await expect(deleted.row).toHaveCount(0);
  });

  await say("Close the trash to see the table again");
  await page.keyboard.press("Escape");
  await check("The expense is back in the table, as it was", async () => {
    await expect(trash).toBeHidden();
    await expect(expense.cell("amount")).toContainText("37,80");
    await expect(expense.cell("categoryId")).toHaveText("Pets");
  });
});
