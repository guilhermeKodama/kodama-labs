import { expect, flow } from "@repo/proof-video";
import { dialog, field, fieldWith, panel, readNumber, toast, writeNumber } from "../helpers";

/** The monthly contribution the flow sets, and takes back at the end. */
const TYPED = 18500;

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "Projeção: jan/2036 mantendo…" as a month count, so two projections compare. */
function reachedIn(sentence: string): number {
  const match = /^Projeção: ([a-zç]{3})\.?\/(\d{4}) /.exec(sentence);
  if (!match) throw new Error(`No projected month in "${sentence}"`);
  return Number(match[2]) * 12 + MONTHS.indexOf(match[1]);
}

flow("Change the financial independence goal and put it back", async ({ page, scene, say, check, type }) => {
  await page.goto("/investments/contributions");
  // The KPI sits at the top of the page and the panel at its foot: a check on one needs it scrolled into view.
  const goalLine = page.getByText(/^Meta \(plano FIRE\):/);
  const fire = panel(page, "Independência financeira");
  const projection = fire.getByText(/^Projeção:/);
  const form = dialog(page, "Meta de independência financeira");
  const contribution = fieldWith(form, "Aporte mensal").locator("input");
  const save = form.getByRole("button", { name: "Salvar meta" });

  await scene("The goal as it is", "A monthly contribution and the month it leads to");
  await say("The month's KPI is measured against the plan's contribution");
  // The sentence is whole when its second half ("Com R$ … /mês: …") has arrived, with a later request.
  await expect(projection).toContainText("Com R$");
  const goalBefore = await goalLine.innerText();
  const projectionBefore = await projection.innerText();
  const original = readNumber(goalBefore);
  await say("Editar meta opens the plan behind that number");
  await fire.getByRole("button", { name: "Editar meta" }).click();
  await check(`The plan opens with the R$ ${writeNumber(original)} a month the KPI shows`, async () => {
    await expect(contribution).toHaveValue(writeNumber(original));
    await expect(projection).toContainText(`mantendo R$ ${writeNumber(original)}/mês`);
    for (const label of ["Renda mensal desejada", "Retorno nominal ao ano (%)", "Inflação ao ano (%)", "Taxa de retirada (%)"]) {
      await expect(field(form, label).locator("input")).not.toHaveValue("");
    }
  });

  await scene("Contribute more each month");
  await say(`Aporte mensal goes from R$ ${writeNumber(original)} to R$ ${writeNumber(TYPED)}`);
  await type(contribution, writeNumber(TYPED));
  await save.click();
  await check(`Saved: the projection keeps R$ ${writeNumber(TYPED)} a month and is earlier`, async () => {
    await expect(toast(page, "Meta salva")).toBeVisible();
    await expect(form).toBeHidden();
    await expect(projection).toContainText(`mantendo R$ ${writeNumber(TYPED)}/mês`);
    await expect(projection).not.toHaveText(projectionBefore);
    await expect.poll(async () => reachedIn(await projection.innerText())).toBeLessThan(reachedIn(projectionBefore));
  });
  await goalLine.scrollIntoViewIfNeeded();
  await check(`The month's KPI is now measured against R$ ${writeNumber(TYPED)}`, async () => {
    await expect(goalLine).toHaveText(`Meta (plano FIRE): R$ ${writeNumber(TYPED)}`);
  });

  await scene("Put the goal back", "Later flows read the same plan the demo data has");
  // The first "Meta salva" would answer for the second save.
  await expect(toast(page, "Meta salva")).toHaveCount(0);
  await fire.getByRole("button", { name: "Editar meta" }).click();
  await expect(contribution).toHaveValue(writeNumber(TYPED));
  await type(contribution, writeNumber(original));
  await save.click();
  await check("The projection reads exactly as it did at the start", async () => {
    await expect(toast(page, "Meta salva")).toBeVisible();
    await expect(projection).toHaveText(projectionBefore);
  });
  await goalLine.scrollIntoViewIfNeeded();
  await check(`The month's KPI is back at R$ ${writeNumber(original)}`, async () => {
    await expect(goalLine).toHaveText(goalBefore);
  });
});
