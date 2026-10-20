import { expect, flow } from "@repo/proof-video";
import { dialog, field, panel, pickFromSelect, readNumber, toast, valueOf, writeNumber } from "../helpers";

// One of the four holdings the asset picker lists before any search, held at XP by PF.
const TICKER = "BOVA11";
const UNITS = 3;
const PRICE = "130,00";
const TOTAL = "390,00";
/** Points moved from one target to another, so the six still add up to 100. */
const SHIFT = 5;

/** "+2pp" or "−5pp" in an allocation row, as a signed number. */
function gapOf(text: string): number {
  const match = /([+−])(\d+)pp/.exec(text);
  if (!match) throw new Error(`No difference to the target in "${text}"`);
  return (match[1] === "−" ? -1 : 1) * Number(match[2]);
}

const gapLabel = (gap: number) => `${gap < 0 ? "−" : "+"}${Math.abs(gap)}pp`;

flow("Portfolio: a holding, a buy with broker cash and the allocation targets", async ({ page, scene, say, check, type }) => {
  await page.goto("/investments");
  const holding = page.getByRole("button", { name: new RegExp(`^${TICKER} `) });
  const sheet = dialog(page, new RegExp(`^${TICKER} `));
  const quantity = valueOf(sheet, "Quantidade");
  const cashRow = page.locator('div:has(> span > span:text-is("CAIXA"))');

  await scene("A holding in detail", "Carteira lists every position; a row opens its sheet");
  await say("PF narrows the portfolio to the personal entity");
  await page.getByRole("radio", { name: "PF", exact: true }).click();
  // Renda fixa is the first group: LCA is PF's, CDB is Kodama LTDA's.
  await check("PF keeps the personal holdings and leaves the companies' out", async () => {
    await expect(page).toHaveURL(/scope=pf/);
    await expect(page.getByRole("button", { name: /^LCA / })).toBeVisible();
    await expect(page.getByRole("button", { name: /^CDB / })).toHaveCount(0);
  });

  await say(`${TICKER} opens with its numbers and its latest operations`);
  await holding.click();
  // The claims said over the sheet are short: a longer banner covers the sheet's title.
  await check("The sheet has the holding's details", async () => {
    await expect(valueOf(sheet, "Classe")).toHaveText("Ações BR");
    await expect(valueOf(sheet, "Corretora")).toHaveText("XP");
    await expect(valueOf(sheet, "Entidade")).toHaveText("PF");
    await expect(quantity).toHaveText(/^[1-9][\d.]*$/);
    await expect(sheet.getByText(/^Compra · /).first()).toBeVisible();
  });
  const before = readNumber(await quantity.innerText());
  const after = before + UNITS;
  await sheet.getByRole("button", { name: "Fechar" }).click();

  await scene("Buy with the broker's cash", "+ Operação records a trade without leaving Carteira");
  await say("The picker lists the largest holdings: nothing to search");
  await page.getByRole("button", { name: "+ Operação" }).click();
  const op = dialog(page, "Nova operação");
  const submit = op.getByRole("button", { name: "Registrar compra" });
  // The form's accounts arrive a moment after it opens. Picking the asset before them
  // leaves the purchase on another broker, which is reported as a bug of the app.
  await expect(field(op, "Corretora").getByRole("combobox")).not.toHaveText("Nenhuma corretora");
  await op.getByRole("button", { name: new RegExp(`^${TICKER} `) }).click();
  await check("The purchase goes to the holding's broker and waits for a quantity", async () => {
    await expect(field(op, "Corretora").getByRole("combobox")).toHaveText("XP");
    await expect(submit).toBeDisabled();
  });

  await say(`Buy ${UNITS} more at R$ ${PRICE} with the cash already at the broker`);
  await type(field(op, "Quantidade").locator("input"), String(UNITS));
  await type(field(op, "Preço").locator("input"), PRICE);
  const source = field(op, "Dinheiro sai de").getByRole("combobox");
  await pickFromSelect(source, /^Saldo na corretora/);
  const cashBefore = readNumber(await source.innerText());
  await check(`The dialog previews the position going from ${writeNumber(before)} to ${writeNumber(after)}`, async () => {
    await expect(valueOf(op, "Posição")).toHaveText(`${writeNumber(before)} → ${writeNumber(after)}`);
    await expect(valueOf(op, "Total da compra")).toContainText(TOTAL);
    await expect(submit).toBeEnabled();
  });

  await submit.click();
  await check("The purchase is registered and no bank transfer is created", async () => {
    const done = toast(page, "Compra registrada");
    await expect(done).toBeVisible();
    await expect(done).not.toContainText("transferência");
    await expect(op).toBeHidden();
  });
  // The cash row closes the table, below the fold.
  await cashRow.scrollIntoViewIfNeeded();
  await check(`The broker's cash is R$ ${TOTAL} lower`, async () => {
    await expect(cashRow).toContainText(`R$ ${writeNumber(cashBefore - readNumber(TOTAL))}`);
  });

  await say("Back in the sheet, the position carries the purchase");
  await holding.click();
  await check(`The holding has ${writeNumber(after)} units: ${writeNumber(before)} + ${UNITS}`, async () => {
    await expect(quantity).toHaveText(writeNumber(after));
    await expect(sheet).toContainText(new RegExp(`Compra · ${UNITS}\\s*R\\$\\s${TOTAL}`));
  });
  await sheet.getByRole("button", { name: "Fechar" }).click();

  await scene("Allocation targets", "The share each class should have; the six add up to 100%");
  const allocation = panel(page, "Alocação atual vs alvo");
  const bar = (name: string) => allocation.locator(`div:has(> span:text-is("${name}"))`);
  const group = (name: string) => page.locator(`div:has(> span:text-is("${name}"))`).filter({ hasText: "alvo" });
  const targets = dialog(page, "Alocação alvo");
  const fixed = targets.getByRole("textbox", { name: "Renda fixa" });
  const international = targets.getByRole("textbox", { name: "Internacional" });
  const save = targets.getByRole("button", { name: "Salvar" });
  const fixedGap = gapOf(await bar("Renda fixa").innerText());
  const internationalGap = gapOf(await bar("Internacional").innerText());

  await say("Editar alvos opens the six targets");
  await allocation.getByRole("button", { name: "Editar alvos" }).click();
  // The saved targets arrive after the dialog opens.
  await expect(fixed).not.toHaveValue("");
  const fixedWas = readNumber(await fixed.inputValue());
  const internationalWas = readNumber(await international.inputValue());

  await say(`Move ${SHIFT} points from Renda fixa to Internacional`);
  await type(fixed, writeNumber(fixedWas - SHIFT));
  await check(`With one target lowered the sum is ${100 - SHIFT}% and Salvar is off`, async () => {
    await expect(targets.getByText(`Soma ${100 - SHIFT}%`)).toBeVisible();
    await expect(save).toBeDisabled();
  });
  await type(international, writeNumber(internationalWas + SHIFT));
  await check("With the other raised the sum is 100% again and Salvar is on", async () => {
    await expect(targets.getByText("Soma 100%")).toBeVisible();
    await expect(save).toBeEnabled();
  });

  await save.click();
  // The panel shows each class's distance to its target; the table under it names the target of Renda fixa.
  await check(`The panel follows: Renda fixa aims at ${fixedWas - SHIFT}%, Internacional at ${internationalWas + SHIFT}%`, async () => {
    await expect(toast(page, "Alvos salvos")).toBeVisible();
    await expect(bar("Renda fixa")).toContainText(gapLabel(fixedGap + SHIFT));
    await expect(bar("Internacional")).toContainText(gapLabel(internationalGap - SHIFT));
    await expect(group("Renda fixa")).toContainText(`alvo ${fixedWas - SHIFT}%`);
  });

  await scene("Put the two targets back", "Renda fixa and Internacional return to where they were");
  // The first "Alvos salvos" would answer for the second save.
  await expect(toast(page, "Alvos salvos")).toHaveCount(0);
  await allocation.getByRole("button", { name: "Editar alvos" }).click();
  await check(`Reopened, the dialog holds the ${fixedWas - SHIFT}% and ${internationalWas + SHIFT}% that were saved`, async () => {
    await expect(fixed).toHaveValue(writeNumber(fixedWas - SHIFT));
    await expect(international).toHaveValue(writeNumber(internationalWas + SHIFT));
  });
  await type(fixed, writeNumber(fixedWas));
  await type(international, writeNumber(internationalWas));
  await save.click();
  await check(`Renda fixa and Internacional aim at ${fixedWas}% and ${internationalWas}% again`, async () => {
    await expect(toast(page, "Alvos salvos")).toBeVisible();
    await expect(bar("Renda fixa")).toContainText(gapLabel(fixedGap));
    await expect(bar("Internacional")).toContainText(gapLabel(internationalGap));
    await expect(group("Renda fixa")).toContainText(`alvo ${fixedWas}%`);
  });
});
