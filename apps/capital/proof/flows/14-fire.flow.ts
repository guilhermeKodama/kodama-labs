import { expect, flow } from "@repo/proof-video";
import { dialog, fieldWith, panel, readNumber, toast, writeNumber } from "../helpers";

/** The monthly contribution the flow sets, and takes back at the end. */
const TYPED = 18500;
/** A milestone the flow adds and removes. */
const MILESTONE = "Marco da prova";

/** The year in "2036" or "Chegada em 2036 …". */
function yearIn(text: string): number {
  const match = /\b(20\d\d)\b/.exec(text);
  if (!match) throw new Error(`No year in "${text}"`);
  return Number(match[1]);
}

flow("Liberdade financeira as tree rings: the trunk, the what-if, the goal and the milestones", async ({ page, scene, say, check, type }) => {
  await page.goto("/investments/contributions");
  const card = panel(page, "Liberdade financeira");

  await scene("From Aportes to the rings", "The small trunk in Aportes opens Liberdade financeira");
  await card.scrollIntoViewIfNeeded();
  await check("The Aportes card shows the small trunk, today's value and the arrival", async () => {
    await expect(card.getByRole("img", { name: /da meta de R\$/ })).toBeVisible();
    await expect(card.getByText("Sua árvore hoje")).toBeVisible();
    await expect(card.getByText(/^Chegada em \d{4} aportando R\$/)).toBeVisible();
  });
  await say("Ver os anéis opens the screen of its own");
  await card.getByRole("link", { name: "Ver os anéis →" }).click();
  await expect(page).toHaveURL(/\/investments\/fire$/);

  const trunk = page.getByRole("img", { name: /^Corte do tronco/ });
  const arrival = page.getByTestId("fire-arrival");
  const rings = page.getByRole("region", { name: "Um anel por ano" });
  await check("The trunk is drawn: the core, one ring per year and this year's ring forming", async () => {
    await expect(trunk).toBeVisible();
    await expect(page.getByRole("link", { name: "Liberdade financeira" })).toHaveAttribute("aria-current", "page");
    await expect(rings.locator("[data-ring-row='core']")).toContainText("o que você tinha ao começar");
    await expect(rings.locator("[data-ring-row='current']")).toContainText("em formação");
    await expect(rings.locator("[data-ring-row]:has-text('anel')").first()).toBeVisible();
  });
  await check("Sua árvore hoje, Já dá por mês and the arrival with its 80% range", async () => {
    await expect(page.getByTestId("fire-hero")).toContainText(/da meta de R\$/);
    await expect(arrival).toHaveText(/^\d{4}$/);
    await expect(page.getByText(/em 80% dos cenários/)).toBeVisible();
  });
  const arrivalBefore = yearIn(await arrival.innerText());

  await scene("E se eu aportar por mês", "Another contribution, answered on the spot");
  const whatIf = page.getByRole("textbox", { name: "E se eu aportar por mês" });
  const answer = page.getByTestId("fire-what-if");
  await type(whatIf, "40.000");
  await check("Contributing R$ 40.000 a month brings the arrival years earlier", async () => {
    await expect(answer).toContainText("antes");
    expect(yearIn(await answer.innerText())).toBeLessThan(arrivalBefore);
  });
  await type(whatIf, "0");
  await check("Contributing nothing pushes it later", async () => {
    await expect(answer).toContainText(/depois|não chega/);
  });

  await scene("Editar meta", "The plan behind the rings");
  const form = dialog(page, "Meta de liberdade financeira");
  const contribution = fieldWith(form, "Aporte mensal").locator("input");
  const save = form.getByRole("button", { name: "Salvar meta" });
  await page.getByRole("button", { name: "Editar meta" }).click();
  const original = readNumber(await contribution.inputValue());
  await say(`Aporte mensal goes from R$ ${writeNumber(original)} to R$ ${writeNumber(TYPED)}`);
  await type(contribution, writeNumber(TYPED));
  await save.click();
  await check(`Saved: the arrival is earlier, contributing R$ ${writeNumber(TYPED)} a month`, async () => {
    await expect(toast(page, "Meta salva")).toBeVisible();
    await expect(form).toBeHidden();
    await expect(page.getByText(`aportando R$ ${writeNumber(TYPED)}/mês`, { exact: false })).toBeVisible();
    await expect.poll(async () => yearIn(await arrival.innerText())).toBeLessThanOrEqual(arrivalBefore);
  });
  // The first "Meta salva" would answer for the second save.
  await expect(toast(page, "Meta salva")).toHaveCount(0);
  await page.getByRole("button", { name: "Editar meta" }).click();
  await type(contribution, writeNumber(original));
  await save.click();
  await check("Put back: the arrival reads as it did", async () => {
    await expect(toast(page, "Meta salva")).toBeVisible();
    await expect(arrival).toHaveText(String(arrivalBefore));
  });

  await scene("Marcos no caminho", "Add a milestone, see its year, take it out");
  const milestones = page.getByRole("region", { name: "Marcos no caminho" });
  await milestones.getByRole("button", { name: "+ Marco" }).click();
  const add = dialog(page, "Novo marco");
  await type(add.getByLabel("Nome"), MILESTONE);
  await add.getByRole("radio", { name: /^Patrimônio/ }).click();
  await type(add.getByLabel("Valor"), "3.000.000");
  await add.getByRole("button", { name: "Adicionar" }).click();
  const chip = milestones.locator(`[data-milestone="${MILESTONE}"]`);
  await check(`"${MILESTONE}" shows up with the year the trunk reaches R$ 3 mi`, async () => {
    await expect(toast(page, `Marco “${MILESTONE}” adicionado`)).toBeVisible();
    await expect(chip).toBeVisible();
    await expect(chip).toContainText(/20\d\d/);
  });
  await chip.getByRole("button", { name: `Remover o marco “${MILESTONE}”` }).click();
  await check("Removed with ×, with an undo in the toast", async () => {
    await expect(toast(page, `Marco “${MILESTONE}” removido`)).toBeVisible();
    await expect(chip).toHaveCount(0);
  });

  await scene("Old links", "/fire opens the new screen");
  await page.goto("/fire");
  await check("/fire lands on Liberdade financeira", async () => {
    await expect(page).toHaveURL(/\/investments\/fire$/);
    await expect(trunk).toBeVisible();
  });
});
