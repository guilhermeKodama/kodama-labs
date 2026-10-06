import { describe, expect, it } from "vitest";
import { createFormatter } from "@/lib/format";
import { limitShare, parseDay } from "../card";
import { encodeDeviceLabel, parseDeviceLabel } from "../device";
import { entityKindLabel } from "../entity-kind";
import { accountForm, accountSave, entityBody, entityForm } from "../forms";
import { basePerUnit, manualRateFromBase, rateDigits } from "../fx";
import { DEFAULT_SETTINGS_PAGE, resolveSettingsPage, SETTINGS_PAGES, settingsHref } from "../nav";
import { paletteHex, paletteName, swatchColor } from "../palette";

const fmt = createFormatter();
const format = (n: number) => fmt.number(n, 2);
const parse = (s: string) => fmt.parseNumber(s);

describe("settings navigation", () => {
  it("lists the mockup pages in order and falls back to Perfil", () => {
    expect(SETTINGS_PAGES).toEqual(["prefs", "notif", "ent", "bank", "card", "broker", "cat", "rules", "fx", "imports", "api"]);
    expect(resolveSettingsPage("cat")).toBe("cat");
    expect(resolveSettingsPage("trash")).toBe(DEFAULT_SETTINGS_PAGE);
    expect(resolveSettingsPage(null)).toBe("prefs");
    expect(settingsHref("card", "acc-1")).toBe("/settings?page=card&id=acc-1");
  });
});

describe("palette", () => {
  it("maps stored hex values to theme tokens", () => {
    expect(paletteName("#2563EB")).toBe("blue");
    expect(paletteName("blue")).toBe("blue");
    expect(paletteName("#123456")).toBeNull();
    expect(paletteHex("purple")).toBe("#7c3aed");
    expect(swatchColor("#2563eb")).toBe("var(--cap-cat-blue)");
    expect(swatchColor("#123456")).toBe("#123456");
    expect(swatchColor(null)).toBe("var(--cap-text-4)");
  });
});

describe("entity kind label", () => {
  it("derives the country from the default currency", () => {
    expect(entityKindLabel({ kind: "personal", defaultCurrency: "BRL" })).toEqual({ key: "personal" });
    expect(entityKindLabel({ kind: "business", defaultCurrency: "BRL" })).toEqual({ key: "businessBR" });
    expect(entityKindLabel({ kind: "business", defaultCurrency: "usd" })).toEqual({ key: "businessUS" });
    expect(entityKindLabel({ kind: "business", defaultCurrency: "EUR" })).toEqual({ key: "business", currency: "EUR" });
  });
});

describe("push device labels", () => {
  const MAC_CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
  const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
  it("encodes device, browser and installed app", () => {
    expect(encodeDeviceLabel(MAC_CHROME, false)).toBe("Mac|Chrome");
    expect(encodeDeviceLabel(IPHONE, true)).toBe("iPhone|Safari|pwa");
  });
  it("reads new and old labels", () => {
    expect(parseDeviceLabel("iPhone|Safari|pwa", null)).toEqual({ device: "iPhone", browser: "Safari", pwa: true });
    expect(parseDeviceLabel("Mac", MAC_CHROME)).toEqual({ device: "Mac", browser: "Chrome", pwa: false });
    expect(parseDeviceLabel(null, "curl/8")).toEqual({ device: "device", browser: "browser", pwa: false });
  });
});

describe("fx display", () => {
  it("shows and takes rates in the base currency", () => {
    expect(basePerUnit(0.2)).toBe(5);
    expect(basePerUnit(0)).toBeNull();
    expect(manualRateFromBase(5)).toBe(0.2);
    expect(manualRateFromBase(-1)).toBeNull();
    expect(rateDigits(5.41)).toEqual({ min: 2, max: 4 });
    expect(rateDigits(0.0001)).toEqual({ min: 2, max: 6 });
  });
});

