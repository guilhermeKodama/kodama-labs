import { expect, flow } from "@repo/proof-video";
import { contributionMonthRow, dialog, field, pickFromSelect, readNumber, toast, writeNumber } from "../helpers";

/**
 * A round buy, so the month's líquido (whole reais) moves by exactly this
 * much. The provento and the buy share one day the seed never uses, so
 * this purchase is the one the new cash pays for.
 */
const AMOUNT = 321;

/** A day in the current month with no seed operation: tomorrow, or the 27th when today is the last day. */
function isolatedDate(): string {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [year, month, day] = today.split("-").map(Number);
  const last = new Date(Date.UTC(year!, month!, 0)).getUTCDate();
  const chosen = day! < last ? day! + 1 : 27;
  return `${year}-${String(month).padStart(2, "0")}-${String(chosen).padStart(2, "0")}`;
}

const monthTotal = (page: import("@playwright/test").Page) =>
  page.locator('div:has(> span:first-child:text-matches("^Aportado em .+ \\\\(líquido\\\\)$")) > span:nth-child(2)');

async function readMonthNet(page: import("@playwright/test").Page, scope: "pf" | "pj" | "all"): Promise<number> {
  await page.goto(`/investments/contributions${scope === "all" ? "" : `?scope=${scope}`}`);
  await expect(page).toHaveURL(scope === "all" ? /\/investments\/contributions(?!.*scope=)/ : new RegExp(`scope=${scope}`));
  await expect(page.getByText(/aportes · .*resgates/)).toBeVisible();
  const total = monthTotal(page);
  await expect(total).toHaveText(/R\$/);
  return readNumber(await total.innerText());
}

flow.setTimeout(180_000);

