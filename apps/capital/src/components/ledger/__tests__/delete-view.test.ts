import fs from "node:fs";
import path from "node:path";
import { createElement, type ComponentProps, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { Dialog as DialogPrimitive } from "radix-ui";
import { describe, expect, it, vi } from "vitest";

// next-intl's navigation needs Next's router, which a static render has not: links render as plain anchors.
vi.mock("@/i18n/navigation", async () => {
  const { createElement: h } = await import("react");
  const router = { push: () => undefined, replace: () => undefined, back: () => undefined, refresh: () => undefined, prefetch: () => undefined };
  return {
    Link: ({ href, ...props }: { href: unknown }) => h("a", { ...props, href: String(href) }),
    usePathname: () => "/transactions",
    useRouter: () => router,
    redirect: () => undefined,
    getPathname: () => "/",
  };
});
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), usePathname: () => "/", useRouter: () => ({}) }));

import { InvestViewTabs } from "@/components/invest/view-controls";
import type { InvestViewWrites } from "@/components/invest/use-invest-views";
import { SidebarViewItem } from "@/components/shell/sidebar";
import { investTabs, type InvestView } from "@/lib/invest/invest-tabs";
import type { LedgerView } from "@/lib/ledger/use-views";
import enCommon from "@/messages/en/common.json";
import enInvest from "@/messages/en/invest.json";
import enLedger from "@/messages/en/ledger.json";
import ptCommon from "@/messages/pt-BR/common.json";
import ptInvest from "@/messages/pt-BR/invest.json";
import ptLedger from "@/messages/pt-BR/ledger.json";
import { confirmsOnEnter, DeleteViewConfirm } from "../toolbar/delete-view";
import { ViewTabs, type ViewTabActions } from "../toolbar/view-tabs";

/**
 * Deleting a view: the "×" right of its name on every Transações tab,
 * sidebar favorite and Carteira tab (never on Todas, seeded views like any
 * other), a confirmation ("Excluir a view “X”?"), and no other way (the
 * "⋯" menu and Exibição no longer offer it).
 */

type Locale = "pt-BR" | "en";
const MESSAGES = {
  "pt-BR": { common: ptCommon, ledger: ptLedger, invest: ptInvest },
  en: { common: enCommon, ledger: enLedger, invest: enInvest },
};

function render(locale: Locale, element: ReactElement): string {
  const intl: ComponentProps<typeof NextIntlClientProvider> = { locale, messages: MESSAGES[locale], timeZone: "America/Sao_Paulo", children: null };
  return renderToStaticMarkup(createElement(NextIntlClientProvider, intl, element)).replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
}

const ledgerView = (id: string, name: string, extra: Partial<LedgerView> = {}): LedgerView =>
  ({ id, name, dataset: "ledger", position: 0, isBuiltin: false, builtinKey: null, seedKey: null, isFavorite: true, updatedAt: "", config: { layout: "table" }, ...extra }) as LedgerView;

const TODAS = ledgerView("all", "Todas", { isBuiltin: true, builtinKey: "all" });
const SEEDED = ledgerView("v-subs", "Assinaturas", { seedKey: "subs" });
const MINE = ledgerView("v-mine", "Minha view");

const noop = () => undefined;
const tabActions: ViewTabActions = { rename: noop, duplicate: noop, toggleFavorite: noop, remove: noop };

/** The aria-labels of the "×" buttons in `html`. */
const deleteLabels = (html: string, verb = "Excluir") => [...html.matchAll(new RegExp(`aria-label="(${verb} “[^"]*”)"`, "g"))].map((m) => m[1]);

/** The class of the "×" of `name`. */
function deleteClass(html: string, name: string): string {
  const match = new RegExp(`<button[^>]*aria-label="Excluir “${name}”"[^>]*>`).exec(html);
  if (!match) throw new Error(`no × for ${name}`);
  return /class="([^"]*)"/.exec(match[0])![1];
}

