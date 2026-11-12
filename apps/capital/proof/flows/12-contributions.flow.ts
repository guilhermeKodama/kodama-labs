import { expect, flow } from "@repo/proof-video";
import { dialog, field, ledgerRow, openTransactions, pickFromSelect, readNumber, toast, valueOf, writeNumber } from "../helpers";

const NAME = "Aporte da prova";
const AMOUNT = 1234;

flow("Register a contribution and find it in the list and in Transações", async ({ page, scene, say, check, type }) => {
  await page.goto("/investments/contributions");
  // "Aportado em out/26 (líquido)": the month in the label is today's.
  const monthTotal = page.locator('div:has(> span:first-child:text-matches("^Aportado em .+ \\\\(líquido\\\\)$")) > span:nth-child(2)');
  // The KPIs read R$ 0 until the page has its data; this line comes with it.
  await expect(page.getByText(/aportes · .*resgates/)).toBeVisible();
  const totalBefore = readNumber(await monthTotal.innerText());

  await scene("Register a contribution", "Money leaves a bank account and becomes cash at a broker");
  await say("+ Registrar aporte asks where the money comes from and goes");
  await page.getByRole("button", { name: "+ Registrar aporte" }).click();
  const form = dialog(page, "Registrar aporte");
  await pickFromSelect(field(form, "De (conta)").getByRole("combobox"), "Nubank · PF");
  await pickFromSelect(field(form, "Corretora").getByRole("combobox"), "XP · PF");
  await say("Valor comes filled with the month's goal; the flow types its own");
  await type(field(form, "Valor").locator("input"), writeNumber(AMOUNT, 2));
  await type(field(form, "Descrição (opcional)").locator("input"), NAME);
  await form.getByRole("button", { name: "Salvar" }).click();
  await check("The contribution is registered", async () => {
    await expect(toast(page, /^Aporte registrado/)).toBeVisible();
    await expect(form).toBeHidden();
  });
  await check(`This month's contributions grew by R$ ${writeNumber(AMOUNT)}`, async () => {
    await expect(monthTotal).toHaveText(`R$ ${writeNumber(totalBefore + AMOUNT)}`);
  });

  await scene("Todos os aportes", "Every contribution and withdrawal, one per row");
  await say("The second tab lists them; the search narrows it to this one");
  await page.getByRole("tab", { name: "Todos os aportes" }).click();
  const search = page.getByRole("textbox", { name: "Buscar" });
  await search.click();
  await type(search, NAME);
  const listed = page.getByRole("button").filter({ hasText: NAME });
  await check("The contribution is listed with its route, description and amount", async () => {
    await expect(page).toHaveURL(/tab=all/);
    await expect(listed).toHaveCount(1);
    await expect(listed).toContainText("Nubank → XP");
    await expect(listed).toContainText(`+R$ ${writeNumber(AMOUNT)}`);
    await expect(page.getByText("1 de 1 lançamentos")).toBeVisible();
  });

  await scene("The same money in Transações", "A contribution is a transfer: one row for its two ends");
  await say("Transações, searched by the description typed in the form");
  await openTransactions(page);
  // The click takes the pointer off the KPIs the next check reads.
  const ledgerSearch = page.getByPlaceholder("Buscar nesta view…");
  await ledgerSearch.click();
  await type(ledgerSearch, NAME);
  const transfer = ledgerRow(page, NAME);
  await check("Transações has it under Aportes, not under Saídas", async () => {
    await expect(transfer.row).toContainText("Nubank");
    await expect(transfer.row).toContainText("Investimentos");
    await expect(transfer.row).toContainText(`−R$ ${writeNumber(AMOUNT, 2)}`);
    await expect(valueOf(page, "Linhas")).toHaveText("1");
    await expect(valueOf(page, "Aportes")).toHaveText(`−R$ ${writeNumber(AMOUNT, 2)}`);
    await expect(valueOf(page, "Saídas")).toHaveText("R$ 0,00");
  });

  await say("Its detail has both ends of the transfer");
  await transfer.actions.click();
  await page.getByRole("menuitem", { name: "Abrir detalhe" }).click();
  const detail = dialog(page, "Editar transação");
  // A short claim: a longer banner covers the sheet's title.
  await check("Its detail: a transfer, Nubank to XP", async () => {
    await expect(detail.getByRole("radio", { name: "Aporte", exact: true })).toBeChecked();
    await expect(field(detail, "De (conta)").getByRole("combobox")).toHaveText(/^Nubank · PF/);
    await expect(field(detail, "Para (investimento)").getByRole("combobox")).toHaveText(/^XP · PF/);
    await expect(detail.getByPlaceholder("0,00")).toHaveValue(writeNumber(AMOUNT, 2));
  });
});
