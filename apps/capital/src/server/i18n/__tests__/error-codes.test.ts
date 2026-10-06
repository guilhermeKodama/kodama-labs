import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ERROR_CODE_LIST, ERROR_CODES, errorParamNames, isErrorCode } from "../error-codes";

const SERVER_DIR = path.resolve(__dirname, "../..");

function serverSources(dir = SERVER_DIR): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const full = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === "__tests__" ? [] : serverSources(full);
    return d.name.endsWith(".ts") ? [full] : [];
  });
}

describe("error codes", () => {
  it("are lower_snake 'domain.reason' keys (or one generic word)", () => {
    for (const code of ERROR_CODE_LIST) expect(code).toMatch(/^[a-z_]+(\.[a-z_]+)?$/);
  });

  it("never use one code as the domain of another, so errors.<code> nests cleanly in next-intl messages", () => {
    const domains = new Set(ERROR_CODE_LIST.filter((c) => c.includes(".")).map((c) => c.split(".")[0]));
    expect(ERROR_CODE_LIST.filter((c) => !c.includes(".") && domains.has(c))).toEqual([]);
  });

  it("list the params of each meaning", () => {
    expect(errorParamNames("category.archived")).toEqual(["name"]);
    expect(errorParamNames("query.aggregation_needs_numeric")).toEqual(["fn", "field"]);
    expect(errorParamNames("view.not_found")).toEqual([]);
    expect(isErrorCode("category.archived")).toBe(true);
    expect(isErrorCode("category.nope")).toBe(false);
    expect(isErrorCode("toString")).toBe(false);
  });

  it("are each sent by some server code (no dead entries in the catalog)", () => {
    const catalog = path.join(SERVER_DIR, "i18n", "error-codes.ts");
    const source = serverSources()
      .filter((f) => f !== catalog)
      .map((f) => fs.readFileSync(f, "utf8"))
      .join("\n");
    const unused = Object.keys(ERROR_CODES).filter((code) => !source.includes(`"${code}"`));
    expect(unused).toEqual([]);
  });
});
