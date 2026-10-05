import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { MessageTree } from "@/i18n/messages";
import { routing } from "@/i18n/routing";
import { icuArguments } from "@/lib/i18n/icu";

/**
 * Every error code the server sends has a message in every locale
 * (errors.<code>), and the message only uses the params that code sends:
 * the UI shows it instead of the server's English text (lib/api/errors.ts).
 *
 * TODO(integration 0b + 0c): the code catalog, src/server/i18n/error-codes.ts,
 * is written on the backend branch (ui/0b-backend). This test is skipped
 * until that file is in the tree, then fails for each code without a
 * message. The errors.json files were filled from the catalog at
 * ui/0b-backend 4f35deba4 (112 codes); add a pt-BR and an en message for
 * every code added after that, using only the {params} its English
 * meaning names.
 */

const CATALOG = path.resolve(__dirname, "../../server/i18n/error-codes.ts");
const MESSAGES_DIR = path.resolve(__dirname, "../../messages");

function lookup(tree: MessageTree, dotted: string): unknown {
  return dotted.split(".").reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as MessageTree)[part] : undefined), tree);
}

describe.skipIf(!fs.existsSync(CATALOG))("server error codes", () => {
  it("each have a message in every locale that uses only the code's params", async () => {
    const { ERROR_CODES } = (await import(/* @vite-ignore */ CATALOG)) as { ERROR_CODES: Record<string, string> };
    const problems: string[] = [];
    for (const locale of routing.locales) {
      const errors = JSON.parse(fs.readFileSync(path.join(MESSAGES_DIR, locale, "errors.json"), "utf8")) as MessageTree;
      for (const [code, meaning] of Object.entries(ERROR_CODES)) {
        const message = lookup(errors, code);
        if (typeof message !== "string") {
          problems.push(`${locale}: errors.${code} is missing`);
          continue;
        }
        const params = new Set(Array.from(meaning.matchAll(/\{(\w+)\}/g), (match) => match[1]));
        const unknown = icuArguments(message).filter((name) => !params.has(name));
        if (unknown.length) problems.push(`${locale}: errors.${code} uses {${unknown.join("}, {")}}, which the server does not send`);
      }
    }
    expect(problems).toEqual([]);
  });
});
