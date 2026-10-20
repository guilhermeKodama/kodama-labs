import { expect, flow } from "@repo/proof-video";
import { dialog, field, ledgerRow, openAllTransactions, openTransactions, pickFromList, settingsGroup, toast } from "../helpers";

const NAME = "Bicicleta da prova";

flow("Buy in installments on a credit card", async ({ page, scene, say, check, type }) => {
  await openTransactions(page);
  const purchase = ledgerRow(page, NAME);
  /** The n/total tag after the description of an installment. */
  const tag = (label: string) => purchase.row.getByText(label, { exact: true });

  await scene("An installment purchase", "One form, one entry per card statement");
  await say("N opens the form; this purchase goes on the Nubank card");
  await page.keyboard.press("n");
  const form = dialog(page, "Nova transação");
  await type(form.getByPlaceholder("0,00"), "300,00");
  await type(form.getByPlaceholder("Ex.: iFood, Invoice #0142, Aluguel"), NAME);
  await pickFromList(field(form, "Conta").getByRole("button"), "Nubank · cartão");
  await pickFromList(field(form, "Categoria").getByRole("button"), "Lazer");
  await say("Parcelado asks for the number of installments");
  await form.getByRole("checkbox", { name: "Parcelado" }).click();
  await type(field(form, "Parcelas").locator("input"), "3");
  await check("Before saving, the form shows the split: 3× de R$ 100,00", async () => {
    await expect(form.getByText("3× de R$ 100,00 · cria 3 lançamentos, um por fatura")).toBeVisible();
  });
  await form.getByRole("button", { name: "Salvar" }).click();
  await check("The first installment is in Transações, tagged 1/3", async () => {
    await expect(toast(page, `“${NAME}” criada`)).toBeVisible();
    await expect(tag("1/3")).toBeVisible();
    await expect(purchase.cell("amount")).toContainText("100,00");
  });

  await scene("The card in Ajustes", "Each card shows the statement that is open");
  await say("Cartões de crédito lists the cards of every entity");
  await page.goto("/settings?page=card");
  await settingsGroup(page, "PF").getByRole("button", { name: "Nubank · cartão" }).click();
  await check("The card shows its open statement and how much of the limit it uses", async () => {
    await expect(page.getByText(/^Fatura atual R\$.+ · fecha em \d{2}\/\d{2}$/)).toBeVisible();
    await expect(page.getByRole("meter")).toBeVisible();
    await expect(page.getByText(/% do limite$/)).toBeVisible();
  });

  await scene("One entry per statement");
  await say("The other installments fall in later months: search every period");
  await openAllTransactions(page, NAME);
  await check("Three entries, tagged 1/3, 2/3 and 3/3", async () => {
    await expect(purchase.row).toHaveCount(3);
    for (const label of ["1/3", "2/3", "3/3"]) await expect(tag(label)).toBeVisible();
  });

  await scene("Delete the purchase", "Deleting one installment asks how far to go");
  await say("Delete the first installment from its row menu");
  const first = purchase.row.filter({ has: page.getByText("1/3", { exact: true }) });
  await first.getByRole("button", { name: "Ações da transação" }).click();
  await page.getByRole("menuitem", { name: "Excluir" }).click();
  const question = dialog(page, `Excluir “${NAME}`);
  await check("The dialog asks: this installment, the future ones or the whole purchase", async () => {
    await expect(question.getByRole("radio", { name: "Só esta parcela (1/3)" })).toBeChecked();
    await expect(question.getByRole("radio", { name: "Esta e as futuras" })).toBeVisible();
    await expect(question.getByRole("radio", { name: "A compra inteira (3 parcelas)" })).toBeVisible();
  });
  await say("Choose the whole purchase");
  await question.getByRole("radio", { name: "A compra inteira (3 parcelas)" }).click();
  await question.getByRole("button", { name: "Excluir" }).click();
  await check("All three installments are gone", async () => {
    await expect(toast(page, "todas excluída(s)")).toBeVisible();
    await expect(page.getByText(/^Nenhum lançamento em todo o período/)).toBeVisible();
    await expect(purchase.row).toHaveCount(0);
  });
});
