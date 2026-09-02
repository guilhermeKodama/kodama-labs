import { describe, it, expect, afterEach } from "vitest";
import { assertNonProductionDatabase, databaseNameFromUrl } from "../db-guard";

const PROD = "postgresql://root:root@localhost:5433/capital";
const DEV = "postgresql://root:root@localhost:5433/capital_dev";
const TEST = "postgresql://root:root@localhost:5433/capital_test";

// @types/node types NODE_ENV as readonly, so reach it through a plain record view.
const mutableEnv = process.env as Record<string, string | undefined>;
const originalNodeEnv = mutableEnv.NODE_ENV;
afterEach(() => {
  mutableEnv.NODE_ENV = originalNodeEnv;
  delete process.env.CAPITAL_ALLOW_PROD_DB;
});

describe("databaseNameFromUrl", () => {
  it("extracts the database name", () => {
    expect(databaseNameFromUrl(DEV)).toBe("capital_dev");
  });

  it("ignores query params like pgbouncer/schema", () => {
    expect(databaseNameFromUrl(`${DEV}?schema=public&pgbouncer=true`)).toBe("capital_dev");
  });

  it("returns null for something unparseable", () => {
    expect(databaseNameFromUrl("not a url")).toBeNull();
  });
});

describe("assertNonProductionDatabase", () => {
  it("allows a _dev database", () => {
    expect(() => assertNonProductionDatabase(DEV, "test")).not.toThrow();
  });

  it("allows a _test database", () => {
    expect(() => assertNonProductionDatabase(TEST, "test")).not.toThrow();
  });

  it("blocks the production database", () => {
    expect(() => assertNonProductionDatabase(PROD, "test")).toThrow(/Refusing to connect/);
  });

  it("names the offending database and the caller in the error", () => {
    expect(() => assertNonProductionDatabase(PROD, "vitest")).toThrow(
      /vitest resolved the database "capital"/
    );
  });

  it("blocks anything not explicitly dev/test - allowlist, not blocklist", () => {
    // The old bug was a blocklist mindset: it only protected against the
    // names someone remembered. These must all fail.
    for (const name of ["capital", "capital_prod", "capital_production", "postgres", "main"]) {
      expect(() =>
        assertNonProductionDatabase(`postgresql://u:p@h:5433/${name}`, "test")
      ).toThrow(/Refusing to connect/);
    }
  });

  it("blocks an unparseable url rather than assuming it is safe", () => {
    expect(() => assertNonProductionDatabase("garbage", "test")).toThrow(/Refusing to connect/);
  });

  it("blocks a remote production host even with a dev-ish user", () => {
    expect(() =>
      assertNonProductionDatabase("postgresql://u:p@db.neon.tech/capital", "test")
    ).toThrow(/Refusing to connect/);
  });

  it("allows production when NODE_ENV really is production", () => {
    mutableEnv.NODE_ENV = "production";
    expect(() => assertNonProductionDatabase(PROD, "runtime")).not.toThrow();
  });

  it("allows an explicit, deliberate opt-out", () => {
    process.env.CAPITAL_ALLOW_PROD_DB = "1";
    expect(() => assertNonProductionDatabase(PROD, "one-off audit")).not.toThrow();
  });

  it("ignores a truthy-but-wrong opt-out value", () => {
    process.env.CAPITAL_ALLOW_PROD_DB = "true";
    expect(() => assertNonProductionDatabase(PROD, "test")).toThrow(/Refusing to connect/);
  });
});
