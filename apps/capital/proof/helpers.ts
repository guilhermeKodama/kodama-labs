import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Capital has no test ids, and a few of its controls need a known
 * sequence to drive. These helpers keep that knowledge in one place.
 */

/**
 * The block of a form field, found by its label. Most labels in Capital
 * are plain spans, so `getByLabel` finds nothing; narrow the result with
 * `.locator("input")` or `.getByRole("combobox")`.
 */
export function field(scope: Page | Locator, label: string): Locator {
  return scope.locator(`div:has(> span:text-is(${JSON.stringify(label)}))`).first();
}

/** The open dialog or sheet with this title. */
export function dialog(page: Page, title: string | RegExp): Locator {
  return page.getByRole("dialog", { name: title });
}

/**
 * Picks from Capital's searchable list (categories, accounts, banks): a
 * button that opens a popover with a search box. Clicks the option by
 * name; pressing Enter would take the first match instead.
 */
export async function pickFromList(trigger: Locator, option: string): Promise<void> {
  const page = trigger.page();
  await trigger.click();
  const popover = page.locator("[data-radix-popper-content-wrapper]").last();
  await popover.getByRole("combobox").pressSequentially(option, { delay: 15 });
  await popover.getByRole("option", { name: option, exact: true }).click();
  await expect(popover).toBeHidden();
}

/** Picks from a plain dropdown (entity, currency, frequency). */
export async function pickFromSelect(trigger: Locator, option: string | RegExp): Promise<void> {
  const page = trigger.page();
  await trigger.click();
  await page.getByRole("option", { name: option, exact: typeof option === "string" }).click();
}

/** A toast, found by part of its text. Capital quotes names with curly quotes and uses a real minus sign. */
export function toast(page: Page, text: string | RegExp): Locator {
  return page.locator("[data-sonner-toast]").filter({ hasText: text });
}

/**
 * A row of the Transações table, found by its description. The table
 * only renders the rows on screen, so search first when the row may be
 * far down.
 */
export function ledgerRow(page: Page, description: string) {
  const row = page
    .locator('div.grid:has(> span > [data-cell-edit][data-field="description"])')
    .filter({ has: page.locator('[data-field="description"]', { hasText: description }) });
  return {
    row,
    /** An editable cell: "description", "amount", "date", "categoryId", "accountId", "entityId". */
    cell: (name: string) => row.locator(`[data-cell-edit][data-field="${name}"]`),
    actions: row.getByRole("button", { name: "Ações da transação" }),
  };
}

/** Waits until Transações has loaded its rows. */
export async function openTransactions(page: Page): Promise<void> {
  await page.goto("/transactions");
  await expect(page.locator("[data-cell-edit]").first()).toBeVisible();
}

/**
 * Every row Transações has on screen. Count them after a search or a
 * filter to prove the table narrowed; `ledgerRow` finds one by name.
 */
export function ledgerRows(page: Page): Locator {
  return page.locator('div.grid:has(> span > [data-cell-edit][data-field="description"])');
}

/**
 * A row of the Lixeira sheet, found by its description. The sheet opens
 * from the header button "Lixeira · N", which only exists while the
 * trash has something. Never click "Esvaziar lixeira": it cannot be undone.
 */
export function trashRow(page: Page, description: string) {
  const row = dialog(page, "Lixeira").locator("div.grid").filter({ hasText: description });
  return { row, restore: row.getByRole("button", { name: "Restaurar" }) };
}

/**
 * The badge after "Tipo:" in a transfer form: the kind Capital detects
 * from the two ends ("Aporte de capital", "Distribuição de lucros").
 */
export function transferKind(form: Locator): Locator {
  return form.locator('span:text-is("Tipo:") + span');
}

/**
 * The command palette. `open` presses Ctrl/Cmd+K, which works from
 * anywhere, a text field included. Rows are options under group headings
 * ("Quick add", "Ir para", "Lançamentos"). A row's name holds everything
 * on it, and the rows that echo the typed text ("Ver todos com …",
 * "Perguntar ao assistente: …") match a plain string too, so find a
 * result inside its group and with a case-sensitive pattern.
 */
export function commandPalette(page: Page) {
  const root = page.getByRole("dialog", { name: "Buscar ou executar" });
  const input = root.getByPlaceholder("Buscar ou executar…");
  return {
    root,
    input,
    group: (heading: string) => root.getByRole("group", { name: heading }),
    open: async () => {
      await page.keyboard.press("ControlOrMeta+k");
      await expect(input).toBeFocused();
    },
  };
}

