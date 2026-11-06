import fs from "node:fs";
import path from "node:path";
import { expect, flow } from "@repo/proof-video";
import { createInList, dialog, field, openBudgets, panel, pickFromList, readNumber, swatchColor, toast } from "../helpers";

const CATEGORY = "Plano totais cel";
const SPEND = "Gasto do plano cel";

/** Fixo, variável, the cumulative line, the ideal pace and the orçado mark, each a different painted color. The two cards use the chart's fixo and variável. */
async function expectDistinctPaceColors(legend: import("@playwright/test").Locator, fixoCard: import("@playwright/test").Locator, variavelCard: import("@playwright/test").Locator) {
  const [fixo, variavel, cumulative, ideal, budget] = await Promise.all([
    swatchColor(legend, "Gastos fixos"),
    swatchColor(legend, "Gastos variáveis"),
    swatchColor(legend, /Gasto acumulado/),
    swatchColor(legend, /Ritmo ideal/),
    swatchColor(legend, "Orçado"),
  ]);
  expect(new Set([fixo, variavel, cumulative, ideal, budget]).size).toBe(5);
  expect(await swatchColor(fixoCard, "Gastos fixos")).toBe(fixo);
  expect(await swatchColor(variavelCard, "Gastos variáveis")).toBe(variavel);
}

/** The first amount on a card, keeping the minus in "−R$ 80". */
function cardMoney(text: string): number {
  const match = /([-−])?\s*R\$\s*(\d[\d.]*(?:,\d+)?)/.exec(text);
  if (!match) return readNumber(text);
  const value = Number(match[2].replace(/\./g, "").replace(",", "."));
  return match[1] ? -value : value;
}

