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

describe("LoginThrottle memory", () => {
  const sizeOf = (throttle: LoginThrottle) => (throttle as unknown as { failures: Map<string, number[]> }).failures.size;

  it("drops the keys whose failures all left the window once the map holds a thousand, keeping the recent ones", () => {
    const throttle = new LoginThrottle();
    // 500 addresses, each failing once for one account: an account key and an address key apiece.
    for (let i = 0; i < 500; i++) throttle.recordFailure(`10.0.${Math.floor(i / 250)}.${i % 250}`, "a@x.com", T0);
    expect(sizeOf(throttle)).toBe(1000);

    const later = T0 + LOGIN_WINDOW_MS + 1;
    throttle.recordFailure("9.9.9.9", "b@x.com", later);
    // Only the two keys of the failure just recorded are left.
    expect(sizeOf(throttle)).toBe(2);
    expect(throttle.retryAfterMs("10.0.0.1", "a@x.com", later)).toBe(0);
  });

  it("keeps everything while the map is small, even keys that expired", () => {
    const throttle = new LoginThrottle();
    throttle.recordFailure("1.1.1.1", "a@x.com", T0);
    throttle.recordFailure("2.2.2.2", "b@x.com", T0 + LOGIN_WINDOW_MS + 1);
    expect(sizeOf(throttle)).toBe(4);
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
