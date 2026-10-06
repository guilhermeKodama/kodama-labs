import { describe, expect, it } from "vitest";
import { icuArguments } from "@/lib/i18n/icu";

describe("icuArguments", () => {
  it("lists simple and formatted arguments", () => {
    expect(icuArguments("Nada aqui")).toEqual([]);
    expect(icuArguments("+ Criar “{name}”")).toEqual(["name"]);
    expect(icuArguments("{code} em {accounts} contas e {entries} lançamentos")).toEqual(["accounts", "code", "entries"]);
    expect(icuArguments("{value, number, ::currency/BRL} em {when, date, short}")).toEqual(["value", "when"]);
    expect(icuArguments("{ name }")).toEqual(["name"]);
  });

  it("reads arguments inside plural and select branches", () => {
    expect(icuArguments("{count, plural, one {# lançamento de {name}} other {# lançamentos}}")).toEqual(["count", "name"]);
    expect(icuArguments("{kind, select, in {Entrada de {who}} other {Saída}}")).toEqual(["kind", "who"]);
    expect(icuArguments("{n, plural, offset:1 =0 {ninguém} other {# e {first}}}")).toEqual(["first", "n"]);
  });

  it("follows ICU quoting", () => {
    expect(icuArguments("can't")).toEqual([]);
    expect(icuArguments("It''s {name}")).toEqual(["name"]);
    expect(icuArguments("'{literal}' and {real}")).toEqual(["real"]);
    expect(icuArguments("{n, plural, other {'#' is # and '{x}'}}")).toEqual(["n"]);
  });

  it("rejects messages next-intl could not parse", () => {
    expect(() => icuArguments("{name")).toThrow();
    expect(() => icuArguments("name}")).toThrow();
    expect(() => icuArguments("{}")).toThrow();
    expect(() => icuArguments("{n, plural, }")).toThrow();
    expect(() => icuArguments("{n, plural, one {x}")).toThrow();
    expect(() => icuArguments("'{unterminated")).toThrow();
  });
});
