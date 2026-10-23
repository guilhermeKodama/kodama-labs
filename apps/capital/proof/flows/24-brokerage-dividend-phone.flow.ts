import { expect, flow } from "@repo/proof-video";
import { dialog, field, pickFromSelect, readNumber, toast, writeNumber } from "../helpers";

/** Phone width the review asked for. Tall enough for the provento form. */
flow.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

const GROSS = 180;

flow("On a phone, a provento is credited to the brokerage's cash", async ({ page, scene, say, check, type }) => {
  await page.goto("/investments");
  await page.getByRole("radio", { name: "PF", exact: true }).click();
  await expect(page).toHaveURL(/scope=pf/);
  const cashRow = page.locator('div:has(> span > span:text-is("CAIXA"))');
  await cashRow.scrollIntoViewIfNeeded();
  const before = readNumber(await cashRow.innerText());

  await scene("Provento on a phone", "The same credit, at 390px");
  await say("The destination is the holding's broker");
  await page.getByRole("button", { name: "Operação" }).click();
  const op = dialog(page, "Nova operação");
  await op.getByRole("radio", { name: "Provento" }).click();
  await type(field(op, "Ativo").locator("input"), "KNRI11");
  await op.getByRole("button", { name: /^KNRI11 / }).click();
  const credit = field(op, "Creditar em").getByRole("combobox");
  await credit.scrollIntoViewIfNeeded();
  await check("The phone form credits KNRI11 to XP's cash", async () => {
    await expect(credit).toHaveText(/Saldo na corretora \(XP\)/);
  });

  await say(`Rendimento FII of R$ ${writeNumber(GROSS, 2)}`);
  await pickFromSelect(field(op, "Tipo").getByRole("combobox"), "Rendimento FII");
  await type(field(op, "Valor bruto").locator("input"), writeNumber(GROSS, 2));
  const submit = op.getByRole("button", { name: "Registrar provento" });
  await submit.scrollIntoViewIfNeeded();
  await submit.click();
  await check("The provento is registered", async () => {
    await expect(toast(page, "Provento registrado")).toBeVisible();
    await expect(op).toBeHidden();
  });

  await cashRow.scrollIntoViewIfNeeded();
  await check(`Broker cash is R$ ${writeNumber(GROSS, 0)} higher`, async () => {
    await expect(cashRow).toContainText(`R$ ${writeNumber(before + GROSS, 0)}`);
  });

  await scene("The same form in the dark theme");
  await page.goto("/settings");
  await page.getByRole("radiogroup", { name: "Tema" }).getByRole("radio", { name: "Escuro" }).click();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await page.goto("/investments");
  await page.getByRole("radio", { name: "PF", exact: true }).click();
  await page.getByRole("button", { name: "Operação" }).click();
  const dark = dialog(page, "Nova operação");
  await dark.getByRole("radio", { name: "Provento" }).click();
  await type(field(dark, "Ativo").locator("input"), "KNRI11");
  await dark.getByRole("button", { name: /^KNRI11 / }).click();
  const darkCredit = field(dark, "Creditar em").getByRole("combobox");
  await darkCredit.scrollIntoViewIfNeeded();
  await check("In the dark theme the phone form still credits XP's cash", async () => {
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await expect(darkCredit).toHaveText(/Saldo na corretora \(XP\)/);
  });
  await dark.getByRole("button", { name: "Fechar" }).click();
  await page.goto("/settings");
  await page.getByRole("radiogroup", { name: "Tema" }).getByRole("radio", { name: "Claro" }).click();
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
});
