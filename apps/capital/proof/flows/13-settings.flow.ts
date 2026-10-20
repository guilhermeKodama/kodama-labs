import { expect, flow } from "@repo/proof-video";
import { createInList, pickFromSelect, settingsGroup, settingsNav, toast } from "../helpers";

const CATEGORY = "Academia da prova";
const ACCOUNT = "Conta da prova";
const BANK = "Banco da prova";

flow("Ajustes: theme, a new category and a new bank account", async ({ page, scene, say, check, type }) => {
  await page.goto("/settings");
  const html = page.locator("html");
  const theme = page.getByRole("radiogroup", { name: "Tema" });

  await scene("Theme", "Preferences save as they change, with no Salvar button");
  await say("Escuro turns the whole app dark");
  await theme.getByRole("radio", { name: "Escuro" }).click();
  await check("The dark theme is on", async () => {
    await expect(html).toHaveClass(/\bdark\b/);
    await expect(theme.getByRole("radio", { name: "Escuro" })).toBeChecked();
  });
  await say("Reload the page: the choice was saved");
  await page.reload();
  await check("The dark theme is still on after a reload", async () => {
    await expect(theme.getByRole("radio", { name: "Escuro" })).toBeChecked();
    await expect(html).toHaveClass(/\bdark\b/);
  });
  await say("Back to Claro, the theme the other flows expect");
  await theme.getByRole("radio", { name: "Claro" }).click();
  await check("Claro takes the dark theme off", async () => {
    await expect(html).not.toHaveClass(/\bdark\b/);
    await expect(theme.getByRole("radio", { name: "Claro" })).toBeChecked();
  });

  await scene("A new category");
  await say("A new category starts as an expense");
  await settingsNav(page, "Categorias").click();
  await page.getByRole("button", { name: "+ Nova categoria" }).click();
  await type(page.getByPlaceholder("Nome da categoria"), CATEGORY);
  await page.keyboard.press("Enter");
  const category = settingsGroup(page, "Despesas").getByRole("button", { name: CATEGORY });
  await check("The category is created and listed under Despesas", async () => {
    await expect(toast(page, `“${CATEGORY}” criada`)).toBeVisible();
    // The list stays scrolled at "+ Nova categoria"; the new row is at the top.
    await category.scrollIntoViewIfNeeded();
    await expect(category).toBeVisible();
  });

  await scene("A new bank account");
  await say("Contas bancárias groups the accounts by entity");
  await settingsNav(page, "Contas bancárias").click();
  await page.getByRole("button", { name: "+ Nova conta" }).click();
  await type(page.locator("#acc-name"), ACCOUNT);
  await say("Banco also takes a bank the list does not have yet");
  await createInList(page.getByRole("button", { name: "Banco", exact: true }), BANK);
  await pickFromSelect(page.getByRole("combobox", { name: "Entidade" }), "Kodama LTDA");
  await page.getByRole("button", { name: "Salvar" }).click();
  const account = settingsGroup(page, "Kodama LTDA").getByRole("button", { name: ACCOUNT });
  await check("The account is created and listed under Kodama LTDA", async () => {
    await expect(toast(page, `“${ACCOUNT}” criada`)).toBeVisible();
    await expect(account).toBeVisible();
    await expect(page.getByRole("button", { name: "Banco", exact: true })).toHaveText(BANK);
  });

  await scene("Tidy up", "Archived items leave the pickers; their history stays");
  await say("Archive both, so they stay out of the pickers the other flows use");
  await page.getByRole("button", { name: "Arquivar conta" }).click();
  await check("The account is archived", async () => {
    await expect(toast(page, `“${ACCOUNT}” arquivada`)).toBeVisible();
    await expect(account).toContainText("arquivada");
  });
  await settingsNav(page, "Categorias").click();
  await category.click();
  await page.getByRole("button", { name: "Arquivar", exact: true }).click();
  await check("The category is archived", async () => {
    await expect(toast(page, `“${CATEGORY}” arquivada`)).toBeVisible();
    // Archived categories go to the end of their group.
    await category.scrollIntoViewIfNeeded();
    await expect(category).toContainText("arquivada");
  });
});
