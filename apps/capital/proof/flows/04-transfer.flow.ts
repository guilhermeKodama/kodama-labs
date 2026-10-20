import { expect, flow } from "@repo/proof-video";
import { dialog, field, ledgerRow, openTransactions, pickFromSelectAndSettle, toast, transferKind } from "../helpers";

const NAME = "Capital da prova";
const PERSON = "PF · Nubank";
const COMPANY = "Kodama LTDA · Inter PJ";

flow("Transfer from the person to the company", async ({ page, scene, say, check, type }) => {
  await openTransactions(page);
  const transfer = ledgerRow(page, NAME);

  await scene("A transfer between entities", "The form names the kind of transfer from its two ends");
  await say("N opens the form; Transferência turns it into a transfer");
  await page.keyboard.press("n");
  const form = dialog(page, "Nova transação");
  await form.getByRole("radio", { name: "Transferência" }).click();
  const from = field(form, "De").getByRole("combobox");
  const to = field(form, "Para").getByRole("combobox");
  const kind = transferKind(form);

  await say("From the person's Nubank to the company's Inter PJ");
  await pickFromSelectAndSettle(from, PERSON);
  await pickFromSelectAndSettle(to, COMPANY);
  await check("Person to company is detected as a capital contribution", async () => {
    await expect(from).toHaveText(PERSON);
    await expect(to).toHaveText(COMPANY);
    await expect(kind).toHaveText("Aporte de capital");
  });

  await say("Swap the two ends: now the company pays the person");
  await pickFromSelectAndSettle(from, COMPANY);
  await pickFromSelectAndSettle(to, PERSON);
  await check("Company to person is detected as a profit distribution", async () => {
    await expect(from).toHaveText(COMPANY);
    await expect(to).toHaveText(PERSON);
    await expect(kind).toHaveText("Distribuição de lucros");
  });

  await scene("Save it as a capital contribution");
  await say("Back to person → company, with an amount and a description");
  await pickFromSelectAndSettle(from, PERSON);
  await pickFromSelectAndSettle(to, COMPANY);
  const amount = form.getByPlaceholder("0,00");
  await type(amount, "1.500,00");
  await type(form.getByPlaceholder("Ex.: iFood, Invoice #0142, Aluguel"), NAME);
  await expect(amount).toHaveValue("1.500,00");
  await expect(kind).toHaveText("Aporte de capital");
  await form.getByRole("button", { name: "Salvar" }).click();
  await check("The new row shows both entities and both accounts", async () => {
    await expect(toast(page, `“${NAME}” criada`)).toBeVisible();
    await expect(transfer.cell("entityId")).toHaveText("PF → Kodama LTDA");
    await expect(transfer.cell("accountId")).toHaveText("Nubank → Inter PJ");
    await expect(transfer.cell("amount")).toContainText("1.500,00");
  });
});
