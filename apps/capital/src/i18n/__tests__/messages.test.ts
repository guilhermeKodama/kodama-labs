import { describe, expect, it } from "vitest";
import { combineNamespaces, mergeMessages, NAMESPACES } from "@/i18n/messages";
import { isLocale } from "@/i18n/routing";

describe("mergeMessages", () => {
  it("overrides leaves and keeps keys only the base has, at every depth", () => {
    const base = { a: "A", nested: { x: "X", y: "Y" }, onlyBase: { z: "Z" } };
    const override = { a: "a", nested: { y: "y" }, extra: "E" };
    expect(mergeMessages(base, override)).toEqual({ a: "a", nested: { x: "X", y: "y" }, onlyBase: { z: "Z" }, extra: "E" });
    expect(base.nested).toEqual({ x: "X", y: "Y" });
  });

  it("lets a leaf replace a subtree and the other way around", () => {
    expect(mergeMessages({ a: { b: "B" } }, { a: "A" })).toEqual({ a: "A" });
    expect(mergeMessages({ a: "A" }, { a: { b: "B" } })).toEqual({ a: { b: "B" } });
  });
});

describe("combineNamespaces", () => {
  it("puts each file under its namespace, with an empty one for missing files", () => {
    const tree = combineNamespaces({ common: { undo: "Desfazer" } });
    expect(Object.keys(tree)).toEqual([...NAMESPACES]);
    expect(tree.common).toEqual({ undo: "Desfazer" });
    expect(tree.ledger).toEqual({});
  });
});

describe("isLocale", () => {
  it("accepts only the supported locales", () => {
    expect(isLocale("pt-BR")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("pt")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});