describe("the delete confirmation", () => {
  it("asks with the view's name, says the transactions stay, and offers Cancelar / Excluir", () => {
    const body = (locale: Locale) =>
      render(locale, createElement(DialogPrimitive.Root, { open: true }, createElement(DeleteViewConfirm, { name: "Assinaturas", onCancel: noop, onConfirm: noop })));
    const pt = body("pt-BR");
    expect(pt).toContain("Excluir a view “Assinaturas”?");
    expect(pt).toContain("Os lançamentos não são afetados. Você pode desfazer logo depois.");
    expect(pt).toMatch(/>Cancelar<\/button>/);
    expect(pt).toMatch(/text-neg[^"]*">Excluir<\/button>/);
    const en = body("en");
    expect(en).toContain("Delete the view “Assinaturas”?");
    expect(en).toMatch(/>Cancel<\/button>/);
    expect(en).toMatch(/>Delete<\/button>/);
  });

  it("confirms on a plain Enter, but leaves Enter on a button (Cancelar, ✕) to that button", () => {
    const key = (key: string, target: string | null, mods: Partial<Record<"shiftKey" | "altKey" | "ctrlKey" | "metaKey" | "isComposing" | "repeat", boolean>> = {}) =>
      confirmsOnEnter({ key, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...mods, target: target ? { tagName: target } : null });
    expect(key("Enter", "DIV")).toBe(true);
    expect(key("Enter", null)).toBe(true);
    expect(key("Enter", "BUTTON")).toBe(false);
    expect(key("Enter", "a")).toBe(false);
    expect(key("Escape", "DIV")).toBe(false);
    expect(key("Enter", "DIV", { metaKey: true })).toBe(false);
    expect(key("Enter", "DIV", { isComposing: true })).toBe(false);
    expect(key("Enter", "DIV", { repeat: true })).toBe(false);
  });
});

describe("the × on the Transações tabs", () => {
  const tabs = (activeId: string) =>
    render("pt-BR", createElement(ViewTabs, { views: [TODAS, SEEDED, MINE], activeId, dirty: false, onPick: noop, onNew: noop, actions: tabActions }));

  it("is on every view but Todas, seeded ones included", () => {
    expect(deleteLabels(tabs("all"))).toEqual(["Excluir “Assinaturas”", "Excluir “Minha view”"]);
  });

  it("shows on hover or focus, and always on the active tab", () => {
    const html = tabs("v-subs");
    expect(deleteClass(html, "Assinaturas")).toMatch(/(^| )opacity-100( |$)/);
    expect(deleteClass(html, "Minha view")).toMatch(/opacity-0 group-hover:opacity-100/);
    expect(deleteClass(html, "Minha view")).toContain("focus-visible:opacity-100");
  });

  it("gives a seeded view no label of its own (only Todas says fixa)", () => {
    const html = tabs("all");
    expect(html.match(/>fixa</g)).toHaveLength(1);
    const seededTab = html.slice(html.indexOf("Assinaturas"), html.indexOf("Minha view"));
    expect(seededTab).not.toContain("fixa");
  });
});

describe("the × on the sidebar favorites", () => {
  const actions = { rename: noop, duplicate: noop, toggleFavorite: noop, remove: noop } as unknown as ComponentProps<typeof SidebarViewItem>["actions"];
  const item = (view: LedgerView, on = false, rail = false) => render("pt-BR", createElement(SidebarViewItem, { view, rail, on, actions }));

  it("is on every favorite but Todas, visible on the active one", () => {
    expect(deleteLabels(item(TODAS, true))).toEqual([]);
    expect(deleteLabels(item(SEEDED))).toEqual(["Excluir “Assinaturas”"]);
    expect(deleteClass(item(SEEDED), "Assinaturas")).toContain("opacity-0 group-hover:opacity-100");
    expect(deleteClass(item(MINE, true), "Minha view")).toMatch(/(^| )opacity-100( |$)/);
  });

  it("is not on the rail, which shows no names", () => {
    expect(deleteLabels(item(MINE, false, true))).toEqual([]);
  });
});

describe("the Carteira tabs", () => {
  const writes = { remove: { isPending: false }, create: {}, duplicate: {}, update: noop } as unknown as InvestViewWrites;
  const strip = (views: InvestView[], canCreate = true) =>
    render("pt-BR", createElement(InvestViewTabs, { views, active: null, onSelect: noop, writes, canCreate, holdings: [], summary: undefined }));
  const stored = (id: string, name: string, dataset: "holdings" | "investment_ops", seedKey: string | null = null) => ({ id, name, dataset, seedKey, config: {} });
  const name = (key: string) => key;

  it("put a × on every stored tab, seeded ones included", () => {
    const views = investTabs(
      { data: [stored("h1", "Por classe", "holdings", "byClass"), stored("h2", "Nova view", "holdings")], isError: false },
      { data: [stored("o1", "Operações", "investment_ops", "operations")], isError: false },
      name,
    );
    expect(deleteLabels(strip(views))).toEqual(["Excluir “Por classe”", "Excluir “Nova view”", "Excluir “Operações”"]);
  });

  it("are empty, with only +, when the user deleted every view", () => {
    const views = investTabs({ data: [], isError: false }, { data: [], isError: false }, name);
    expect(views).toEqual([]);
    const html = strip(views);
    expect(deleteLabels(html)).toEqual([]);
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Nova view"');
  });

  it("show the defaults (read-only, no ×) only when reading the views failed", () => {
    const failed = investTabs({ data: undefined, isError: true }, { data: undefined, isError: true }, name);
    expect(failed.map((v) => [v.id, v.persisted])).toEqual([
      ["seed:byClass", false],
      ["seed:byBroker", false],
      ["seed:byEntity", false],
      ["seed:list", false],
      ["seed:income12m", false],
      ["seed:operations", false],
    ]);
    expect(deleteLabels(strip(failed, false))).toEqual([]);
    // A refetch that fails after a read keeps what was read, even an empty list.
    expect(investTabs({ data: [], isError: true }, { data: [], isError: true }, name)).toEqual([]);
    // Still loading: nothing yet.
    expect(investTabs({ data: undefined, isError: false }, { data: undefined, isError: false }, name)).toEqual([]);
  });
});

describe("one way to delete a view", () => {
  const SRC = path.resolve(__dirname, "../../..");
  const read = (file: string) => fs.readFileSync(path.join(SRC, file), "utf8");

  it("the ⋯ menu and Exibição no longer offer Excluir view", () => {
    for (const locale of ["pt-BR", "en"] as const) {
      const { ledger, invest } = MESSAGES[locale];
      expect(ledger.viewMenu, locale).not.toHaveProperty("delete");
      expect(ledger.display, locale).not.toHaveProperty("delete");
      expect(invest.portfolio.display, locale).not.toHaveProperty("delete");
    }
    expect(read("components/ledger/toolbar/view-menu.tsx")).not.toMatch(/onDelete|t\("delete"\)/);
    expect(read("components/ledger/toolbar/display-menu.tsx")).not.toMatch(/onDelete|display\.delete/);
    const popover = read("components/invest/view-controls.tsx");
    const display = popover.slice(popover.indexOf("export function DisplayPopover"), popover.indexOf("function InvestViewTab("));
    expect(display).not.toMatch(/onDelete|t\("delete"\)/);
  });
});
