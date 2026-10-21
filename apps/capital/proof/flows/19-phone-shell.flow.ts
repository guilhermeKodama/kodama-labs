import { expect, flow } from "@repo/proof-video";
import { dialog, field, ledgerRow, openTransactions, toast, trashRow } from "../helpers";

// An iPhone 17 Pro: 402 × 874 pt, a touch screen (so `pointer: coarse` matches).
const WIDTH = 402;
const HEIGHT = 874;
flow.use({ viewport: { width: WIDTH, height: HEIGHT }, hasTouch: true, isMobile: true });

// What iOS reports in the installed app (the status bar with the Dynamic Island,
// the home indicator). Chromium reports no safe areas, so the flow sets the same
// values the app reads (globals.css, --safe-*) and draws the status bar it stands for.
const IPHONE_STATUS_BAR = 62;
const IPHONE_HOME_INDICATOR = 34;
const SIMULATED_IPHONE = `
  html:root { --safe-top: ${IPHONE_STATUS_BAR}px; --safe-bottom: ${IPHONE_HOME_INDICATOR}px; }
  #proof-status-bar {
    position: fixed; top: 0; left: 0; right: 0; height: ${IPHONE_STATUS_BAR}px; z-index: 2147483000;
    display: flex; align-items: center; justify-content: center; pointer-events: none;
    background: rgb(0 0 0 / 0.55); color: white; font: 600 12px system-ui;
  }`;

// A demo expense of this month; the flow restores it at the end.
const NAME = "Estapar";

flow("The app on a phone: one bar on top, the main action as a floating button, touch-sized controls", async ({ page, scene, say, check }) => {
  await openTransactions(page);
  const header = page.getByRole("main").locator("header").first();
  const more = header.getByRole("button", { name: "Mais ações" });
  const fab = page.locator("[data-fab]");

  await scene("No app instalado num iPhone", "The iPhone's status bar (62 pt) and home indicator, simulated");
  await page.addStyleTag({ content: SIMULATED_IPHONE });
  await page.evaluate(() => {
    const bar = document.createElement("div");
    bar.id = "proof-status-bar";
    bar.textContent = "barra de status do iPhone (simulada)";
    document.body.appendChild(bar);
  });
  await check("Top bar is below the status bar", async () => {
    expect((await header.boundingBox())!.y).toBeGreaterThanOrEqual(IPHONE_STATUS_BAR);
  });
  await check("One row: ▤, the title and ⋯", async () => {
    await expect(header.getByText("Todas", { exact: true })).toBeInViewport({ ratio: 1 });
    await expect(more).toBeInViewport({ ratio: 1 });
    await expect(header.getByRole("button", { name: "Importar extrato" })).toBeHidden();
    expect((await header.boundingBox())!.height).toBeLessThanOrEqual(64);
  });
  await check("▤ and ⋯ are finger-sized", async () => {
    for (const button of [header.getByRole("button", { name: "Abrir o menu" }), more]) {
      const box = (await button.boundingBox())!;
      expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
    }
  });

  await scene("O botão flutuante", "The screen's main action, bottom right, clear of the home indicator");
  await check("+ Nova transação floats bottom right", async () => {
    await expect(fab).toHaveText("Nova transação");
    const box = (await fab.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(56);
    expect(WIDTH - (box.x + box.width)).toBeGreaterThanOrEqual(16);
    expect(HEIGHT - IPHONE_HOME_INDICATOR - (box.y + box.height)).toBeGreaterThanOrEqual(16);
  });
  await say("Scrolling the list shrinks it to the +, and it grows back");
  // A slow scroll of 2.5 s, like a thumb reading down the list, so the video catches the button shrunk.
  await page.getByRole("main").locator("div.overflow-auto").first().evaluate((el) => {
    const timer = setInterval(() => el.scrollBy(0, 12), 50);
    setTimeout(() => clearInterval(timer), 2500);
  });
  await check("It shrinks to the + while the list scrolls", async () => {
    await expect.poll(async () => (await fab.boundingBox())!.width).toBeLessThanOrEqual(60);
  });
  await check("It grows back when the scroll stops", async () => {
    await expect.poll(async () => (await fab.boundingBox())!.width).toBeGreaterThan(120);
    await expect(fab).toHaveText("Nova transação");
  });

  await say("Delete an expense: the undo toast sits above the button");
  await ledgerRow(page, NAME).actions.first().click();
  await page.getByRole("menuitem", { name: "Excluir" }).click();
  const deleted = toast(page, `“${NAME}” excluída`);
  await check("The toast stays above the button", async () => {
    await expect(deleted).toBeVisible();
    // Polled: the toast slides in from below.
    const fabTop = (await fab.boundingBox())!.y;
    await expect.poll(async () => {
      const box = (await deleted.boundingBox())!;
      return box.y + box.height;
    }).toBeLessThanOrEqual(fabTop);
  });

  await say("⋯ holds the other actions: Lixeira and Importar extrato");
  await more.tap();
  await check("⋯ lists Lixeira · 1 and Importar extrato", async () => {
    await expect(page.getByRole("menuitem", { name: /^Lixeira · \d+$/ })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Importar extrato" })).toBeVisible();
  });
  await page.keyboard.press("Escape");

  await say("Selecting rows: the bulk bar takes the button's place");
  await page.getByRole("checkbox", { name: "Selecionar linha" }).first().tap();
  await check("The button steps aside for the bulk bar", async () => {
    await expect(page.getByText(/^1 selecionada/)).toBeVisible();
    await expect(fab).toBeHidden();
  });
  await page.keyboard.press("Escape");
  await expect(fab).toBeVisible();

  await scene("Nova transação", "A tap on the button opens the form");
  await fab.tap();
  const form = dialog(page, "Nova transação");
  await check("The form opens below the status bar", async () => {
    await expect(form).toBeVisible();
    expect((await form.boundingBox())!.y).toBeGreaterThanOrEqual(IPHONE_STATUS_BAR);
  });
  const date = field(form, "Data").locator("input");
  await check("16px fields; the date fits", async () => {
    expect(await date.evaluate((input) => parseFloat(getComputedStyle(input).fontSize))).toBeGreaterThanOrEqual(16);
    expect(await date.evaluate((input: HTMLInputElement) => input.scrollWidth <= input.clientWidth)).toBe(true);
  });
  await page.keyboard.press("Escape");
  await expect(form).toBeHidden();

  // Leave the trash as the other flows expect it.
  await more.tap();
  await page.getByRole("menuitem", { name: /^Lixeira · \d+$/ }).click();
  await trashRow(page, NAME).restore.tap();
  await expect(toast(page, `“${NAME}” restaurada`)).toBeVisible();
  await page.keyboard.press("Escape");

  await scene("Filtros numa linha própria", "Orçamentos: the month and the period under the title");
  await page.goto("/transactions/budgets");
  const budgetsHeader = page.getByRole("main").locator("header").first();
  const title = budgetsHeader.getByText("Orçamentos", { exact: true });
  const modes = budgetsHeader.getByRole("radiogroup");
  await check("Filters sit on a row under the title", async () => {
    await expect(modes).toBeInViewport({ ratio: 1 });
    const titleBox = (await title.boundingBox())!;
    expect((await modes.boundingBox())!.y).toBeGreaterThan(titleBox.y + titleBox.height);
    await expect(page.locator("[data-fab]")).toHaveText("Orçamento");
  });
});