/**
 * `pickFromSelect`, then waits for the dropdown to hand focus back to its
 * button. Use it when the next step types: the dropdown takes focus back
 * a moment after it closes, and as a test (no pauses) the keys typed in
 * that moment land on the dropdown, not on the field.
 */
export async function pickFromSelectAndSettle(trigger: Locator, option: string | RegExp): Promise<void> {
  await pickFromSelect(trigger, option);
  await expect(trigger).toBeFocused();
}

/**
 * An open popover ("Filtrar por…", a filter chip's editor, "Exibição"),
 * found by a text it shows. Popovers have no name of their own, and their
 * buttons ("Categoria", "Pronto") repeat names used on the page behind.
 */
export function popover(page: Page, text: string | RegExp): Locator {
  return page.locator("[data-radix-popper-content-wrapper]").filter({ hasText: text }).last();
}

/**
 * The view tabs above Transações. The sidebar lists the favorite views
 * with the same names and the same "Excluir “…”" buttons, so a view is
 * found here, inside the bar. `add` is the "+": it shares its accessible
 * name with a view still called "Nova view", so it goes by its title.
 */
export function viewTabs(page: Page) {
  const bar = page.locator('div:has(> button[title="Nova view"])').last();
  return {
    bar,
    add: bar.getByTitle("Nova view"),
    /** The tab of a view: its name, without the "×" and "⋯" next to it. */
    tab: (name: string) => bar.locator("button:not([title])").filter({ hasText: name }),
    /** The "×" of a view's tab; it opens a confirmation dialog "Excluir a view “…”?". */
    remove: (name: string) => bar.getByRole("button", { name: `Excluir “${name}”` }),
  };
}

/**
 * Creates an expense through "Nova transação" (N), for a flow that needs
 * rows of its own before the part it proves. Call it from Transações with
 * no dialog open. It fills the fields in one go; use the flow's `type`
 * when the form itself is the subject.
 */
export async function addExpense(page: Page, expense: { description: string; amount: string; category: string }): Promise<void> {
  await page.keyboard.press("n");
  const form = dialog(page, "Nova transação");
  await form.getByPlaceholder("0,00").fill(expense.amount);
  await form.getByPlaceholder("Ex.: iFood, Invoice #0142, Aluguel").fill(expense.description);
  await pickFromList(field(form, "Categoria").getByRole("button"), expense.category);
  await form.getByRole("button", { name: "Salvar" }).click();
  await expect(toast(page, `“${expense.description}” criada`)).toBeVisible();
  await expect(form).toBeHidden();
}

/**
 * Like `field`, for a label that carries more than its text: "Aporte
 * mensal" in the FIRE goal also holds the phase name and the "Fase atual"
 * badge, so `field`, which compares the whole label, finds nothing.
 */
export function fieldWith(scope: Page | Locator, label: string): Locator {
  return scope.locator(`div:has(> span:has-text(${JSON.stringify(label)}))`).first();
}

/**
 * The value under a small label, the way Capital stacks them in a sheet's
 * detail grid ("Quantidade") and in a KPI ("Posição"). A form field with
 * the same label holds an input under it and does not match.
 */
export function valueOf(scope: Page | Locator, label: string): Locator {
  return scope.locator(`div:has(> span:first-child:text-is(${JSON.stringify(label)})) > span:nth-child(2)`).first();
}

/** A panel (the bordered box with a title bar: "Alocação atual vs alvo", "Independência financeira"), found by its title. */
export function panel(page: Page, title: string): Locator {
  return page.locator("section").filter({ has: page.locator("header", { hasText: title }) });
}

/** The first number in a text, read as Capital writes it in pt-BR: "R$ 1.234,56" is 1234.56 and "−5pp" is -5. */
export function readNumber(text: string): number {
  const match = /[-−]?\d[\d.]*(?:,\d+)?/.exec(text);
  if (!match) throw new Error(`No number in "${text}"`);
  return Number(match[0].replace("−", "-").replace(/\./g, "").replace(",", "."));
}