flow("A buy paid with broker cash counts in líquido; the provento does not", async ({ page, scene, say, check, type }) => {
  const when = isolatedDate();
  const pfBefore = await readMonthNet(page, "pf");
  const allBefore = await readMonthNet(page, "all");
  const pjBefore = await readMonthNet(page, "pj");

  await scene("The provento is not an aporte", "Income credited to the broker's cash leaves líquido where it was");
  await say("Provento of HGLG11, credited to XP's cash");
  await page.goto("/investments?scope=pf");
  await page.getByRole("button", { name: "+ Operação" }).click();
  const income = dialog(page, "Nova operação");
  await income.getByRole("radio", { name: "Provento" }).click();
  await type(field(income, "Ativo").locator("input"), "HGLG11");
  await income.getByRole("button", { name: /^HGLG11 / }).click();
  await check("The provento is credited to XP's cash", async () => {
    await expect(field(income, "Creditar em").getByRole("combobox")).toHaveText(/Saldo na corretora \(XP\)/);
  });
  await say(`Rendimento FII of R$ ${writeNumber(AMOUNT, 2)}, dated apart from the seed`);
  await pickFromSelect(field(income, "Tipo").getByRole("combobox"), "Rendimento FII");
  await type(field(income, "Valor bruto").locator("input"), writeNumber(AMOUNT, 2));
  await field(income, "Data").locator("input").fill(when);
  await income.getByRole("button", { name: "Registrar provento" }).click();
  await check("The provento is registered", async () => {
    await expect(toast(page, "Provento registrado")).toBeVisible();
    await expect(income).toBeHidden();
  });

  await say("PF líquido does not move: the cash is not an aporte yet");
  const pfAfterIncome = await readMonthNet(page, "pf");
  await check("PF líquido is unchanged by the provento", async () => {
    await expect(monthTotal(page)).toHaveText(`R$ ${writeNumber(pfBefore)}`);
    expect(pfAfterIncome).toBe(pfBefore);
  });

  await scene("The purchase is the aporte", "Paying with that cash counts once, in the month of the buy");
  await say("One share of HGLG11, paid from Saldo na corretora");
  await page.goto("/investments?scope=pf");
  await page.getByRole("button", { name: "+ Operação" }).click();
  const buy = dialog(page, "Nova operação");
  await type(field(buy, "Ativo").locator("input"), "HGLG11");
  await buy.getByRole("button", { name: /^HGLG11 / }).click();
  await type(field(buy, "Quantidade").locator("input"), "1");
  await type(field(buy, "Preço").locator("input"), writeNumber(AMOUNT, 2));
  await field(buy, "Data").locator("input").fill(when);
  const source = field(buy, "Dinheiro sai de").getByRole("combobox");
  await pickFromSelect(source, /^Saldo na corretora/);
  await check("The buy is paid with XP's cash, not a transfer", async () => {
    await expect(source).toHaveText(/Saldo na corretora/);
    await expect(buy.getByText("Total da compra").locator("xpath=..")).toContainText(writeNumber(AMOUNT));
  });
  await buy.getByRole("button", { name: "Registrar compra" }).click();
  await check("The purchase is registered", async () => {
    await expect(toast(page, "Compra registrada")).toBeVisible();
    await expect(buy).toBeHidden();
  });

  await say("PF and Consolidado grow by the purchase; PJ does not");
  await page.goto("/investments/contributions?scope=pf");
  await expect(page.getByText(/aportes · .*resgates/)).toBeVisible();
  const pfTotal = monthTotal(page);
  await check(`PF líquido grew by R$ ${writeNumber(AMOUNT)}`, async () => {
    await expect(pfTotal).toHaveText(`R$ ${writeNumber(pfBefore + AMOUNT)}`);
  });

  await page.getByRole("radio", { name: "Consolidado", exact: true }).click();
  await expect(page).toHaveURL(/\/investments\/contributions(?!.*scope=)/);
  const allTotal = monthTotal(page);
  await check(`Consolidado grew by R$ ${writeNumber(AMOUNT)}`, async () => {
    await expect(allTotal).toHaveText(`R$ ${writeNumber(allBefore + AMOUNT)}`);
  });

  await page.getByRole("radio", { name: "PJ", exact: true }).click();
  await expect(page).toHaveURL(/scope=pj/);
  await check("PJ líquido did not change", async () => {
    await expect(monthTotal(page)).toHaveText(`R$ ${writeNumber(pjBefore)}`);
  });

  await scene("Where the number comes from", "The history names the purchase, not the provento");
  await page.getByRole("radio", { name: "PF", exact: true }).click();
  await expect(page).toHaveURL(/scope=pf/);
  const row = await contributionMonthRow(page);
  const origin = row.getByText("Compra HGLG11 · caixa da corretora");
  const note = page.getByText("Uma compra paga com o caixa da corretora entra no líquido.");
  await origin.scrollIntoViewIfNeeded();
  await check("The history names the HGLG11 purchase", async () => {
    await expect(origin).toBeInViewport();
  });
  await note.scrollIntoViewIfNeeded();
  await check("The note says the provento itself does not count", async () => {
    await expect(note).toBeInViewport();
    await expect(page.getByText("Provento HGLG11")).toHaveCount(0);
  });

  await scene("The same page in the dark theme");
  await page.goto("/settings");
  await page.getByRole("radiogroup", { name: "Tema" }).getByRole("radio", { name: "Escuro" }).click();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await page.goto("/investments/contributions?scope=pf");
  await expect(page.getByText(/aportes · .*resgates/)).toBeVisible();
  const darkOrigin = (await contributionMonthRow(page)).getByText("Compra HGLG11 · caixa da corretora");
  await darkOrigin.scrollIntoViewIfNeeded();
  await check("In the dark theme the purchase is still the origin", async () => {
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await expect(darkOrigin).toBeInViewport();
    await expect(monthTotal(page)).toHaveText(`R$ ${writeNumber(pfBefore + AMOUNT)}`);
  });

  await page.goto("/settings");
  await page.getByRole("radiogroup", { name: "Tema" }).getByRole("radio", { name: "Claro" }).click();
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
});
