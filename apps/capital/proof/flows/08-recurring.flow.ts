import { expect, flow } from "@repo/proof-video";
import { dialog, field, fixedBills, ledgerRow, ledgerRows, openTransactions, pickFromList, pickFromSelect, toast } from "../helpers";

const NAME = "Internet da prova";

flow("Create a recurring bill, book it, skip it and delete it", async ({ page, scene, say, check, type }) => {
  await openTransactions(page);
  const search = page.getByPlaceholder("Buscar nesta view…");
  const entry = ledgerRow(page, NAME);
  const bills = fixedBills(page);
  const listed = bills.listed(NAME);
  const dueDate = bills.dueDate(NAME);
  const editor = dialog(page, NAME);

  await scene("A recurring bill", "Made in Nova transação, as a reminder");
  await say("N opens the form; Recorrente turns the expense into a rule");
  await page.keyboard.press("n");
  const form = dialog(page, "Nova transação");
  await type(form.getByPlaceholder("0,00"), "129,90");
  await type(form.getByPlaceholder("Ex.: iFood, Invoice #0142, Aluguel"), NAME);
  await pickFromList(field(form, "Categoria").getByRole("button"), "Contas de consumo");
  await form.getByRole("checkbox", { name: "Recorrente" }).click();
  // The dates below are compared as "day/month", which only tells monthly occurrences apart.
  await expect(field(form, "Frequência").getByRole("combobox")).toHaveText("Mensal");
  // "Lançar automaticamente", the default, books the first occurrence as the rule is saved.
  await say("Só lembrar: the rule reminds on the due day and books nothing by itself");
  await pickFromSelect(field(form, "Modo").getByRole("combobox"), "Só lembrar (push no dia)");
  await form.getByRole("button", { name: "Salvar" }).click();
  await check("Saving creates the rule", async () => {
    await expect(toast(page, `Recorrência “${NAME}” criada`)).toBeVisible();
    await expect(form).toBeHidden();
  });

  await say("A search for the bill: what has the rule booked so far?");
  await type(search, NAME);
  await check("As a reminder, the rule has booked no entry", async () => {
    await expect(page.getByText(/^Nenhum lançamento em .+ com esses filtros\.$/)).toBeVisible();
    await expect(ledgerRows(page)).toHaveCount(0);
  });

  await scene("Contas fixas", "Orçamentos lists the bills that are due");
  await page.getByRole("link", { name: "Orçamentos" }).click();
  const upcoming = bills.upcoming(NAME);
  await upcoming.scrollIntoViewIfNeeded();
  await check("The rule is in Contas fixas, as a reminder", async () => {
    await expect(upcoming).toBeInViewport();
    await expect(upcoming).toContainText("lembrete");
  });

  await say("Ver todas lists every rule; Lançar agora books the one that is due");
  await bills.seeAll.click();
  const due = await dueDate.innerText();
  await listed.click();
  await editor.getByRole("button", { name: "Lançar agora" }).click();
  await check("Booked: the rule moves to its next date", async () => {
    await expect(toast(page, `“${NAME}” lançada em ${due}`)).toBeVisible();
    await expect(dueDate).not.toHaveText(due);
  });

  await say("Pular lets the next occurrence go without booking it");
  const next = await dueDate.innerText();
  await listed.click();
  await editor.getByRole("button", { name: "Pular" }).click();
  await check("Skipped: the next date moves again", async () => {
    await expect(toast(page, `“${NAME}” de ${next} pulada`)).toBeVisible();
    await expect(dueDate).not.toHaveText(next);
    await expect(dueDate).not.toHaveText(due);
  });

  await say("Excluir removes the rule; what it has booked stays");
  await listed.click();
  await editor.getByRole("button", { name: "Excluir" }).click();
  await check("The rule is gone from Contas fixas", async () => {
    await expect(toast(page, `“${NAME}” excluída`)).toBeVisible();
    await expect(bills.group("Ativas")).toBeVisible();
    await expect(listed).toHaveCount(0);
  });

  await scene("Back in Transações", "The same search as before");
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Todas", exact: true }).click();
  await type(search, NAME);
  await check("One entry: the bill booked by Lançar agora", async () => {
    await expect(ledgerRows(page)).toHaveCount(1);
    await expect(entry.cell("date")).toHaveText(due);
    await expect(entry.cell("amount")).toContainText("129,90");
    await expect(entry.cell("categoryId")).toHaveText("Contas de consumo");
  });
});
