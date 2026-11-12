import { expect, flow } from "@repo/proof-video";
import { dialog, openTransactions } from "../helpers";

// An iPhone 17 Pro: 402 × 874 pt, a touch screen.
const WIDTH = 402;
const HEIGHT = 874;
flow.use({ viewport: { width: WIDTH, height: HEIGHT }, hasTouch: true, isMobile: true });

// The iPhone's status bar and home indicator, as iOS reports them in the installed app
// (Chromium reports none). The dashed line marks the status bar's edge on the video.
const IPHONE = `
  html:root { --safe-top: 62px; --safe-bottom: 34px; }
  #proof-status-bar { position: fixed; top: 0; left: 0; right: 0; height: 62px; z-index: 2147483000; pointer-events: none;
    border-bottom: 1px dashed rgb(0 0 0 / 0.35); display: flex; align-items: center; justify-content: center;
    color: rgb(0 0 0 / 0.55); font: 600 12px system-ui; }`;

async function simulateIphone(page: import("@playwright/test").Page) {
  await page.addStyleTag({ content: IPHONE });
  await page.evaluate(() => {
    const bar = document.createElement("div");
    bar.id = "proof-status-bar";
    bar.textContent = "barra de status do iPhone (simulada)";
    document.body.appendChild(bar);
  });
}

/** The computed background of a throwaway element with these classes. */
async function colorOf(page: import("@playwright/test").Page, classes: string) {
  return page.evaluate((cls) => {
    const probe = document.createElement("div");
    probe.className = cls;
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  }, classes);
}

flow("The app on a phone, polished: a full-width search, a selection bar that fits, full-screen forms, budgets read from the left", async ({ page, scene, say, check }) => {
  await openTransactions(page);
  await simulateIphone(page);

  await scene("Busca", "On a phone the search fills its row, with Exibição at its end");
  const search = page.getByRole("textbox", { name: "Buscar nesta view…" });
  const display = page.getByRole("main").getByRole("button", { name: "Exibição" });
  await check("Search and Exibição fill the row", async () => {
    const field = (await search.boundingBox())!;
    const button = (await display.boundingBox())!;
    expect(Math.abs(field.y - button.y)).toBeLessThanOrEqual(2);
    expect(button.x - (field.x + field.width)).toBeLessThanOrEqual(8);
    expect(Math.round(WIDTH - (button.x + button.width))).toBeLessThanOrEqual(16);
    expect(field.width).toBeGreaterThan(220);
  });

  await scene("Barra de seleção", "Selecting rows on a phone");
  const checkboxes = page.getByRole("checkbox", { name: "Selecionar linha" });
  await checkboxes.nth(0).tap();
  await checkboxes.nth(1).tap();
  const bar = page.locator('[data-bulk-bar="phone"]');
  await check("A dark bar at the bottom, as wide as the screen", async () => {
    await expect(bar).toBeVisible();
    await expect(bar).toContainText("2 selecionadas");
    const box = (await bar.boundingBox())!;
    expect(box.x).toBe(0);
    expect(box.width).toBe(WIDTH);
    expect(Math.round(box.y + box.height)).toBe(HEIGHT);
    expect(await bar.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(await colorOf(page, "bg-fg-1"));
  });
  await check("Nothing scrolls sideways", async () => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(WIDTH);
    expect(await bar.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  });
  await say("Categoria, Entidade and Excluir on the bar; the rest under ⋯");
  await bar.getByRole("button", { name: "Mais ações" }).tap();
  await check("⋯ holds Editar, Marcar IR, Duplicar, Exportar", async () => {
    for (const item of ["Editar…", "Marcar IR", "Duplicar", "Exportar"]) {
      await expect(page.getByRole("menuitem", { name: item })).toBeVisible();
    }
  });
  await page.keyboard.press("Escape");
  await bar.getByRole("button", { name: "Limpar seleção (Esc)" }).tap();
  await expect(bar).toBeHidden();

  await scene("Formulários em tela cheia", "Nova transação, as iOS and Android show a form");
  await page.locator("[data-fab]").tap();
  const form = dialog(page, "Nova transação");
  await check("The form fills the screen", async () => {
    await expect(form).toBeVisible();
    const box = (await form.boundingBox())!;
    expect([box.x, box.y, box.width]).toEqual([0, 0, WIDTH]);
  });
  await check("✕ is a 44px button, Salvar is on screen", async () => {
    const close = (await form.getByRole("button", { name: "Fechar" }).boundingBox())!;
    expect(Math.min(close.width, close.height)).toBeGreaterThanOrEqual(44);
    await expect(form.getByRole("button", { name: "Salvar" })).toBeInViewport({ ratio: 1 });
  });
  await page.keyboard.press("Escape");

  await say("Nova operação had fields running off the right edge");
  await page.goto("/investments");
  await simulateIphone(page);
  await page.locator("[data-fab]").tap();
  const operation = dialog(page, "Nova operação");
  await check("Nova operação fits, its button stays on screen", async () => {
    await expect(operation).toBeVisible();
    expect(await operation.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await expect(operation.getByRole("button", { name: "Registrar compra" })).toBeInViewport({ ratio: 1 });
  });
  await page.keyboard.press("Escape");

  await scene("Orçamentos", "Each budget's figures, read from the left");
  await page.goto("/transactions/budgets");
  await simulateIphone(page);
  const first = page.getByRole("button", { name: /^Orçado de / }).first();
  await first.scrollIntoViewIfNeeded();
  await check("Orçado starts at the budget's left edge", async () => {
    const row = first.locator("xpath=..");
    const name = (await row.locator("a, span").first().boundingBox())!;
    const figure = (await first.boundingBox())!;
    expect(Math.abs(figure.x - name.x)).toBeLessThanOrEqual(4);
    expect(await first.evaluate((el) => getComputedStyle(el).textAlign)).toBe("left");
  });
});
