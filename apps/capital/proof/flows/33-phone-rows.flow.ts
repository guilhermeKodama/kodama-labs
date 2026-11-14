import { type Locator, type Page } from "@playwright/test";
import { expect, flow } from "@repo/proof-video";
import { budgetRow, ledgerRow } from "../helpers";
import { setTheme } from "../package/tour";

/**
 * Phone width where the transactions table used to collapse every column
 * but the date and the amount, and where the year heatmap's category
 * column used to show only "Variável" and a PF badge.
 */
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

flow.use({ viewport: PHONE });

/** Width of the element that is actually painted, after overflow clipping. */
async function paintedWidth(locator: Locator): Promise<number> {
  return locator.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    let left = rect.left;
    let right = rect.right;
    let node = el.parentElement;
    while (node && node !== document.body) {
      const overflow = getComputedStyle(node).overflowX;
      if (overflow === "hidden" || overflow === "clip" || overflow === "auto" || overflow === "scroll") {
        const box = node.getBoundingClientRect();
        left = Math.max(left, box.left);
        right = Math.min(right, box.right);
      }
      node = node.parentElement;
    }
    return Math.max(0, right - left);
  });
}

/** The first visible box. A phone row keeps a desktop twin in the DOM with display:none. */
async function visibleBox(locator: Locator): Promise<{ x: number; y: number; width: number; height: number } | null> {
  const count = await locator.count();
  for (let i = 0; i < count; i++) {
    const box = await locator.nth(i).boundingBox();
    if (box && box.width > 0 && box.height > 0) return box;
  }
  return null;
}

/** True when the middle of the element is that element, not a sibling drawn over it. */
async function hitInside(locator: Locator): Promise<boolean> {
  return locator.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return !!hit && (hit === el || el.contains(hit));
  });
}

function draftParam(draft: unknown): string {
  return Buffer.from(JSON.stringify(draft)).toString("base64url");
}

/** Todas, grouped, searched. The draft is not saved. */
async function openGrouped(page: Page): Promise<void> {
  const draft = draftParam({
    layout: "table",
    period: { preset: "all", offset: 0 },
    groupBy: [{ field: "categoryId" }, { field: "date", bucket: "monthWeek" }],
  });
  await page.goto(`/transactions?draft=${draft}&q=Estapar`);
  await expect(page.locator("[data-ledger-layout=compact] [data-ledger-row]").first()).toBeVisible();
}

async function show(locator: Locator): Promise<void> {
  await locator.evaluate((el) => el.scrollIntoView({ block: "center", inline: "nearest" }));
}

flow("Transactions stay readable on a phone", async ({ page, scene, say, check }) => {
  await scene("A lista no telefone", "Grouped, at 390px");
  await say("Each row leads with the description. Date, account and category sit under it");
  await openGrouped(page);
  const row = ledgerRow(page, "Estapar").row.first();
  const title = row.getByRole("button", { name: "Estapar" });

  await check("Estapar is readable, with its category", async () => {
    await expect(title).toBeInViewport();
    expect(await paintedWidth(title)).toBeGreaterThan(48);
    expect(await hitInside(title)).toBe(true);
    const meta = row.locator("[data-ledger-meta]");
    await expect(meta).toContainText("Transporte");
    await expect(meta).toContainText("PF");
    expect(await paintedWidth(meta)).toBeGreaterThan(80);
    await expect(row.getByRole("checkbox", { name: "Selecionar linha" })).toBeVisible();
    await expect(row.getByRole("button", { name: "Ações da transação" })).toBeVisible();
  });

  await check("Transporte groups the matching rows", async () => {
    const group = page.getByRole("button", { name: /Transporte/ }).first();
    await expect(group).toBeInViewport();
    await expect(group).toContainText("Transporte");
  });

  await say("The footer spells each calculation out");
  const calc = page.locator("[data-ledger-footer]").getByText("Calcular", { exact: true }).first();
  await show(calc);
  await check("Calcular is written in full", async () => {
    await expect(calc).toBeInViewport();
    expect(await paintedWidth(calc)).toBeGreaterThan(40);
    const sum = page.locator("[data-ledger-footer]").getByText("Soma", { exact: true });
    await expect(sum).toBeVisible();
    expect(await paintedWidth(sum)).toBeGreaterThan(24);
  });

  await scene("No desktop a grade continua");
  await say("Widening the window brings the columns back");
  await page.setViewportSize(DESKTOP);
  await page.goto("/transactions");
  await expect(page.locator("[data-ledger-layout=grid] [data-ledger-row]").first()).toBeVisible();

  await check("Desktop lists Descrição, Conta and Categoria", async () => {
    const header = page.locator("[data-ledger-header]");
    await expect(header).toContainText("Descrição");
    await expect(header).toContainText("Conta");
    await expect(header).toContainText("Categoria");
    const wide = page.locator("[data-ledger-row]").first();
    await expect(wide.locator("[data-cell-edit][data-field=description]")).toBeVisible();
    await expect(wide.locator("[data-ledger-meta]")).toHaveCount(0);
  });

  await scene("O mesmo no escuro");
  await setTheme(page, "Escuro");
  await page.setViewportSize(PHONE);
  await say("The phone list, now on the dark paper");
  await openGrouped(page);
  const darkTitle = ledgerRow(page, "Estapar").row.first().getByRole("button", { name: "Estapar" });
  await check("Dark phone: Estapar stays readable", async () => {
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await expect(darkTitle).toBeInViewport();
    expect(await paintedWidth(darkTitle)).toBeGreaterThan(48);
    await expect(ledgerRow(page, "Estapar").row.first().locator("[data-ledger-meta]")).toContainText("Transporte");
  });

  await page.setViewportSize(DESKTOP);
  await page.goto("/transactions");
  await check("Dark desktop: the columns stay", async () => {
    await expect(page.locator("[data-ledger-layout=grid] [data-ledger-header]")).toContainText("Descrição");
    await expect(page.locator("[data-ledger-row]").first().locator("[data-cell-edit][data-field=description]")).toBeVisible();
  });

  await setTheme(page, "Claro");
});

