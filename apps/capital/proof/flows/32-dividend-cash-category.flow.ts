import { expect, flow } from "@repo/proof-video";
import { dialog, field, ledgerRow, pickFromSelect, toast, writeNumber } from "../helpers";

/**
 * A provento booked on the holding (the cash leg of a dividend operation)
 * is income in Fluxo de Caixa, under Dividendos — the seeded name of the
 * dividends category, since this user has none named Proventos. The date
 * is January 2020 so the period holds only this row. The period and the
 * Sankey travel in a draft URL: Todas keeps its saved layout.
 */
const AMOUNT = 187.63;
const WHEN = "2020-01-15";
const DESCRIPTION = "Rendimento FII HGLG11";

function draftHref(patch: object): string {
  return `/transactions?draft=${Buffer.from(JSON.stringify(patch)).toString("base64url")}`;
}

const period = { from: "2020-01-01", to: "2020-01-31" };

flow("A provento is income under Dividendos in Fluxo de Caixa", async ({ page, scene, say, check, type }) => {
  await scene("Registrar o provento", "FII income on HGLG11, dated January 2020");
  await page.goto("/investments");
  await page.getByRole("radio", { name: "PF", exact: true }).click();
  await expect(page).toHaveURL(/scope=pf/);

  await say("Provento of R$ 187,63 on HGLG11, credited to XP");
  await page.getByRole("button", { name: "+ Operação" }).click();
  const op = dialog(page, "Nova operação");
  await op.getByRole("radio", { name: "Provento" }).click();
  await type(field(op, "Ativo").locator("input"), "HGLG11");
  await op.getByRole("button", { name: /^HGLG11 / }).click();
  await pickFromSelect(field(op, "Tipo").getByRole("combobox"), "Rendimento FII");
  await type(field(op, "Valor bruto").locator("input"), writeNumber(AMOUNT, 2));
  await field(op, "Data").locator("input").fill(WHEN);
  await op.getByRole("button", { name: "Registrar provento" }).click();
  await check("The provento is registered", async () => {
    await expect(toast(page, "Provento registrado")).toBeVisible();
    await expect(op).toBeHidden();
  });

  await scene("Fluxo de Caixa", "The cash leg is an entrada in Dividendos, not Sem categoria");
  await say("January 2020 holds only this provento");
  await page.goto(draftHref({ period, layout: "table" }));
  const row = ledgerRow(page, DESCRIPTION);
  await check("The row is Dividendos and Entradas includes R$ 187,63", async () => {
    await expect(row.row).toBeVisible();
    await expect(row.cell("categoryId")).toHaveText("Dividendos");
    await expect(page.locator("main")).toContainText("Entradas");
    await expect(page.locator("main")).toContainText("R$ 187,63");
  });

  await scene("Sankey", "The same money is a Dividendos inflow");
  await say("The chart is a draft, so Todas stays a table");
  await page.goto(
    draftHref({
      period,
      layout: "chart",
      chart: { type: "sankey", metric: "sum", cumulative: false, top: 0 },
    }),
  );
  await check("The Sankey names Dividendos and not Sem categoria", async () => {
    const label = page.locator("main svg text", { hasText: "Dividendos" });
    await expect(label).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("main svg text", { hasText: "Sem categoria" })).toHaveCount(0);
  });

  await scene("The same screens in the dark theme");
  await page.goto("/settings");
  await page.getByRole("radiogroup", { name: "Tema" }).getByRole("radio", { name: "Escuro" }).click();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);

  await page.goto(draftHref({ period, layout: "table" }));
  await check("In the dark theme the row is still Dividendos and Entradas still includes R$ 187,63", async () => {
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await expect(row.cell("categoryId")).toHaveText("Dividendos");
    await expect(page.locator("main")).toContainText("R$ 187,63");
  });

  await page.goto(
    draftHref({
      period,
      layout: "chart",
      chart: { type: "sankey", metric: "sum", cumulative: false, top: 0 },
    }),
  );
  await check("In the dark theme the Sankey still names Dividendos", async () => {
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    const label = page.locator("main svg text", { hasText: "Dividendos" });
    await expect(label).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("main svg text", { hasText: "Sem categoria" })).toHaveCount(0);
  });

  await page.goto("/settings");
  await page.getByRole("radiogroup", { name: "Tema" }).getByRole("radio", { name: "Claro" }).click();
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
});
