import { expect, flow } from "@repo/proof-video";
import { BANK_OFX } from "../../src/server/modules/bank-statements/services/__tests__/fixtures/import-files";
import { dialog, ledgerRow, openAllTransactions, openTransactions, toast } from "../helpers";

// The statement is the bank OFX of the import tests: six rows of one Nubank account.
const FILE = "extrato-da-prova.ofx";
const IMPORTED = "PAG*PETZ";
const LEFT_OUT = "Pagamento de fatura";

flow("Import a bank statement and undo it", async ({ page, scene, say, check }) => {
  await openTransactions(page);

  await scene("Read the statement", "The file becomes a plan; nothing is written yet");
  await say("Importar extrato opens from the header of Transações");
  await page.getByRole("button", { name: "Importar extrato" }).click();
  const wizard = dialog(page, "Importar extrato");
  await say("Hand it the OFX file the bank exports");
  await wizard.locator('input[type="file"]').setInputFiles({ name: FILE, mimeType: "application/x-ofx", buffer: Buffer.from(BANK_OFX) });
  await check("The file is read and its account is found: Nubank", async () => {
    await expect(wizard.getByText(FILE)).toBeVisible();
    await expect(wizard.getByText("Extrato bancário")).toBeVisible();
    await expect(wizard.getByRole("button", { name: "Importar na conta" })).toHaveText("Nubank");
    await expect(wizard.getByRole("button", { name: "Continuar" })).toBeEnabled();
  });

  await scene("Review the rows", "Each row can be left out before anything is imported");
  await wizard.getByRole("button", { name: "Continuar" }).click();
  await check("The review lists the rows of the statement", async () => {
    for (const description of ["UBER *TRIP", IMPORTED, "PADARIA", LEFT_OUT]) {
      await expect(wizard.getByText(description, { exact: true })).toBeVisible();
    }
  });
  await say("Leave the card bill payment out of this import");
  await wizard.getByRole("checkbox", { name: `Importar ${LEFT_OUT}`, exact: true }).click();

  await scene("Import", "One import, with a view of its own");
  await wizard.getByRole("button", { name: "Continuar" }).click();
  await say("Confirmar sums up what will be written; its button commits it");
  await wizard.getByRole("button", { name: /^Importar \d+ lançamentos$/ }).click();
  await check("The import is done: it names the account and offers a view and an undo", async () => {
    await expect(wizard.getByRole("status")).toContainText("importados em Nubank");
    await expect(wizard.getByRole("button", { name: "Abrir a view da importação" })).toBeVisible();
    await expect(wizard.getByRole("button", { name: "Desfazer importação" })).toBeVisible();
  });
  await say("Open the view the import created");
  await wizard.getByRole("button", { name: "Abrir a view da importação" }).click();
  await check("The imported rows are in Transações; the one left out is not", async () => {
    await expect(ledgerRow(page, IMPORTED).row).toBeVisible();
    await expect(ledgerRow(page, "UBER *TRIP").row).toBeVisible();
    await expect(ledgerRow(page, LEFT_OUT).row).toHaveCount(0);
  });

  await scene("Undo the import", "Ajustes keeps every import and can undo each one");
  await say("The history of imports is in Ajustes");
  await page.goto("/settings?page=imports");
  const entry = page.getByRole("row", { name: FILE });
  await entry.getByRole("button", { name: "Desfazer" }).click();
  await check("The import is undone and the history says so", async () => {
    await expect(toast(page, "Importação desfeita")).toBeVisible();
    await expect(entry.getByRole("cell", { name: "Desfeita" })).toBeVisible();
  });
  await say("Back in Transações, search every period for the imported row");
  await openAllTransactions(page, "PETZ");
  await check("The imported row is gone from Transações", async () => {
    await expect(page.getByText(/^Nenhum lançamento em todo o período/)).toBeVisible();
    await expect(ledgerRow(page, IMPORTED).row).toHaveCount(0);
  });
});