flow("Budget categories stay readable on a phone", async ({ page, scene, say, check }) => {
  const category = () => page.locator("[data-budget-category='Transporte']");
  const name = () => category().getByRole("link", { name: "Transporte", exact: true });
  const kind = () => category().getByText("Variável", { exact: true });

  await scene("Orçamentos anual no telefone", "2026, at 390px");
  await say("The category name stays in a column of its own");
  await page.goto("/transactions/budgets?mode=year");
  await expect(category()).toBeVisible();
  await show(category());

  await check("Transporte sits above Variável and PF", async () => {
    const nameBox = (await name().boundingBox())!;
    const kindBox = (await visibleBox(kind()))!;
    expect(nameBox.width).toBeGreaterThan(60);
    expect(await hitInside(name())).toBe(true);
    expect(kindBox.y).toBeGreaterThan(nameBox.y + nameBox.height - 2);
    await expect(category()).toContainText("PF");
  });

  await check("January sits beside the name", async () => {
    const january = category().locator("xpath=..").locator("[data-budget-month='1']");
    await expect(january).toBeVisible();
    expect(await hitInside(january)).toBe(true);
    const nameBox = (await name().boundingBox())!;
    const monthBox = (await january.boundingBox())!;
    expect(monthBox.x).toBeGreaterThanOrEqual(nameBox.x + nameBox.width - 1);
  });

  await say("Scrolling the months leaves the name where it is");
  const heat = page.locator("[data-budget-heat]");
  await heat.evaluate((el) => {
    el.scrollLeft = 240;
  });
  await check("The name stays put as the months scroll", async () => {
    const heatBox = (await heat.boundingBox())!;
    const nameBox = (await category().boundingBox())!;
    expect(Math.abs(nameBox.x - heatBox.x)).toBeLessThan(8);
    expect(await hitInside(name())).toBe(true);
    expect(await heat.evaluate((el) => el.scrollLeft)).toBeGreaterThan(200);
  });

  await say("Fixo and variável still split the table");
  await heat.evaluate((el) => {
    el.scrollLeft = 0;
  });
  await page.getByRole("radiogroup", { name: "Tipo" }).getByRole("radio", { name: "Variável" }).click();
  await check("Variável keeps Transporte and hides Moradia", async () => {
    await expect(category()).toBeVisible();
    await expect(page.locator("[data-budget-category='Moradia']")).toHaveCount(0);
  });
  await page.getByRole("radiogroup", { name: "Tipo" }).getByRole("radio", { name: "Todos" }).click();
  await expect(page.locator("[data-budget-category='Moradia']")).toBeVisible();

  await scene("Mensal, e o detalhe");
  await say("Mensal gives the category its own line");
  await page.getByRole("radiogroup", { name: "Visão" }).getByRole("radio", { name: "Mensal" }).click();
  const monthName = budgetRow(page, "Transporte").row.getByRole("link", { name: "Transporte", exact: true });
  await show(monthName);
  await check("Mensal puts Transporte above Variável", async () => {
    const nameBox = (await monthName.boundingBox())!;
    const kindBox = (await visibleBox(budgetRow(page, "Transporte").row.getByText("Variável", { exact: true })))!;
    expect(nameBox.width).toBeGreaterThan(80);
    expect(await hitInside(monthName)).toBe(true);
    expect(kindBox.y).toBeGreaterThan(nameBox.y + nameBox.height - 2);
  });

  await say("Opening Transporte lists those transactions, still grouped");
  await monthName.click();
  await expect(page.getByText(/Detalhe: Transporte/)).toBeVisible();
  const url = new URL(page.url());
  const current = JSON.parse(Buffer.from(url.searchParams.get("draft") ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
  current.groupBy = [{ field: "categoryId" }, { field: "date", bucket: "monthWeek" }];
  current.layout = "table";
  url.searchParams.set("draft", draftParam(current));
  await page.goto(`${url.pathname}${url.search}`);
  await expect(page.locator("[data-ledger-layout=compact] [data-ledger-row]").first()).toBeVisible();

  await check("The grouped drill keeps every description", async () => {
    await expect(page.getByText(/Detalhe: Transporte/)).toBeInViewport();
    await expect(page.getByRole("button", { name: /Transporte/ }).first()).toBeVisible();
    const title = page.locator("[data-ledger-row]").first().locator("button:not([aria-label])");
    await expect(title).toBeInViewport();
    expect(((await title.textContent()) ?? "").trim().length).toBeGreaterThan(2);
    expect(await paintedWidth(title)).toBeGreaterThan(48);
    expect(await hitInside(title)).toBe(true);
    await expect(page.locator("[data-ledger-row]").first().locator("[data-ledger-meta]")).toContainText("Transporte");
  });

  await scene("No desktop nada muda");
  await page.setViewportSize(DESKTOP);
  await say("Anual on a wide window keeps the name and the kind on one line");
  await page.goto("/transactions/budgets?mode=year");
  await expect(category()).toBeVisible();
  await show(category());
  await check("Desktop year keeps name and kind together", async () => {
    const nameBox = (await name().boundingBox())!;
    const kindBox = (await visibleBox(kind()))!;
    expect(Math.abs(kindBox.y - nameBox.y)).toBeLessThan(8);
    expect(nameBox.width).toBeGreaterThan(60);
    expect(await hitInside(name())).toBe(true);
    await expect(page.locator("[data-budget-heat]")).toBeVisible();
  });

  await page.getByRole("radiogroup", { name: "Visão" }).getByRole("radio", { name: "Mensal" }).click();
  await show(monthName);
  await check("Desktop month keeps them on one line", async () => {
    const row = budgetRow(page, "Transporte").row;
    const nameBox = (await row.getByRole("link", { name: "Transporte", exact: true }).boundingBox())!;
    const kindBox = (await visibleBox(row.getByText("Variável", { exact: true })))!;
    expect(Math.abs(kindBox.y - nameBox.y)).toBeLessThan(8);
    expect(nameBox.width).toBeGreaterThan(60);
  });

  await scene("Escuro");
  await setTheme(page, "Escuro");
  await page.setViewportSize(PHONE);
  await say("The year table on a phone, in the dark");
  await page.goto("/transactions/budgets?mode=year");
  await expect(category()).toBeVisible();
  await show(category());
  await check("Dark phone: the year name stays", async () => {
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    const nameBox = (await name().boundingBox())!;
    const kindBox = (await visibleBox(kind()))!;
    expect(nameBox.width).toBeGreaterThan(60);
    expect(kindBox.y).toBeGreaterThan(nameBox.y + nameBox.height - 2);
    expect(await hitInside(name())).toBe(true);
  });

  await page.getByRole("radiogroup", { name: "Visão" }).getByRole("radio", { name: "Mensal" }).click();
  await show(monthName);
  await check("Dark phone: Mensal keeps the name", async () => {
    const row = budgetRow(page, "Transporte").row;
    const link = row.getByRole("link", { name: "Transporte", exact: true });
    const nameBox = (await link.boundingBox())!;
    const kindBox = (await visibleBox(row.getByText("Variável", { exact: true })))!;
    expect(nameBox.width).toBeGreaterThan(80);
    expect(kindBox.y).toBeGreaterThan(nameBox.y + nameBox.height - 2);
  });

  await page.setViewportSize(DESKTOP);
  await page.goto("/transactions/budgets?mode=year");
  await show(category());
  await check("Dark desktop: the year table holds", async () => {
    const nameBox = (await name().boundingBox())!;
    const kindBox = (await visibleBox(kind()))!;
    expect(Math.abs(kindBox.y - nameBox.y)).toBeLessThan(8);
  });

  await page.getByRole("radiogroup", { name: "Visão" }).getByRole("radio", { name: "Mensal" }).click();
  await show(monthName);
  await check("Dark desktop: Mensal holds", async () => {
    const row = budgetRow(page, "Transporte").row;
    const nameBox = (await row.getByRole("link", { name: "Transporte", exact: true }).boundingBox())!;
    const kindBox = (await visibleBox(row.getByText("Variável", { exact: true })))!;
    expect(Math.abs(kindBox.y - nameBox.y)).toBeLessThan(8);
  });

  await setTheme(page, "Claro");
});
