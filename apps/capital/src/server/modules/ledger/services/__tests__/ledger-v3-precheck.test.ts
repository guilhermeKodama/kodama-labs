import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { psql, testDatabase } from "@/test/psql";

const precheckPath = path.resolve(__dirname, "../../../../../../scripts/precheck-ledger-v3.sql");
const precheckSql = fs.readFileSync(precheckPath, "utf8");

describe("ledger v3 precheck", () => {
  it("is a read-only script", () => {
    const stripped = precheckSql.replace(/--.*$/gm, "").replace(/\\echo[^\n]*/g, "");
    expect(stripped).toMatch(/BEGIN READ ONLY/);
    expect(stripped).toMatch(/\bROLLBACK\b/);
    for (const word of ["INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE", "TRUNCATE", "RAISE", "COPY", "COMMIT"]) {
      expect(stripped).not.toMatch(new RegExp(`\\b${word}\\b`));
    }
    // psql meta-commands other than \echo can write files or run SQL outside the transaction.
    expect(stripped).not.toMatch(/\\[a-z!]/i);
  });

  it("runs against the current schema", () => {
    const result = psql(testDatabase(), ["-q"], precheckSql);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    for (const section of ["== 1a.", "== 1m.", "== 2e.", "== 3e."]) expect(result.stdout).toContain(section);
  });
});
