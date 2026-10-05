import { describe, expect, it } from "vitest";
import en from "@/messages/en/errors.json";
import ptBR from "@/messages/pt-BR/errors.json";
import { ApiError, parseApiError } from "@/lib/api/client";
import { errorMessage, invalidFields, resolveErrorMessage, type ErrorTranslator } from "@/lib/api/errors";

type Tree = { [key: string]: string | Tree };

/** A next-intl-like translator over the real "errors" namespace (simple {name} interpolation). */
function translator(errors: Tree): ErrorTranslator {
  const lookup = (key: string) =>
    key.split(".").reduce<string | Tree | undefined>((node, part) => (node && typeof node === "object" ? node[part] : undefined), errors);
  const t = (key: string, values?: Record<string, string | number | Date>) => {
    const message = lookup(key);
    if (typeof message !== "string") throw new Error(`missing errors.${key}`);
    return message.replace(/\{(\w+)\}/g, (_, name: string) => String(values?.[name] ?? `{${name}}`));
  };
  t.has = (key: string) => typeof lookup(key) === "string";
  return t;
}

const pt = translator(ptBR);
const english = translator(en);

const leafKeys = (tree: Tree, prefix = ""): string[] =>
  Object.entries(tree).flatMap(([key, value]) => (typeof value === "string" ? [`${prefix}${key}`] : leafKeys(value, `${prefix}${key}.`)));

describe("errorMessage", () => {
  it("uses the message of a known code", () => {
    const error = parseApiError(409, { message: "A newer change touched these rows; undo it first", code: "undo.newer_change" });
    expect(errorMessage(pt, error)).toBe("Uma alteração mais recente mexeu nessas linhas. Desfaça ela primeiro.");
    expect(errorMessage(english, error)).toBe("A newer change touched these rows. Undo that one first.");
  });

  it("falls back to the status when the code has no message", () => {
    expect(errorMessage(pt, parseApiError(404, { message: "Entry not found", code: "entry.gone_elsewhere" }))).toBe("Não encontrado. Pode ter sido excluído.");
    expect(errorMessage(pt, parseApiError(404, { error: { code: "NOT_FOUND", message: "Conversation not found" } }))).toBe(
      "Não encontrado. Pode ter sido excluído.",
    );
    expect(errorMessage(pt, parseApiError(409, { message: "Batch already undone" }))).toBe("Isso mudou enquanto você editava. Atualize e tente de novo.");
  });

  it("never shows the server's English message", () => {
    for (const status of [400, 401, 403, 404, 409, 413, 418, 422, 429, 500, 502, 503]) {
      const message = errorMessage(pt, parseApiError(status, { message: "Something English went wrong" }));
      expect(message).not.toContain("English");
      expect(message.length).toBeGreaterThan(0);
    }
  });

  it("covers validation, network and unknown errors", () => {
    expect(errorMessage(pt, parseApiError(422, { message: "x", code: "validation", issues: [{ path: "amount", code: "too_small", message: "x" }] }))).toBe(
      "Confira os campos destacados.",
    );
    expect(errorMessage(pt, new ApiError({ status: 0, code: "network", message: "Failed to fetch" }))).toBe(
      "Sem conexão com o servidor. Confira a internet e tente de novo.",
    );
    expect(errorMessage(pt, new TypeError("x is undefined"))).toBe("Algo deu errado. Tente de novo.");
    expect(errorMessage(english, "boom")).toBe("Something went wrong. Try again.");
  });

  it("maps statuses without their own message to 400 or 500", () => {
    const has = () => false;
    expect(resolveErrorMessage(new ApiError({ status: 418, message: "" }), has)).toEqual({ key: "status.400" });
    expect(resolveErrorMessage(new ApiError({ status: 503, message: "" }), has)).toEqual({ key: "status.500" });
    expect(resolveErrorMessage(new ApiError({ status: 0, message: "" }), has)).toEqual({ key: "network" });
  });

  it("passes only ICU-safe params", () => {
    const error = new ApiError({ status: 422, message: "", code: "holding.oversell", params: { ticker: "PETR4", quantity: 10, at: new Date(0), short: true, nested: { a: 1 } } });
    expect(resolveErrorMessage(error, () => true)).toEqual({
      key: "holding.oversell",
      values: { ticker: "PETR4", quantity: 10, at: new Date(0), short: "true" },
    });
    expect(resolveErrorMessage(new ApiError({ status: 422, message: "", code: "category.archived" }), () => true)).toEqual({ key: "category.archived" });
  });
});

describe("errors messages", () => {
  it("has a message for every status the fallback can pick, in both languages", () => {
    for (const status of [0, 400, 401, 403, 404, 409, 413, 418, 422, 429, 500, 503]) {
      const { key } = resolveErrorMessage(new ApiError({ status, message: "" }), () => false);
      expect(pt.has(key), key).toBe(true);
      expect(english.has(key), key).toBe(true);
    }
  });

  it("has the same keys in pt-BR and en", () => {
    expect(leafKeys(en as Tree).sort()).toEqual(leafKeys(ptBR as Tree).sort());
  });
});

describe("invalidFields", () => {
  it("lists the paths of a 422", () => {
    const error = parseApiError(422, { code: "validation", issues: [{ path: "amount" }, { path: ["legs", 1, "accountId"] }, { path: "" }] });
    expect([...invalidFields(error)]).toEqual(["amount", "legs.1.accountId"]);
    expect(invalidFields(new Error("x")).size).toBe(0);
  });
});
