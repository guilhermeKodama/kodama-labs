import { describe, expect, it } from "vitest";
import { consentState, sinceDate } from "../lib/consent";
import { accountLabel, maskAccountNumber, redactNumbers } from "../lib/mask";

const NOW = new Date("2026-10-19T15:00:00.000Z");

describe("consentState", () => {
  it("expires on USER_AUTHORIZATION_EXPIRED or a past consent date", () => {
    expect(consentState({ id: "1", status: "LOGIN_ERROR", error: { code: "USER_AUTHORIZATION_EXPIRED" } }, NOW)).toBe("expired");
    expect(consentState({ id: "1", consentExpiresAt: "2026-10-01T00:00:00.000Z" }, NOW)).toBe("expired");
    expect(consentState({ id: "1", status: "LOGIN_ERROR" }, NOW)).toBe("expired");
  });

  it("warns inside the last 30 days and otherwise stays ok", () => {
    expect(consentState({ id: "1", consentExpiresAt: "2026-11-10T00:00:00.000Z" }, NOW)).toBe("expiring");
    expect(consentState({ id: "1", status: "UPDATED", consentExpiresAt: "2027-10-19T00:00:00.000Z" }, NOW)).toBe("ok");
  });
});

describe("sinceDate", () => {
  it("uses a year on the first sync and seven days of overlap after that", () => {
    expect(sinceDate(null, NOW)).toBe("2025-10-19");
    expect(sinceDate(NOW, NOW)).toBe("2026-10-12");
  });
});

describe("mask", () => {
  it("keeps the last four digits and strips long numbers from errors", () => {
    expect(maskAccountNumber("001234567890")).toBe("••••7890");
    expect(accountLabel("Conta", "001234567890")).toBe("Conta ••••7890");
    expect(accountLabel("Conta", "001234567890")).not.toContain("1234567890");
    expect(redactNumbers("account 001234567890 failed")).toBe("account •••• failed");
    expect(redactNumbers("account 001234567890 failed")).not.toContain("123456");
  });
});
