import { expect, flow } from "@repo/proof-video";
import { dialog, field, ledgerRow, openTransactions, toast, trashRow } from "../helpers";

// An iPhone 17 Pro: 402 × 874 pt, a touch screen (so `pointer: coarse` matches).
flow.use({ viewport: { width: 402, height: 874 }, hasTouch: true, isMobile: true });

// What iOS reports in the installed app (the status bar with the Dynamic Island,
// the home indicator). Chromium reports no safe areas, so the flow sets the same
// values the app reads (globals.css, --safe-*) and draws the status bar it stands for.
const IPHONE_STATUS_BAR = 62;
const SIMULATED_IPHONE = `
  html:root { --safe-top: ${IPHONE_STATUS_BAR}px; --safe-bottom: 34px; }
  #proof-status-bar {
    position: fixed; top: 0; left: 0; right: 0; height: ${IPHONE_STATUS_BAR}px; z-index: 2147483000;
    display: flex; align-items: center; justify-content: center; pointer-events: none;
    background: rgb(0 0 0 / 0.55); color: white; font: 600 12px system-ui;
  }`;

// A demo expense of this month; the flow restores it at the end.
const NAME = "Estapar";

flow("The app on a phone: the top bar clear of the status bar, every action on screen, 16px fields", async ({ page, scene, say, check }) => {
  await openTransactions(page);
  const header = page.getByRole("main").locator("header").first();

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

  await scene("Na largura de um celular", "With something in the trash, the top bar ran off the screen");
  await say("Put an expense in the trash, so the header shows Lixeira · 1");
  await ledgerRow(page, NAME).actions.first().click();
  await page.getByRole("menuitem", { name: "Excluir" }).click();
  await expect(toast(page, `“${NAME}” excluída`)).toBeVisible();
  await check("Breadcrumb and actions fit", async () => {
    await expect(header.getByText("Todas", { exact: true })).toBeInViewport({ ratio: 1 });
    for (const name of [/^Lixeira · \d+$/, "Importar extrato", "+ Nova transação"]) {
      await expect(header.getByRole("button", { name })).toBeInViewport({ ratio: 1 });
    }
  });
  await check("No keyboard hints on a phone", async () => {
    await expect(header.getByText("N", { exact: true })).toBeHidden();
  });

  const trigger = header.getByRole("button", { name: "Abrir o menu" });
  await say("▤ and the buttons are sized for a finger, not a mouse");
  await check("▤ and buttons are finger-sized", async () => {
    const menu = (await trigger.boundingBox())!;
    expect(Math.min(menu.width, menu.height)).toBeGreaterThanOrEqual(44);
    const create = (await header.getByRole("button", { name: "+ Nova transação" }).boundingBox())!;
    expect(create.height).toBeGreaterThanOrEqual(40);
  });

  await say("The menu opens below the status bar too");
  await trigger.tap();
  const drawer = page.getByRole("dialog", { name: "Cerne" });
  await check("Menu starts below the status bar", async () => {
    await expect(drawer.getByRole("link", { name: "Orçamentos" })).toBeVisible();
    expect((await drawer.getByText("cerne", { exact: true }).boundingBox())!.y).toBeGreaterThanOrEqual(IPHONE_STATUS_BAR);
  });
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();

  await say("And so does a dialog");
  await header.getByRole("button", { name: "+ Nova transação" }).tap();
  const form = dialog(page, "Nova transação");
  await check("Dialog opens below the status bar", async () => {
    await expect(form).toBeVisible();
    expect((await form.boundingBox())!.y).toBeGreaterThanOrEqual(IPHONE_STATUS_BAR);
  });

  await scene("Campos de 16px", "iOS zooms into a field under 16px and stays zoomed in");
  const date = field(form, "Data").locator("input");
  await check("16px fields; the date fits", async () => {
    expect(await date.evaluate((input) => parseFloat(getComputedStyle(input).fontSize))).toBeGreaterThanOrEqual(16);
    expect(await date.evaluate((input: HTMLInputElement) => input.scrollWidth <= input.clientWidth)).toBe(true);
  });
  await page.keyboard.press("Escape");
  await expect(form).toBeHidden();

  // Leave the trash as the other flows expect it.
  await header.getByRole("button", { name: /^Lixeira · \d+$/ }).tap();
  await trashRow(page, NAME).restore.tap();
  await expect(toast(page, `“${NAME}” restaurada`)).toBeVisible();
  await page.keyboard.press("Escape");
});
