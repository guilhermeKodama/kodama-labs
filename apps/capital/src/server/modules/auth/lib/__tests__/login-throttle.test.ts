import { describe, expect, it } from "vitest";
import { clientAddress, LOGIN_WINDOW_MS, LoginThrottle, MAX_FAILURES_PER_ACCOUNT, MAX_FAILURES_PER_ADDRESS } from "../login-throttle";

const T0 = 1_000_000;

describe("LoginThrottle", () => {
  it("lets an account fail a few times, then makes it wait until the oldest failure leaves the window", () => {
    const throttle = new LoginThrottle();
    for (let i = 0; i < MAX_FAILURES_PER_ACCOUNT; i++) {
      expect(throttle.retryAfterMs("1.1.1.1", "a@x.com", T0 + i)).toBe(0);
      throttle.recordFailure("1.1.1.1", "a@x.com", T0 + i);
    }
    expect(throttle.retryAfterMs("1.1.1.1", "A@x.com ", T0 + 10)).toBe(LOGIN_WINDOW_MS - 10);
    expect(throttle.retryAfterMs("1.1.1.1", "a@x.com", T0 + LOGIN_WINDOW_MS)).toBe(0);
  });

  it("keeps accounts apart, and a success clears the account", () => {
    const throttle = new LoginThrottle();
    for (let i = 0; i < MAX_FAILURES_PER_ACCOUNT; i++) throttle.recordFailure("1.1.1.1", "a@x.com", T0);
    expect(throttle.retryAfterMs("1.1.1.1", "b@x.com", T0)).toBe(0);
    expect(throttle.retryAfterMs("2.2.2.2", "a@x.com", T0)).toBe(0);
    throttle.recordSuccess("1.1.1.1", "a@x.com");
    expect(throttle.retryAfterMs("1.1.1.1", "a@x.com", T0)).toBe(0);
  });

  it("limits one address trying many accounts", () => {
    const throttle = new LoginThrottle();
    for (let i = 0; i < MAX_FAILURES_PER_ADDRESS; i++) throttle.recordFailure("1.1.1.1", `user${i}@x.com`, T0);
    expect(throttle.retryAfterMs("1.1.1.1", "new@x.com", T0)).toBeGreaterThan(0);
    expect(throttle.retryAfterMs("2.2.2.2", "new@x.com", T0)).toBe(0);
  });
});

describe("clientAddress", () => {
  const headers = (h: Record<string, string>) => (name: string) => h[name];
  it("prefers Cloudflare's header, then the first forwarded hop", () => {
    expect(clientAddress(headers({ "cf-connecting-ip": "9.9.9.9", "x-forwarded-for": "1.1.1.1" }))).toBe("9.9.9.9");
    expect(clientAddress(headers({ "x-forwarded-for": "1.1.1.1, 10.0.0.1" }))).toBe("1.1.1.1");
    expect(clientAddress(headers({}))).toBe("unknown");
  });
});
