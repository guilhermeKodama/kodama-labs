import { expect, flow } from "@repo/proof-video";
import { contributionMonthRow, dialog, field, pickFromSelect, readNumber, toast, writeNumber } from "../helpers";

/** Phone width the review asked for. Tall enough for the buy form. */
flow.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
flow.setTimeout(180_000);

/** A different amount from the desktop flow, so the two can run in either order. */
const AMOUNT = 287;

function isolatedDate(): string {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [year, month, day] = today.split("-").map(Number);
  const last = new Date(Date.UTC(year!, month!, 0)).getUTCDate();
  // Two days ahead when the month allows, so this buy does not share the desktop flow's day.
  const ahead = day! + 2;
  const chosen = ahead <= last ? ahead : 26;
  return `${year}-${String(month).padStart(2, "0")}-${String(chosen).padStart(2, "0")}`;
}

flow("On a phone, a buy paid with broker cash shows in the aportes history", async ({ page, scene, say, check, type }) => {
  const when = isolatedDate();
  await page.goto("/investments/contributions?scope=pf");
  const monthTotal = page.locator('div:has(> span:first-child:text-matches("^Aportado em .+ \\\\(líquido\\\\)$")) > span:nth-child(2)');
  await expect(page.getByText(/aportes · .*resgates/)).toBeVisible();
  await expect(monthTotal).toHaveText(/R\$/);
  const before = readNumber(await monthTotal.innerText());

  await scene("Provento, then the buy", "At 390px the purchase is what enters líquido");
  await say("The provento lands in XP's cash and is not an aporte");
  await page.goto("/investments?scope=pf");
  await page.getByRole("button", { name: "Operação" }).click();
  const income = dialog(page, "Nova operação");
  await income.getByRole("radio", { name: "Provento" }).click();
  await type(field(income, "Ativo").locator("input"), "HGLG11");
  await income.getByRole("button", { name: /^HGLG11 / }).click();
  await pickFromSelect(field(income, "Tipo").getByRole("combobox"), "Rendimento FII");
  await type(field(income, "Valor bruto").locator("input"), writeNumber(AMOUNT, 2));
  await field(income, "Data").locator("input").fill(when);
  const registerIncome = income.getByRole("button", { name: "Registrar provento" });
  await registerIncome.scrollIntoViewIfNeeded();
  await registerIncome.click();
  await check("The provento is registered", async () => {
    await expect(toast(page, "Provento registrado")).toBeVisible();
    await expect(income).toBeHidden();
  });

  await page.goto("/investments/contributions?scope=pf");
  await expect(page.getByText(/aportes · .*resgates/)).toBeVisible();
  await check("The phone líquido ignores the provento", async () => {
    await expect(monthTotal).toHaveText(`R$ ${writeNumber(before)}`);
  });

  await say("The buy is paid with Saldo na corretora");
  await page.goto("/investments?scope=pf");
  await page.getByRole("button", { name: "Operação" }).click();
  const buy = dialog(page, "Nova operação");
  await type(field(buy, "Ativo").locator("input"), "HGLG11");
  await buy.getByRole("button", { name: /^HGLG11 / }).click();
  await type(field(buy, "Quantidade").locator("input"), "1");
  await type(field(buy, "Preço").locator("input"), writeNumber(AMOUNT, 2));
  await field(buy, "Data").locator("input").fill(when);
  const source = field(buy, "Dinheiro sai de").getByRole("combobox");
  await source.scrollIntoViewIfNeeded();
  await pickFromSelect(source, /^Saldo na corretora/);
  const registerBuy = buy.getByRole("button", { name: "Registrar compra" });
  await registerBuy.scrollIntoViewIfNeeded();
  await registerBuy.click();
  await check("The purchase is registered", async () => {
    await expect(toast(page, "Compra registrada")).toBeVisible();
    await expect(buy).toBeHidden();
  });

  await scene("The history at 390px", "The origin wraps onto its own line");
  await page.goto("/investments/contributions?scope=pf");
  await expect(page.getByText(/aportes · .*resgates/)).toBeVisible();
  await check(`Líquido grew by R$ ${writeNumber(AMOUNT)}`, async () => {
    await expect(monthTotal).toHaveText(`R$ ${writeNumber(before + AMOUNT)}`);
  });
  const origin = (await contributionMonthRow(page)).getByText("Compra HGLG11 · caixa da corretora");
  const note = page.getByText("Uma compra paga com o caixa da corretora entra no líquido.");
  await origin.scrollIntoViewIfNeeded();
  await check("The purchase origin is readable at 390px", async () => {
    await expect(origin).toBeInViewport();
  });
  await note.scrollIntoViewIfNeeded();
  await check("The note is readable at 390px", async () => {
    await expect(note).toBeInViewport();
  });

  await scene("The same screen in the dark theme");
  await page.goto("/settings");
  await page.getByRole("radiogroup", { name: "Tema" }).getByRole("radio", { name: "Escuro" }).click();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await page.goto("/investments/contributions?scope=pf");
  await expect(page.getByText(/aportes · .*resgates/)).toBeVisible();
  const darkOrigin = (await contributionMonthRow(page)).getByText("Compra HGLG11 · caixa da corretora");
  await darkOrigin.scrollIntoViewIfNeeded();
  await check("In the dark theme the origin is still readable", async () => {
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await expect(darkOrigin).toBeInViewport();
    await expect(monthTotal).toHaveText(`R$ ${writeNumber(before + AMOUNT)}`);
  });

  await page.goto("/settings");
  await page.getByRole("radiogroup", { name: "Tema" }).getByRole("radio", { name: "Claro" }).click();
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
});
