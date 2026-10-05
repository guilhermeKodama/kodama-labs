import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { getAccountSettings, getUserSettings, updateAccountSettings, updateUserSettings } from "../settings";

const USER = "test-user-mcp-settings-001";
const MISSING = "00000000-0000-0000-0000-000000000000";
let f: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

const addEntry = (accountId: string) => createEntry(USER, { kind: "expense", accountId, amount: 10, date: "2026-09-01", description: "x" }, prisma);

describe("user settings", () => {
  it("reads settings and rejects an unknown user", async () => {
    expect(await getUserSettings(USER, prisma)).toEqual({ baseCurrency: "BRL", theme: "system", dateFormat: "yyyy-MM-dd", numberFormat: "en-US", timezone: "America/Sao_Paulo" });
    await expect(getUserSettings("nobody", prisma)).rejects.toThrow(/User not found/);
  });

  it("requires force to change the base currency once there are entries", async () => {
    await addEntry(f.pfChecking);
    await expect(updateUserSettings(USER, { baseCurrency: "USD" }, prisma)).rejects.toThrow(/force: true/);
    expect((await updateUserSettings(USER, { baseCurrency: "USD", force: true }, prisma)).baseCurrency).toBe("USD");
  });

  it("updates only the given fields", async () => {
    const r = await updateUserSettings(USER, { theme: "dark", numberFormat: "pt-BR" }, prisma);
    expect(r).toMatchObject({ theme: "dark", numberFormat: "pt-BR", baseCurrency: "BRL", dateFormat: "yyyy-MM-dd" });
  });
});

describe("account (entity) settings", () => {
  it("reads personal and business settings, with the main account's opening balance", async () => {
    await prisma.account.update({ where: { id: f.pjChecking }, data: { initialBalance: 1500 } });
    expect(await getAccountSettings(USER, f.pfId, "personal", prisma)).toMatchObject({ id: f.pfId, name: "Personal", entityType: "personal", initialBalance: 0 });
    expect(await getAccountSettings(USER, f.pjId, "business", prisma)).toMatchObject({ id: f.pjId, name: "Kodama LTDA", entityType: "business", initialBalance: 1500 });
    await expect(getAccountSettings(USER, MISSING, "personal", prisma)).rejects.toThrow(/Personal account not found/);
    await expect(getAccountSettings(USER, f.pfId, "business", prisma)).rejects.toThrow(/Business account not found/);
  });

  it("updates business name, description, color, tax rate and opening balance", async () => {
    const r = await updateAccountSettings(USER, f.pjId, "business", { name: "Kodama Labs", description: "Dev", color: "#000", taxRate: 0.06, initialBalance: 200 }, prisma);
    expect(r).toMatchObject({ name: "Kodama Labs", description: "Dev", color: "#000", taxRate: 0.06, initialBalance: 200 });
  });

  it("requires force to change the default currency of an entity with entries, and leaves the entries alone", async () => {
    await addEntry(f.pjChecking);
    await expect(updateAccountSettings(USER, f.pjId, "business", { defaultCurrency: "USD" }, prisma)).rejects.toThrow(/force:true/);
    const r = await updateAccountSettings(USER, f.pjId, "business", { defaultCurrency: "USD", force: true }, prisma);
    expect(r.defaultCurrency).toBe("USD");
    const [e] = await prisma.ledgerEntry.findMany({ where: { accountId: f.pjChecking } });
    expect([e.currency, Number(e.amountBase)]).toEqual(["BRL", -10]);
    expect((await updateAccountSettings(USER, f.pfId, "personal", { defaultCurrency: "EUR" }, prisma)).defaultCurrency).toBe("EUR");
  });

  it("rejects unknown entities", async () => {
    await expect(updateAccountSettings(USER, MISSING, "business", { name: "x" }, prisma)).rejects.toThrow(/Business account not found/);
  });
});