/** A number as Capital writes it in pt-BR: 1234.5 is "1.234,5". Pass `decimals` for money: "1.234,50". */
export function writeNumber(value: number, decimals?: number): string {
  const digits = decimals === undefined ? { maximumFractionDigits: 8 } : { minimumFractionDigits: decimals, maximumFractionDigits: decimals };
  return new Intl.NumberFormat("pt-BR", digits).format(value);
}

/** Opens Orçamentos and waits until the month has loaded its budgets and Contas fixas. */
export async function openBudgets(page: Page): Promise<void> {
  await page.goto("/transactions/budgets");
  await expect(page.getByText("Contas fixas · próximos 14 dias")).toBeVisible();
}

/**
 * A row of the Mensal table in Orçamentos, found by its category. The
 * table has no roles; what names a row is its budgeted amount, a button
 * called "Orçado de {category}, {amount}. Editar" that opens "Editar
 * orçamento". Its text is the amount alone from 768 px up.
 */
export function budgetRow(page: Page, category: string) {
  const row = page.locator(`div.grid:has(> button[aria-label^=${JSON.stringify(`Orçado de ${category},`)}])`);
  return { row, amount: row.getByRole("button", { name: /^Orçado de / }) };
}

/**
 * Opens Transações ("Todas") over every period, searched when `search` is
 * given: the way to rows dated in other months (a statement of last month,
 * the later installments of a purchase). The period travels in the URL as
 * an unsaved draft. Do not pick "Todo o período" in the period control
 * instead: on Todas that choice is saved and every later flow would see it.
 */
export async function openAllTransactions(page: Page, search?: string): Promise<void> {
  const draft = Buffer.from(JSON.stringify({ period: { preset: "all", offset: 0 } })).toString("base64url");
  await page.goto(`/transactions?draft=${draft}${search ? `&q=${encodeURIComponent(search)}` : ""}`);
  await expect(page.getByRole("button", { name: "Todo o período" })).toBeVisible();
}

/**
 * Creates a new entry in one of Capital's searchable lists (the bank of an
 * account): types the name and clicks "+ Criar “name”", the row the list
 * adds when nothing it has matches. `pickFromList` picks an existing one.
 */
export async function createInList(trigger: Locator, name: string): Promise<void> {
  const page = trigger.page();
  await trigger.click();
  const list = page.locator("[data-radix-popper-content-wrapper]").last();
  await list.getByRole("combobox").pressSequentially(name, { delay: 15 });
  await list.getByRole("option", { name: `+ Criar “${name}”`, exact: true }).click();
  await expect(list).toBeHidden();
}

/** An item of the nav on the left of Ajustes ("Categorias", "Contas bancárias"). The items are buttons, not links. */
export function settingsNav(page: Page, name: string): Locator {
  return page.getByRole("navigation").getByRole("button", { name, exact: true });
}

/**
 * A group of a list in Ajustes, found by its label: the accounts of an
 * entity ("Kodama LTDA"), the categories of a kind ("Despesas"). Its rows
 * are buttons whose name also holds what sits on the right of the row
 * (currency, usage count, "arquivada"), so find a row by part of its name.
 */
export function settingsGroup(page: Page, label: string): Locator {
  return page.getByRole("main").locator(`div:has(> span:text-is(${JSON.stringify(label)}))`);
}

/**
 * Contas fixas (the recurring rules) in Orçamentos. `upcoming` is a rule
 * in the box "Contas fixas · próximos 14 dias", which only holds what is
 * due soon and sits below the fold at 1280 px. `seeAll` opens `sheet`,
 * where every rule is a button under "Ativas" or "Pausadas": `listed`
 * finds one and `dueDate` reads its next date ("12/10"). Clicking a rule
 * opens its editor, a dialog named after the rule, over the sheet; the
 * sheet stays open behind it and shows the new date once the editor closes.
 */
export function fixedBills(page: Page) {
  const box = panel(page, "Contas fixas · próximos 14 dias");
  const sheet = dialog(page, "Contas fixas");
  const group = (title: "Ativas" | "Pausadas") => sheet.locator("section").filter({ has: page.getByRole("heading", { name: title }) });
  const listed = (name: string, title: "Ativas" | "Pausadas" = "Ativas") => group(title).getByRole("button", { name });
  return {
    box,
    upcoming: (name: string) => box.getByRole("button", { name }),
    seeAll: box.getByRole("button", { name: "Ver todas" }),
    sheet,
    group,
    listed,
    dueDate: (name: string) => listed(name).locator("span").first(),
  };
}
