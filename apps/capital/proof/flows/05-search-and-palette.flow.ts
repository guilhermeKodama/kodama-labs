import { expect, flow } from "@repo/proof-video";
import { commandPalette, dialog, ledgerRow, ledgerRows, openTransactions, toast } from "../helpers";

const TYPED = "padaria da prova 18,90 nubank hoje";
// Quick add capitalises each word of the description.
const NAME = "Padaria Da Prova";
const DESCRIPTION = "Ex.: iFood, Invoice #0142, Aluguel";

flow("Command palette and search inside a view", async ({ page, scene, say, check, type }) => {
  await openTransactions(page);
  const entry = ledgerRow(page, NAME);
  const palette = commandPalette(page);

  await scene("Quick add from the palette", "One line of text becomes a filled-in transaction");
  await say("Ctrl/Cmd+K opens the command palette from anywhere");
  await palette.open();
  await type(palette.input, TYPED);
  const quickAdd = palette.group("Quick add").getByRole("option", { name: /Criar “Padaria Da Prova” · R\$\s18,90/ });
  await check("Text with an amount is offered as a quick add", async () => {
    await expect(quickAdd).toBeVisible();
    await expect(quickAdd).toHaveAttribute("aria-selected", "true");
  });

  await say("Enter opens the form with what the palette understood");
  await page.keyboard.press("Enter");
  const form = dialog(page, "Nova transação");
  await check("The form opens with the description and the amount filled in", async () => {
    await expect(form.getByPlaceholder(DESCRIPTION)).toHaveValue(NAME);
    await expect(form.getByPlaceholder("0,00")).toHaveValue("18,90");
  });

  await form.getByRole("button", { name: "Salvar" }).click();
  await check("Saving creates the transaction", async () => {
    await expect(toast(page, `“${NAME}” criada`)).toBeVisible();
    await expect(form).toBeHidden();
    await expect(entry.cell("amount")).toContainText("18,90");
  });

  await scene("Search inside the view", "The search box narrows the table as you type");
  await say("Type part of the description in the view's search box");
  await type(page.getByPlaceholder("Buscar nesta view…"), "padaria da prova");
  await check("The table narrows to the one matching transaction", async () => {
    await expect(page).toHaveURL(/[?&]q=padaria/);
    await expect(ledgerRows(page)).toHaveCount(1);
    await expect(entry.cell("amount")).toContainText("18,90");
  });

  await scene("Find a transaction from the palette", "It searches every transaction from two characters on");
  await say("Open the palette again and type the description");
  await palette.open();
  await type(palette.input, "padaria da prova");
  // A pattern, so the rows that echo the typed text in lower case do not match.
  const found = palette.group("Lançamentos").getByRole("option", { name: /Padaria Da Prova/ });
  await check("The palette lists the transaction under Lançamentos", async () => {
    await expect(found).toHaveCount(1);
    await expect(found).toContainText("18,90");
  });

  await found.click();
  const sheet = dialog(page, "Editar transação");
  await check("The transaction opens in its sheet", async () => {
    await expect(page).toHaveURL(/[?&]entry=/);
    await expect(sheet.getByPlaceholder(DESCRIPTION)).toHaveValue(NAME);
    await expect(sheet.getByPlaceholder("0,00")).toHaveValue("18,90");
  });
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  await scene("Go to another screen", "The palette also runs commands");
  await say("Choose Orçamentos under Ir para");
  await palette.open();
  await palette.group("Ir para").getByRole("option", { name: "Orçamentos", exact: true }).click();
  await check("Choosing Orçamentos opens the budgets screen", async () => {
    await expect(page).toHaveURL(/\/transactions\/budgets/);
    await expect(palette.root).toBeHidden();
    await expect(page.getByRole("button", { name: "+ Orçamento" })).toBeVisible();
  });
});