/** The month header, the Tipo and PF/PJ filters, and the whole totals strip, from the top of the screen. */
async function expectTop(page: import("@playwright/test").Page, kind: "Todos" | "Fixo" | "Variável") {
  await page.locator("[data-budget-kpi='fixo']").evaluate((el) => {
    let node = el.parentElement;
    while (node) {
      const style = getComputedStyle(node);
      if (style.overflowY === "auto" || style.overflowY === "scroll") {
        node.scrollTop = 0;
        return;
      }
      node = node.parentElement;
    }
  });
  const whole = { ratio: 1 } as const;
  const tipo = page.getByRole("radiogroup", { name: "Tipo" });
  await expect(tipo.getByRole("radio", { name: kind })).toHaveAttribute("aria-checked", "true");
  await expect(tipo).toBeInViewport(whole);
  const scope = page.getByRole("radiogroup", { name: "Escopo" });
  await expect(scope.getByRole("radio", { name: "Todas" })).toBeInViewport(whole);
  await expect(scope.getByRole("radio", { name: "PF" })).toBeInViewport(whole);
  await expect(scope.getByRole("radio", { name: "PJ" })).toBeInViewport(whole);
  await expect(page.getByRole("button", { name: "Mês anterior" })).toBeInViewport(whole);
  await expect(page.getByRole("radiogroup", { name: "Visão" }).getByRole("radio", { name: "Mensal" })).toBeInViewport(whole);
  for (const kpi of ["budget", "spent", "fixo", "variavel", "remaining", "projection"]) {
    await expect(page.locator(`[data-budget-kpi="${kpi}"]`)).toBeInViewport(whole);
  }
  // The whole phone is the proof frame. This clip is only the top, at the height of the header, the filters and the totals strip.
  const bottom = await page.locator("[data-budget-kpi='projection']").evaluate((el) => {
    const strip = el.parentElement?.getBoundingClientRect();
    return Math.ceil((strip?.bottom ?? el.getBoundingClientRect().bottom) + 12);
  });
  const dir = path.resolve(__dirname, "../out/phone-tops");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${{ Todos: "todos", Fixo: "fixo", Variável: "variavel" }[kind]}.png`);
  const recording = process.env.PROOF_RECORD === "1";
  if (recording) {
    await page.screencast.hideOverlays();
    await page.screencast.hideActions();
  }
  try {
    await page.screenshot({ path: file, clip: { x: 0, y: 0, width: 390, height: bottom } });
  } finally {
    if (recording) await page.screencast.showOverlays();
  }
}

flow.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
flow.setTimeout(120_000);

flow("On a phone, Gastos fixos and Gastos variáveis follow the filter", async ({ page, scene, say, check, type }) => {
  await openBudgets(page);
  const fixoCard = page.locator('[data-budget-kpi="fixo"]');
  const variavelCard = page.locator('[data-budget-kpi="variavel"]');
  await fixoCard.scrollIntoViewIfNeeded();
  const fixoBefore = cardMoney(await fixoCard.innerText());
  const chart = panel(page, "Gasto acumulado vs ritmo ideal");
  const legend = chart.locator("[data-budget-legend]");

  await scene("The cards", "The same two totals, on a 390px screen");
  await say("Orçamento, then a new category marked Fixo");
  await page.locator("[data-fab]").click();
  const create = dialog(page, "Novo orçamento");
  await createInList(create.getByLabel("Categoria"), CATEGORY);
  await type(create.getByLabel("Valor"), "400");
  await create.getByRole("radiogroup", { name: "Tipo" }).getByRole("radio", { name: "Fixo" }).click();
  await create.getByRole("button", { name: "Criar orçamento" }).click();
  await expect(toast(page, `Orçamento de ${CATEGORY} criado`)).toBeVisible();

  await say("An expense of R$ 80 in that category");
  await page.goto("/transactions");
  await page.locator("[data-fab]").click();
  const expense = dialog(page, "Nova transação");
  await type(expense.getByPlaceholder("0,00"), "80");
  await type(expense.getByPlaceholder("Ex.: iFood, Invoice #0142, Aluguel"), SPEND);
  await pickFromList(field(expense, "Categoria").getByRole("button"), CATEGORY);
  await expense.getByRole("button", { name: "Salvar" }).click();
  await expect(toast(page, `“${SPEND}” criada`)).toBeVisible();

  await openBudgets(page);
  const kindFilter = page.getByRole("radiogroup", { name: "Tipo" });

  await scene("The top", "Month, PF/PJ, Tipo, and the totals, for each filter");
  await say("Todos: both kinds stay in the strip");
  await check("Todos shows the filters and both totals", async () => {
    await expectTop(page, "Todos");
    await expect(fixoCard).toContainText("Gastos fixos");
    await expect(variavelCard).toContainText("Gastos variáveis");
    await expect.poll(async () => cardMoney(await fixoCard.innerText()) - fixoBefore).toBe(80);
  });

  await say("Fixo: Gastos variáveis goes to zero");
  await kindFilter.getByRole("radio", { name: "Fixo" }).click();
  await check("Fixo keeps Gastos variáveis at zero", async () => {
    await expectTop(page, "Fixo");
    await expect.poll(async () => readNumber(await variavelCard.innerText())).toBe(0);
    await expect.poll(async () => cardMoney(await fixoCard.innerText()) - fixoBefore).toBe(80);
  });

  await say("Variável: Gastos fixos goes to zero");
  await kindFilter.getByRole("radio", { name: "Variável" }).click();
  await check("Variável keeps Gastos fixos at zero", async () => {
    await expectTop(page, "Variável");
    await expect.poll(async () => readNumber(await fixoCard.innerText())).toBe(0);
  });

  await kindFilter.getByRole("radio", { name: "Todos" }).click();
  await scene("The chart", "The stack is under the line");
  await chart.scrollIntoViewIfNeeded();
  await check("The pace chart names Gastos fixos and Gastos variáveis", async () => {
    await expect(chart).toBeInViewport();
    await expect(legend.getByText("Gastos fixos", { exact: true })).toBeVisible();
    await expect(legend.getByText("Gastos variáveis", { exact: true })).toBeVisible();
    await expectDistinctPaceColors(legend, fixoCard, variavelCard);
  });

  await scene("Escuro", "Then back to Claro");
  await page.goto("/settings");
  await page.getByRole("radiogroup", { name: "Tema" }).getByRole("radio", { name: "Escuro" }).click();
  await openBudgets(page);
  await chart.scrollIntoViewIfNeeded();
  await check("The chart stays readable in the dark theme", async () => {
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await expect(legend.getByText("Gastos fixos", { exact: true })).toBeVisible();
    await expect(legend.getByText("Gastos variáveis", { exact: true })).toBeVisible();
    await expectDistinctPaceColors(legend, fixoCard, variavelCard);
  });
  await page.goto("/settings");
  await page.getByRole("radiogroup", { name: "Tema" }).getByRole("radio", { name: "Claro" }).click();
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
});