describe("card helpers", () => {
  it("computes the limit share and day fields", () => {
    expect(limitShare(2140, 15000)).toBeCloseTo(0.1427, 3);
    expect(limitShare(-10, 15000)).toBe(0);
    expect(limitShare(100, null)).toBe(0);
    expect(parseDay("5")).toBe(5);
    expect(parseDay("32")).toBeNull();
    expect(parseDay("")).toBeNull();
  });
});

describe("entity form", () => {
  const ltda = { name: "Kodama LTDA", kind: "business" as const, description: "Simples", defaultCurrency: "BRL", taxRate: 0.06, color: "#2563eb" };
  it("starts from the entity and its main account's initial balance", () => {
    expect(entityForm(ltda, 1500, { currency: "BRL" }, format)).toEqual({ name: "Kodama LTDA", defaultCurrency: "BRL", description: "Simples", taxRate: "6,00", initialBalance: "1.500,00", color: "#2563eb" });
  });
  it("sends only what changed, the tax rate as a fraction", () => {
    const form = { ...entityForm(ltda, 1500, { currency: "BRL" }, format), taxRate: "6,5", color: "#7c3aed" };
    expect(entityBody(form, ltda, 1500, parse)).toEqual({ body: { taxRate: 0.065, color: "#7c3aed" }, invalid: [] });
    expect(entityBody({ ...form, initialBalance: "2.000,00" }, ltda, 1500, parse).body).toMatchObject({ initialBalance: 2000 });
    expect(entityBody({ ...form, taxRate: "abc" }, ltda, 1500, parse).invalid).toEqual(["taxRate"]);
  });
  it("never renames the PF", () => {
    const pf = { ...ltda, name: "PF", kind: "personal" as const };
    expect(entityBody({ ...entityForm(pf, 0, { currency: "BRL" }, format), name: "Eu" }, pf, 0, parse).body).toEqual({});
  });
});

describe("account form", () => {
  const card = {
    name: "Nubank",
    type: "credit_card" as const,
    entityId: "pf",
    currency: "BRL",
    institution: "Nubank",
    externalId: "4821",
    initialBalance: 0,
    balance: -2140,
    creditLimit: 15000,
    closingDay: 5,
    dueDay: 12,
    payFromAccountId: null,
  };
  it("validates card fields before sending", () => {
    const form = { ...accountForm(card, { entityId: "pf", currency: "BRL" }, format), closingDay: "", creditLimit: "0" };
    expect(accountSave(form, card, "credit_card", parse).invalid).toEqual(["creditLimit", "closingDay"]);
  });
  it("sends the changed fields, entity and currency included", () => {
    const form = { ...accountForm(card, { entityId: "pf", currency: "BRL" }, format), dueDay: "15", currency: "USD", entityId: "pj" };
    expect(accountSave(form, card, "credit_card", parse)).toEqual({ body: { entityId: "pj", currency: "USD", dueDay: 15 }, cash: null, invalid: [] });
  });
  it("sets a broker's cash through set-balance, and creates with the full body", () => {
    const broker = { ...card, type: "brokerage" as const, name: "XP", balance: 38400, creditLimit: null, closingDay: null, dueDay: null };
    const form = { ...accountForm(broker, { entityId: "pf", currency: "BRL" }, format), cash: "40.000,00" };
    expect(accountSave(form, broker, "brokerage", parse)).toEqual({ body: {}, cash: 40000, invalid: [] });
    const created = accountSave({ ...accountForm(null, { entityId: "pf", currency: "BRL" }, format), name: "Avenue", currency: "USD", cash: "100" }, null, "brokerage", parse);
    expect(created.body).toEqual({ name: "Avenue", institution: null, entityId: "pf", currency: "USD", externalId: null, type: "brokerage", initialBalance: 100 });
  });
});

describe("hour label", () => {
  it("writes the hour in each language's clock", async () => {
    const { hourLabel } = await import("../time");
    expect(hourLabel(9, "pt-BR")).toBe("09:00");
    expect(hourLabel(9, "en")).toBe("9:00 AM");
    expect(hourLabel(0, "en")).toBe("12:00 AM");
    expect(hourLabel(20, "en")).toBe("8:00 PM");
  });
});
