import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import type { LedgerFilter } from "@capital/server/modules/ledger/contracts";
import type { Names } from "@/lib/api/catalog";
import enLedger from "@/messages/en/ledger.json";
import ptLedger from "@/messages/pt-BR/ledger.json";
import { useLedgerLabels } from "../fields";

/**
 * The chips of the filters the property list does not cover, as the
 * toolbar renders them (useLedgerLabels().filterLabel): the PJ views'
 * "Entidade é PJ" and the import view's "Importação · <arquivo>".
 */

const names = { entities: [], accounts: [], categories: [], entity: new Map(), account: new Map(), category: new Map(), currency: "BRL" } as unknown as Names;

function chip(locale: "pt-BR" | "en", filter: LedgerFilter, imports: ReadonlyMap<string, string> = new Map()): string {
  function Probe() {
    return createElement("span", null, useLedgerLabels(names, imports).filterLabel(filter));
  }
  // children: the Probe passed to createElement replaces this placeholder.
  const intl: ComponentProps<typeof NextIntlClientProvider> = { locale, messages: { ledger: locale === "en" ? enLedger : ptLedger }, timeZone: "America/Sao_Paulo", children: null };
  const html = renderToStaticMarkup(createElement(NextIntlClientProvider, intl, createElement(Probe)));
  return html.replace(/^<span>|<\/span>$/g, "").replace(/&#x27;/g, "'");
}

describe("filter chips without a property", () => {
  it("reads 'Entidade é PJ' for the PJ views' entityKind filter", () => {
    expect(chip("pt-BR", { field: "entityKind", op: "in", values: ["business"] })).toBe("Entidade é PJ");
    expect(chip("pt-BR", { field: "entityKind", op: "in", values: ["personal"] })).toBe("Entidade é PF");
    expect(chip("en", { field: "entityKind", op: "in", values: ["business"] })).toBe("Entity is Business");
  });

  it("names an import's chip by its file, never by the raw id", () => {
    const filter: LedgerFilter = { field: "importId", op: "in", values: ["imp-1"] };
    const imports = new Map([["imp-1", "extrato-setembro"]]);
    expect(chip("pt-BR", filter, imports)).toBe("Importação · extrato-setembro");
    expect(chip("en", filter, imports)).toBe("Import · extrato-setembro");
    // Before the import list loads (or for an import no longer listed): the property name, not the id.
    expect(chip("pt-BR", filter)).toBe("Importação");
  });
});
