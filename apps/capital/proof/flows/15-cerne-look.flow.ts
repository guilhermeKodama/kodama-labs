import type { Locator, Page } from "@playwright/test";
import { expect, flow } from "@repo/proof-video";
import { dialog, field, valueOf } from "../helpers";

// The Cerne palette, as the browser computes it (rgb of the tokens in globals.css).
const PAPER = "rgb(251, 248, 242)";
const CHARCOAL = "rgb(31, 26, 23)";
const HEARTWOOD = "rgb(91, 46, 31)";
const SAPWOOD = "rgb(242, 235, 221)";
const NAV_ON = "rgb(224, 211, 186)";
const RESIN_DARK = "rgb(224, 160, 74)";
const PANEL = "rgb(255, 255, 255)";
// Ipê-amarelo, the alerts: the text tone of each theme.
const IPE_TEXT = "rgb(137, 110, 27)";
const IPE_DARK = "rgb(233, 200, 74)";

/** Opens + Operação in Carteira as a sale of more BOVA11 than the position holds; returns the dialog. */
async function oversell(page: Page, type: (target: Locator, text: string) => Promise<void>) {
  await page.goto("/investments");
  await page.getByRole("button", { name: "+ Operação" }).click();
  const op = dialog(page, "Nova operação");
  await op.getByRole("radio", { name: "Venda" }).click();
  await expect(field(op, "Corretora").getByRole("combobox")).not.toHaveText("Nenhuma corretora");
  await op.getByRole("button", { name: /^BOVA11 / }).click();
  await type(field(op, "Quantidade").locator("input"), "999999");
  return op;
}

flow("Cerne look: warm palette, brand color, fonts and the ipê alerts, in light and dark", async ({ page, scene, say, check, type }) => {
  await page.goto("/transactions");
  const body = page.locator("body");
  const primary = page.getByRole("button", { name: "+ Nova transação" });
  // The open view: its link carries aria-current, its row (the parent) the selected style.
  const activeRow = page.locator("aside [aria-current='page']").first().locator("xpath=..");

  await scene("Tema claro", "Sapwood page, charcoal text, heartwood actions");
  await check("The page is sapwood paper with charcoal text", async () => {
    await expect(body).toHaveCSS("background-color", PAPER);
    await expect(body).toHaveCSS("color", CHARCOAL);
  });
  await say("The primary action takes the heartwood brown of the logo");
  await check("+ Nova transação is heartwood with paper text", async () => {
    await expect(primary).toHaveCSS("background-color", HEARTWOOD);
    await expect(primary).toHaveCSS("color", PAPER);
  });
  await say("The open view in the sidebar sits on nav-on, with the brand bar on its edge");
  await check("The selected sidebar item has the nav-on fill and the heartwood indicator", async () => {
    await expect(activeRow).toHaveCSS("background-color", NAV_ON);
    await expect(activeRow).toHaveCSS("box-shadow", new RegExp(HEARTWOOD.replace(/[()]/g, "\\$&")));
  });

  await scene("Fontes", "Geist for the interface, Geist Mono for numbers, Fraunces for titles");
  await check("The interface is set in Geist and the amounts in Geist Mono", async () => {
    await expect(body).toHaveCSS("font-family", /geist/i);
    await expect(page.locator(".font-mono").first()).toHaveCSS("font-family", /geistMono/i);
  });
  await check("The page title is set in Fraunces", async () => {
    await expect(page.locator("header").getByText("Todas", { exact: true })).toHaveCSS("font-family", /fraunces/i);
  });
  await say("Panels on every screen carry their titles in Fraunces too");
  await page.goto("/investments");
  await check("Panel titles in Carteira are set in Fraunces, their buttons in Geist", async () => {
    const title = page.getByText("Patrimônio vs total aportado", { exact: true });
    await expect(title).toHaveCSS("font-family", /fraunces/i);
    await expect(page.getByRole("button", { name: "Editar alvos" })).toHaveCSS("font-family", /geist/i);
  });
  await page.goto("/transactions");
  await say("Dialogs open on a white panel above the sapwood page");
  await primary.click();
  const entry = page.getByRole("dialog");
  await check("The new-transaction dialog is a white panel with a Fraunces title", async () => {
    await expect(entry).toHaveCSS("background-color", PANEL);
    await expect(entry.getByRole("heading").first()).toHaveCSS("font-family", /fraunces/i);
  });
  await page.keyboard.press("Escape");
  await expect(entry).toBeHidden();

  await scene("Alertas em ipê", "Warnings take the yellow of the ipê, darkened to read on cream");
  await say("Selling more than the position holds is a warning");
  let op = await oversell(page, type);
  await check("The oversold result is in ipê", async () => {
    await expect(op.getByText(/^mais que a posição/)).toBeVisible();
    await expect(valueOf(op, "Resultado estimado")).toHaveCSS("color", IPE_TEXT);
  });
  await page.keyboard.press("Escape");
  await expect(op).toBeHidden();

  await scene("Tema escuro", "Charcoal page; the brand turns sapwood and the indicator resin");
  await page.goto("/settings");
  const theme = page.getByRole("radiogroup", { name: "Tema" });
  await theme.getByRole("radio", { name: "Escuro" }).click();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await page.goto("/transactions");
  await check("The dark page is charcoal with sapwood text", async () => {
    await expect(body).toHaveCSS("background-color", CHARCOAL);
    await expect(body).toHaveCSS("color", SAPWOOD);
  });
  await check("The primary action is sapwood with charcoal text, and the indicator is resin", async () => {
    await expect(primary).toHaveCSS("background-color", SAPWOOD);
    await expect(primary).toHaveCSS("color", CHARCOAL);
    await expect(activeRow).toHaveCSS("box-shadow", new RegExp(RESIN_DARK.replace(/[()]/g, "\\$&")));
  });

  op = await oversell(page, type);
  await check("In the dark theme the warning is the canvas ipê", async () => {
    await expect(valueOf(op, "Resultado estimado")).toHaveCSS("color", IPE_DARK);
  });
  await page.keyboard.press("Escape");
  await expect(op).toBeHidden();

  await say("Back to Claro, the theme the other flows expect");
  await page.goto("/settings");
  await theme.getByRole("radio", { name: "Claro" }).click();
  await check("Claro is back on", async () => {
    await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
    await expect(body).toHaveCSS("background-color", PAPER);
  });
});
