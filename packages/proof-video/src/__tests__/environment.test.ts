import { describe, expect, it } from "vitest";
import { portFromPath, slugFromPath } from "../checkout";
import { assertProofDatabase, proofDatabaseUrl } from "../database";
import { masker } from "../terminal";

describe("checkout", () => {
  it("turns the folder name into a database-safe slug", () => {
    expect(slugFromPath("/repo/.claude/worktrees/capital-ui-followups")).toBe("capital_ui_followups");
    expect(slugFromPath("/Users/me/My Project (2)")).toBe("my_project_2");
    expect(slugFromPath("/")).toBe("checkout");
  });

  it("cuts a long name without leaving a trailing underscore", () => {
    const slug = slugFromPath("/x/a-very-long-worktree-name-that-keeps-going-and-going", 20);
    expect(slug.length).toBeLessThanOrEqual(20);
    expect(slug.endsWith("_")).toBe(false);
  });

  it("gives one checkout one port and keeps it in range", () => {
    const port = portFromPath("/repo/a");
    expect(portFromPath("/repo/a")).toBe(port);
    expect(port).toBeGreaterThanOrEqual(3200);
    expect(port).toBeLessThan(3900);
    expect(new Set(["/repo/a", "/repo/b", "/repo/c", "/repo/d"].map((dir) => portFromPath(dir))).size).toBeGreaterThan(1);
  });
});

describe("proof database", () => {
  const source = "postgresql://user:secret@localhost:5433/capital_dev?schema=public";

  it("keeps the server and login and swaps only the database name", () => {
    expect(proofDatabaseUrl(source, "capital", "my_checkout")).toBe(
      "postgresql://user:secret@localhost:5433/capital_proof_my_checkout_dev?schema=public",
    );
  });

  it("refuses a server that is not local", () => {
    expect(() => proofDatabaseUrl("postgresql://user:secret@db.internal:5432/capital_dev", "capital", "x")).toThrow(/only use a local server/);
  });

  it("drops connection parameters that could point somewhere else", () => {
    const derived = proofDatabaseUrl("postgresql://user:secret@localhost:5433/capital_dev?host=db.internal&schema=app&sslmode=require", "capital", "x");
    expect(derived).toBe("postgresql://user:secret@localhost:5433/capital_proof_x_dev?schema=app");
  });

  it("refuses a host parameter that is not local", () => {
    expect(() => assertProofDatabase("postgresql://user:secret@localhost:5433/capital_proof_x_dev?host=db.internal", "capital")).toThrow(
      /only use a local server/,
    );
  });

  it("does not quote an unparseable URL back", () => {
    expect(() => proofDatabaseUrl("postgresql://user:sec ret@:x/capital_dev", "capital", "x")).toThrow("[proof] The database URL cannot be parsed.");
  });

  it.each(["capital", "capital_dev", "capital_test", "capital_proof_x", "capital_proof__dev", "sentinel_proof_x_dev", "capital_proof_X_dev"])(
    "refuses the database %s",
    (name) => {
      expect(() => assertProofDatabase(`postgresql://user:secret@localhost:5433/${name}`, "capital")).toThrow(/Refusing the database/);
    },
  );

  it("accepts this app's proof database", () => {
    expect(() => assertProofDatabase("postgresql://user:secret@127.0.0.1:5433/capital_proof_a_b_dev", "capital")).not.toThrow();
  });

  it("never echoes credentials in its errors", () => {
    try {
      assertProofDatabase("postgresql://user:secret@db.internal:5432/capital", "capital");
    } catch (error) {
      expect(String(error)).not.toContain("secret");
    }
  });
});

describe("terminal masking", () => {
  it("hides values of secret-looking variables and URL credentials", () => {
    const mask = masker({ DATABASE_URL: "postgresql://root:hunter22@localhost:5433/x_dev", API_TOKEN: "tok_123456", HOME: "/Users/me" });
    expect(mask("connecting to postgresql://root:hunter22@localhost:5433/x_dev")).toBe("connecting to ***");
    expect(mask("token tok_123456 in /Users/me")).toBe("token *** in /Users/me");
    expect(mask("see https://someone:pw12345@example.com/path")).toBe("see https://***@example.com/path");
    expect(mask("clone https://ghp_abc123@github.com/me/repo.git")).toBe("clone https://***@github.com/me/repo.git");
    expect(mask("open https://example.com/users/me@example.com")).toBe("open https://example.com/users/me@example.com");
  });

  it("treats session, cookie and pass-named variables as secrets", () => {
    const mask = masker({ SESSION_ID: "sess-123456", DB_PASS: "hunter2222", AUTH_COOKIE: "cookie-abcdef" });
    expect(mask("sess-123456 hunter2222 cookie-abcdef")).toBe("*** *** ***");
  });

  it("hides the extra strings it is given and leaves short values alone", () => {
    const mask = masker({ SECRET: "abc" }, ["one-off-password"]);
    expect(mask("abc one-off-password")).toBe("abc ***");
  });
});
