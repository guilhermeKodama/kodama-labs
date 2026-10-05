import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { viewConfigSchema } from "../../contracts";
import { createEntry, getEntry } from "../entries";
import { createView, duplicateView } from "../views";

/** Strings the server writes follow User.locale (src/server/i18n); pt-BR is the default. */
const USER = "test-user-ledger-localized-001";
let f: LedgerFixture;

beforeAll(async () => {
  f = await createLedgerFixture(prisma, USER);
});
afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

async function transferDescription() {
  const { entryIds } = await createEntry(USER, { kind: "transfer", fromAccountId: f.pjChecking, toAccountId: f.pfChecking, amount: 100, date: "2026-09-10" }, prisma);
  return (await getEntry(USER, entryIds[0], prisma)).description;
}

describe("localized server strings", () => {
  it("describes a transfer created without a description in the user's locale", async () => {
    expect(await transferDescription()).toBe("Distribuição de lucros: Conta principal → Conta principal");
    await prisma.user.update({ where: { id: USER }, data: { locale: "en" } });
    expect(await transferDescription()).toBe("Profit distribution: Conta principal → Conta principal");
    await prisma.user.update({ where: { id: USER }, data: { locale: "pt-BR" } });
  });

  it("suffixes a duplicated view's name in the user's locale", async () => {
    const view = await createView(USER, { name: "Mercado", dataset: "ledger", isFavorite: true, config: viewConfigSchema.parse({}) }, prisma);
    expect((await duplicateView(USER, view.id, prisma)).name).toBe("Mercado (cópia)");
    await prisma.user.update({ where: { id: USER }, data: { locale: "en" } });
    expect((await duplicateView(USER, view.id, prisma)).name).toBe("Mercado (copy)");
    expect((await duplicateView(USER, view.id, prisma, "Outra")).name).toBe("Outra");
    await prisma.user.update({ where: { id: USER }, data: { locale: "pt-BR" } });
  });
});
