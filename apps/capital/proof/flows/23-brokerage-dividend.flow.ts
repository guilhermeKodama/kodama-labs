import { expect, flow } from "@repo/proof-video";
import { dialog, field, pickFromSelect, readNumber, toast, writeNumber } from "../helpers";

/** A round rendimento, so the cash row (whole reais) moves by exactly this much. */
const GROSS = 250;

flow("A provento is credited to the brokerage's cash balance", async ({ page, scene, say, check, type }) => {
  await page.goto("/investments");
  await page.getByRole("radio", { name: "PF", exact: true }).click();
  await expect(page).toHaveURL(/scope=pf/);
  const cashRow = page.locator('div:has(> span > span:text-is("CAIXA"))');
  await cashRow.scrollIntoViewIfNeeded();
  const before = readNumber(await cashRow.innerText());

  await scene("Provento into the broker's cash", "FII income lands in saldo em conta, on the brokerage the holding belongs to");
  await say("Provento opens with that brokerage already chosen");
  await page.getByRole("button", { name: "+ Operação" }).click();
  const op = dialog(page, "Nova operação");
  await op.getByRole("radio", { name: "Provento" }).click();
  await type(field(op, "Ativo").locator("input"), "HGLG11");
  await op.getByRole("button", { name: /^HGLG11 / }).click();
  const credit = field(op, "Creditar em").getByRole("combobox");

  await check("The provento is credited to XP, the holding's broker", async () => {
    await expect(credit).toHaveText(/Saldo na corretora \(XP\)/);
  });
  await say("Another brokerage of the same entity is a destination too");
  await credit.click();
  await check("Avenue can receive the provento", async () => {
    await expect(page.getByRole("option", { name: /Avenue/ })).toBeVisible();
  });
  await page.keyboard.press("Escape");

  await say(`Rendimento FII of R$ ${writeNumber(GROSS, 2)} stays in XP's cash`);
  await pickFromSelect(field(op, "Tipo").getByRole("combobox"), "Rendimento FII");
  await type(field(op, "Valor bruto").locator("input"), writeNumber(GROSS, 2));
  await op.getByRole("button", { name: "Registrar provento" }).click();
  await check("The provento is registered", async () => {
    await expect(toast(page, "Provento registrado")).toBeVisible();
    await expect(op).toBeHidden();
  });

  await cashRow.scrollIntoViewIfNeeded();
  await check(`Broker cash is R$ ${writeNumber(GROSS, 0)} higher`, async () => {
    await expect(cashRow).toContainText(`R$ ${writeNumber(before + GROSS, 0)}`);
  });

  await say("The holding lists the rendimento");
  await page.getByRole("button", { name: /^HGLG11 / }).click();
  const sheet = dialog(page, /^HGLG11 /);
  await check(`HGLG11 shows the rendimento of R$ ${writeNumber(GROSS, 2)}`, async () => {
    await expect(sheet).toContainText("Rendimento FII");
    await expect(sheet).toContainText(`R$ ${writeNumber(GROSS, 2)}`);
  });
  await sheet.getByRole("button", { name: "Fechar" }).click();

  await scene("The same form in the dark theme");
  await page.goto("/settings");
  const theme = page.getByRole("radiogroup", { name: "Tema" });
  await theme.getByRole("radio", { name: "Escuro" }).click();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await page.goto("/investments");
  await page.getByRole("radio", { name: "PF", exact: true }).click();
  await page.getByRole("button", { name: "+ Operação" }).click();
  const dark = dialog(page, "Nova operação");
  await dark.getByRole("radio", { name: "Provento" }).click();
  await type(field(dark, "Ativo").locator("input"), "HGLG11");
  await dark.getByRole("button", { name: /^HGLG11 / }).click();
  await check("In the dark theme the destination is still XP's cash", async () => {
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await expect(field(dark, "Creditar em").getByRole("combobox")).toHaveText(/Saldo na corretora \(XP\)/);
  });
  await dark.getByRole("button", { name: "Fechar" }).click();

  await page.goto("/settings");
  await page.getByRole("radiogroup", { name: "Tema" }).getByRole("radio", { name: "Claro" }).click();
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
});
