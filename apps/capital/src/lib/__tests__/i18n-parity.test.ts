import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NAMESPACES, type MessageTree } from "@/i18n/messages";
import { routing } from "@/i18n/routing";
import { icuArguments } from "@/lib/i18n/icu";

/**
 * Every locale has the same namespaces, the same keys and the same ICU
 * placeholders as pt-BR, the source language. A missing English key would
 * show the pt-BR text; a missing placeholder would print "{name}" or throw.
 */

const MESSAGES_DIR = path.resolve(__dirname, "../../messages");
const SOURCE = routing.defaultLocale;

function read(locale: string, namespace: string): MessageTree {
  return JSON.parse(fs.readFileSync(path.join(MESSAGES_DIR, locale, `${namespace}.json`), "utf8")) as MessageTree;
}

/** Leaf path → message, failing on anything that is not a string or a nested object. */
function leaves(tree: unknown, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof tree !== "object" || tree === null || Array.isArray(tree)) throw new Error(`${prefix || "root"} is not an object`);
  for (const [key, value] of Object.entries(tree)) {
    // next-intl reads "a.b" as a path, so a dot inside a key is unreachable.
    if (!key || key.includes(".")) throw new Error(`invalid key "${prefix}${key}"`);
    if (typeof value === "string") out.set(`${prefix}${key}`, value);
    else for (const [leaf, message] of leaves(value, `${prefix}${key}.`)) out.set(leaf, message);
  }
  return out;
}

describe("i18n messages", () => {
  it("has exactly one file per namespace in every locale", () => {
    expect(fs.readdirSync(MESSAGES_DIR).sort()).toEqual([...routing.locales].sort());
    for (const locale of routing.locales) {
      expect(fs.readdirSync(path.join(MESSAGES_DIR, locale)).sort(), locale).toEqual(NAMESPACES.map((namespace) => `${namespace}.json`).sort());
    }
  });

  for (const namespace of NAMESPACES) {
    describe(namespace, () => {
      const source = leaves(read(SOURCE, namespace));

      it("parses as ICU in every locale", () => {
        for (const locale of routing.locales) {
          for (const [key, message] of leaves(read(locale, namespace))) {
            expect(() => icuArguments(message), `${locale} ${namespace}.${key}`).not.toThrow();
          }
        }
      });

      for (const locale of routing.locales.filter((candidate) => candidate !== SOURCE)) {
        it(`has the keys and placeholders of ${SOURCE} in ${locale}`, () => {
          const translated = leaves(read(locale, namespace));
          expect([...translated.keys()].sort()).toEqual([...source.keys()].sort());
          for (const [key, message] of source) {
            const other = translated.get(key);
            if (other === undefined) continue;
            expect(icuArguments(other), `${namespace}.${key}`).toEqual(icuArguments(message));
          }
        });
      }
    });
  }
});
