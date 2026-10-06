import { describe, expect, it } from "vitest";
import {
  authRedirectTarget,
  authSwitchHref,
  credentialsBody,
  invalidCredentialFields,
  MIN_PASSWORD_LENGTH,
  validateCredentials,
} from "@/lib/shell/auth";
import { loginPath } from "@/lib/middleware-helpers";

const query = (redirect: string) => `?redirect=${encodeURIComponent(redirect)}`;

describe("after signing in", () => {
  it("returns to the page the session ended on", () => {
    expect(authRedirectTarget(query("/transactions?view=v1&entry=e1"))).toBe("/transactions?view=v1&entry=e1");
    expect(authRedirectTarget(new URLSearchParams({ redirect: "/investments/contributions?scope=pj" }))).toBe("/investments/contributions?scope=pj");
    // What the session-expiry handler and the middleware produce.
    const from = "/transactions/budgets?mode=year&y=2026";
    expect(authRedirectTarget(loginPath(from).slice("/login".length))).toBe(from);
  });

  it("never leaves the app, nor loops back to the auth pages", () => {
    for (const redirect of ["https://evil.example", "//evil.example", "/\\evil.example", "/\t/evil.example", "javascript:alert(1)", "/login", "/signup?redirect=%2Fx", "/"]) {
      expect(authRedirectTarget(query(redirect)), redirect).toBe("/transactions");
    }
    expect(authRedirectTarget("")).toBe("/transactions");
    expect(authRedirectTarget("?other=1")).toBe("/transactions");
  });
});

describe("switching between login and signup", () => {
  it("keeps a safe redirect", () => {
    expect(authSwitchHref("signup", query("/investments?scope=pj"))).toBe(`/signup?redirect=${encodeURIComponent("/investments?scope=pj")}`);
    expect(authSwitchHref("login", query("/settings?page=fx"))).toBe(`/login?redirect=${encodeURIComponent("/settings?page=fx")}`);
  });

  it("drops an unsafe or missing one", () => {
    expect(authSwitchHref("signup", query("https://evil.example"))).toBe("/signup");
    expect(authSwitchHref("signup", query("/login"))).toBe("/signup");
    expect(authSwitchHref("login", "")).toBe("/login");
  });
});

describe("validateCredentials", () => {
  const ok = { name: "Guilherme", email: "g@kodama.dev", password: "12345678" };

  it("passes good input", () => {
    expect(validateCredentials("signup", ok)).toEqual({});
    expect(validateCredentials("login", { ...ok, name: "" })).toEqual({});
  });

  it("requires every field of the page", () => {
    expect(validateCredentials("signup", { name: " ", email: "", password: "" })).toEqual({ name: "required", email: "required", password: "required" });
    expect(validateCredentials("login", { name: "", email: "", password: "" })).toEqual({ email: "required", password: "required" });
  });

  it("checks the e-mail shape", () => {
    for (const email of ["g", "g@", "g@kodama", "g kodama@x.com"]) {
      expect(validateCredentials("login", { ...ok, email }).email, email).toBe("email");
    }
    expect(validateCredentials("login", { ...ok, email: "  g@kodama.dev " })).toEqual({});
  });

  it("asks for a long password only at signup", () => {
    const short = "x".repeat(MIN_PASSWORD_LENGTH - 1);
    expect(validateCredentials("signup", { ...ok, password: short })).toEqual({ password: "passwordLength" });
    expect(validateCredentials("login", { ...ok, password: short })).toEqual({});
  });
});

describe("request bodies", () => {
  it("trims, and sends the form's language at signup", () => {
    const input = { name: " Ana ", email: " ana@x.com ", password: " secret12 " };
    expect(credentialsBody("login", input, "en")).toEqual({ email: "ana@x.com", password: " secret12 " });
    expect(credentialsBody("signup", input, "en")).toEqual({ name: "Ana", email: "ana@x.com", password: " secret12 ", locale: "en" });
  });

  it("marks the fields a failed request names", () => {
    const issues = ["email", "password", "baseCurrency", "name.0", ""].map((path) => ({ path }));
    expect([...invalidCredentialFields({ code: "validation", issues })]).toEqual(["email", "password", "name"]);
    expect([...invalidCredentialFields({ code: "auth.email_taken", issues: [] })]).toEqual(["email"]);
    expect([...invalidCredentialFields({ code: "auth.invalid_credentials" })]).toEqual([]);
  });
});
