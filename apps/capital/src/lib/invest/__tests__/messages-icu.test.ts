import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "@/messages/en/invest.json";
import ptBR from "@/messages/pt-BR/invest.json";

/** Every invest message must parse as ICU and format (the mockup copy has "<", "·", "↗" and curly quotes). */
describe("invest messages", () => {
  for (const [locale, messages] of [
    ["pt-BR", ptBR],
    ["en", en],
  ] as const) {
    it(`parse and format in ${locale}`, () => {
      const failures: string[] = [];
      const t = createTranslator({ locale, messages: { invest: messages }, namespace: "invest", onError: (error) => failures.push(error.message) });
      const walk = (node: unknown, path: string) => {
        if (typeof node === "string") {
          // Every placeholder gets a value (2 also serves plurals), every rich-text tag a function.
          const values = Object.fromEntries([
            ...[...node.matchAll(/\{(\w+)/g)].map((m) => [m[1], 2]),
            ...[...node.matchAll(/<(\w+)>/g)].map((m) => [m[1], (chunks: unknown[]) => chunks.join("")]),
          ]);
          const out = (t as unknown as (key: string, values: Record<string, unknown>) => string)(path, values);
          if (!out) failures.push(`${path}: empty`);
        } else if (node && typeof node === "object") {
          for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k);
        }
      };
      walk(messages, "");
      expect(failures).toEqual([]);
    });
  }

  it("keeps the mockup's IR copy literal", () => {
    const t = createTranslator({ locale: "pt-BR", messages: { invest: ptBR }, namespace: "invest" });
    expect(t("op.ir.stocksExempt")).toBe("vendas de ações < R$ 20 mil no mês");
    expect(t("contrib.where.units", { count: 1 })).toBe("1 cota");
    expect(t("rings.whatIf.result", { year: "2036", delta: t("rings.whatIf.sooner", { years: 1 }) })).toBe("A liberdade chega em 2036, um ano antes.");
    expect(t("rings.table.more", { count: 8 })).toBe("mais 8 anéis projetados");
  });
});
