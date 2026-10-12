import { expect, flow } from "@repo/proof-video";
import { addExpense, dialog, field, ledgerRow, openTransactions, popover, toast, viewTabs } from "../helpers";

const GROCERIES = "Feira da prova";
const RIDE = "Táxi da prova";
const VIEW = "Board da prova";

flow("Filter Transações and keep a layout as a saved view", async ({ page, scene, say, check, type }) => {
  await openTransactions(page);
  const groceries = ledgerRow(page, GROCERIES);
  const ride = ledgerRow(page, RIDE);
  const categoryCells = page.locator('[data-cell-edit][data-field="categoryId"]');
  const chip = page.getByRole("button", { name: "Categoria é Mercado" });
  const clear = page.getByRole("button", { name: "Limpar", exact: true });
  const tabs = viewTabs(page);

  await scene("Filter the table", "On the fixed view Todas a filter is a draft");
  await say("Two expenses made for this proof: one in Mercado, one in Transporte");
  await addExpense(page, { description: GROCERIES, amount: "86,40", category: "Mercado" });
  await addExpense(page, { description: RIDE, amount: "31,90", category: "Transporte" });
  await expect(groceries.row).toBeVisible();
  await expect(ride.row).toBeVisible();

  await say("+ Filtro picks a property, then the values to keep");
  await page.getByRole("button", { name: "+ Filtro" }).click();
  await popover(page, "Filtrar por…").getByRole("button", { name: "Categoria", exact: true }).click();
  const editor = popover(page, "Categoria é…");
  await editor.getByRole("checkbox", { name: "Mercado", exact: true }).click();
  await editor.getByRole("button", { name: "Pronto" }).click();
  await check("Only Mercado rows are left, under the filter's chip", async () => {
    await expect(chip).toBeVisible();
    await expect(ride.row).toHaveCount(0);
    await expect(groceries.row).toBeVisible();
    await expect(categoryCells.filter({ hasNotText: /^Mercado$/ })).toHaveCount(0);
  });
  await check("The filter is a draft: Limpar and Salvar como nova appear", async () => {
    await expect(page).toHaveURL(/[?&]draft=/);
    await expect(clear).toBeVisible();
    await expect(page.getByRole("button", { name: "Salvar como nova" })).toBeVisible();
  });

  await say("Limpar drops the draft");
  await clear.click();
  await check("The filter is gone and the Transporte expense is back", async () => {
    await expect(chip).toHaveCount(0);
    await expect(ride.row).toBeVisible();
    await expect(page).not.toHaveURL(/[?&]draft=/);
  });

  await scene("A saved view", "Its own tab, name and layout");
  await say("The + after the tabs creates a view and opens Exibição");
  await tabs.add.click();
  const display = popover(page, "Layout");
  await expect(display).toBeVisible();
  // The bar goes back to its start when a view opens, and the new tab is the last one.
  await say("The new tab is the last one: the bar is scrolled to show it");
  await tabs.tab("Nova view").scrollIntoViewIfNeeded();
  await check("The new view opens as a tab called Nova view", async () => {
    await expect(tabs.tab("Nova view")).toBeInViewport();
    await expect(tabs.remove("Nova view")).toBeVisible();
  });

  await say("The name is saved as it is typed");
  await type(field(display, "Nome").locator("input"), VIEW);
  // The longer name pushes the tab past the edge again.
  await tabs.add.scrollIntoViewIfNeeded();
  await check("The tab takes the new name", async () => {
    await expect(tabs.tab(VIEW)).toBeInViewport();
    await expect(tabs.tab("Nova view")).toHaveCount(0);
  });

  await say("Exibição also picks the layout: Board groups the entries in columns");
  // A view saves itself a moment after each change. The reload below must not race that save.
  const layoutSaved = page.waitForResponse((response) => response.request().method() === "PATCH" && (response.request().postData() ?? "").includes('"layout":"board"'));
  await display.getByRole("button", { name: "Board" }).click();
  await display.getByRole("button", { name: "Fechar" }).click();
  const card = page
    .locator("section")
    .filter({ has: page.locator("header", { hasText: "Mercado" }) })
    .getByRole("button", { name: new RegExp(GROCERIES) });
  await card.scrollIntoViewIfNeeded();
  await check("The board shows the expense as a card under Mercado", async () => {
    await expect(page.locator("[data-cell-edit]")).toHaveCount(0);
    await expect(card).toBeInViewport();
  });

  await layoutSaved;
  await page.reload();
  await tabs.tab(VIEW).scrollIntoViewIfNeeded();
  await card.scrollIntoViewIfNeeded();
  await check("A reload keeps the view, its name and its board", async () => {
    await expect(tabs.tab(VIEW)).toBeInViewport();
    await expect(card).toBeInViewport();
  });

  await scene("Delete the view");
  await say("The × on the active tab asks before deleting");
  await tabs.remove(VIEW).click();
  await dialog(page, `Excluir a view “${VIEW}”?`).getByRole("button", { name: "Excluir" }).click();
  await expect(toast(page, `View “${VIEW}” excluída`)).toBeVisible();
  // Todas opens with the bar at its start; the deleted tab was at the end.
  await expect(groceries.row).toBeVisible();
  await tabs.add.scrollIntoViewIfNeeded();
  await check("The view leaves the tabs and the sidebar, and Todas is back", async () => {
    await expect(toast(page, `View “${VIEW}” excluída`)).toBeVisible();
    await expect(tabs.tab(VIEW)).toHaveCount(0);
    await expect(page.getByRole("link", { name: VIEW })).toHaveCount(0);
    await expect(groceries.row).toBeVisible();
  });
});
