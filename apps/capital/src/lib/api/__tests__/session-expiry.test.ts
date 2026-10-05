import { describe, expect, it, vi } from "vitest";
import { ApiError, parseApiError } from "@/lib/api/client";
import { createSessionExpiry, isSessionExpired } from "@/lib/api/session-expiry";

function setup(currentUrl = "/transactions?view=v1") {
  let finishLogout: () => void = () => undefined;
  const deps = {
    logout: vi.fn(() => new Promise<void>((resolve) => (finishLogout = resolve))),
    clear: vi.fn(),
    navigate: vi.fn(),
    currentUrl: vi.fn(() => currentUrl),
  };
  return { deps, expiry: createSessionExpiry(deps), finishLogout: () => finishLogout() };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const expired = () => parseApiError(401, { message: "Session expired or invalid", code: "auth.session_invalid" });

describe("isSessionExpired", () => {
  it("is a 401 that is not a wrong password", () => {
    expect(isSessionExpired(expired())).toBe(true);
    expect(isSessionExpired(parseApiError(401, {}))).toBe(true);
    expect(isSessionExpired(parseApiError(401, { code: "auth.invalid_credentials" }))).toBe(false);
    expect(isSessionExpired(parseApiError(403, {}))).toBe(false);
    expect(isSessionExpired(new ApiError({ status: 0, message: "offline" }))).toBe(false);
    expect(isSessionExpired(new Error("401"))).toBe(false);
  });
});

describe("createSessionExpiry", () => {
  it("logs out, clears the cache and goes to login with the way back", async () => {
    const { deps, expiry, finishLogout } = setup();
    expect(expiry.handle(expired())).toBe(true);
    expect(deps.logout).toHaveBeenCalledOnce();
    expect(deps.clear).not.toHaveBeenCalled();
    finishLogout();
    await flush();
    expect(deps.clear).toHaveBeenCalledOnce();
    expect(deps.navigate).toHaveBeenCalledWith("/login?redirect=%2Ftransactions%3Fview%3Dv1");
  });

  it("acts once however many requests fail together", async () => {
    const { deps, expiry, finishLogout } = setup();
    expect([expiry.handle(expired()), expiry.handle(expired()), expiry.handle(expired())]).toEqual([true, false, false]);
    finishLogout();
    await flush();
    expiry.handle(expired());
    await flush();
    expect(deps.logout).toHaveBeenCalledOnce();
    expect(deps.navigate).toHaveBeenCalledOnce();
  });

  it("acts again after the user signed back in", async () => {
    const { deps, expiry, finishLogout } = setup();
    expiry.handle(expired());
    finishLogout();
    await flush();
    expiry.reset();
    expect(expiry.handle(expired())).toBe(true);
    expect(deps.logout).toHaveBeenCalledTimes(2);
  });

  it("still leaves when the logout call fails", async () => {
    const { deps, expiry } = setup();
    deps.logout.mockImplementationOnce(() => Promise.reject(new Error("offline")));
    expiry.handle(expired());
    await flush();
    expect(deps.clear).toHaveBeenCalledOnce();
    expect(deps.navigate).toHaveBeenCalledOnce();
  });

  it("ignores other errors and the login pages", () => {
    const { deps, expiry } = setup();
    expect(expiry.handle(parseApiError(500, {}))).toBe(false);
    expect(expiry.handle(parseApiError(401, { code: "auth.invalid_credentials" }))).toBe(false);
    const onLogin = setup("/login?redirect=%2Ftransactions");
    expect(onLogin.expiry.handle(expired())).toBe(false);
    expect(deps.logout).not.toHaveBeenCalled();
    expect(onLogin.deps.logout).not.toHaveBeenCalled();
  });

  it("signs out on request, to the plain login page, and ignores the 401s that follow", async () => {
    const { deps, expiry, finishLogout } = setup();
    expiry.signOut();
    expect(expiry.handle(expired())).toBe(false);
    finishLogout();
    await flush();
    expect(deps.clear).toHaveBeenCalledOnce();
    expect(deps.navigate).toHaveBeenCalledWith("/login");
    expect(deps.logout).toHaveBeenCalledOnce();
  });
});
