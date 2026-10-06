import type { Locale } from "@/i18n/routing";
import { buildTransactionsHref } from "@/lib/ledger/view-draft";
import { layoutGlyph } from "@/lib/ledger/view-glyphs";
import type { ThemePreference } from "@/lib/theme/preference";
import { SETTINGS_PAGES, type SettingsPage } from "./command-targets";
import { SHELL_SHORTCUTS } from "./shortcuts";

/**
 * The fixed commands of ⌘K (Ir para, Views, Criar, Conta) as data, and the
 * search that filters and orders them. The palette adds the dynamic rows
 * (quick add, Lançamentos found, "Perguntar ao assistente") around these.
 */

export type CommandAction =
  | { type: "navigate"; href: string }
  /** Ajustes (or one of its pages), remembering the screen to come back to. */
  | { type: "settings"; page?: SettingsPage }
  /** "Nova transação", blank. */
  | { type: "create" }
  | { type: "import" }
  | { type: "newView" }
  | { type: "theme"; theme: ThemePreference }
  | { type: "locale"; locale: Locale }
  | { type: "signOut" };

export type CommandGroup = "goTo" | "views" | "create" | "account";

/** Order of the groups in the palette. */
export const COMMAND_GROUPS: readonly CommandGroup[] = ["goTo", "views", "create", "account"];

export interface CommandItem {
  /** Unique; cmdk's value. */
  id: string;
  group: CommandGroup;
  label: string;
  /** Leading glyph (a view's layout). */
  glyph?: string;
  /** Text on the right ("favorita"). */
  hint?: string;
  /** A shortcut combo shown on the right ("n", "mod+,"). */
  shortcut?: string;
  /** The current choice (theme, language). */
  checked?: boolean;
  /** Extra words that find it. */
  keywords?: readonly string[];
  /** Listed only once something is typed (Ajustes' pages, theme and language choices), so the open palette stays short. */
  searchOnly?: boolean;
  action: CommandAction;
}

/** A next-intl translator, reduced to what this module calls. */
export type Translate = (key: string, values?: Record<string, string | number>) => string;

export interface CommandSource {
  /** Translator of the `command` namespace. */
  t: Translate;
  /** Ledger views, in the user's order. */
  views: readonly { id: string; name: string; isFavorite?: boolean; config?: { layout?: string } | null }[];
  theme: ThemePreference;
  /** Labels of the theme choices ("Sistema", "Claro", "Escuro"). */
  themeLabels: Record<ThemePreference, string>;
  locale: string;
  /** Each language's name in itself ("Português", "English"). */
  locales: readonly { locale: Locale; label: string }[];
}

const THEMES: readonly ThemePreference[] = ["system", "light", "dark"];

export function commandItems({ t, views, theme, themeLabels, locale, locales }: CommandSource): CommandItem[] {
  const items: CommandItem[] = [
    { id: "go:transactions", group: "goTo", label: t("goTo.transactions"), action: { type: "navigate", href: "/transactions" } },
    { id: "go:budgets", group: "goTo", label: t("goTo.budgets"), action: { type: "navigate", href: "/transactions/budgets" } },
    { id: "go:portfolio", group: "goTo", label: t("goTo.portfolio"), action: { type: "navigate", href: "/investments" } },
    { id: "go:contributions", group: "goTo", label: t("goTo.contributions"), action: { type: "navigate", href: "/investments/contributions" } },
    { id: "go:trash", group: "goTo", label: t("goTo.trash"), action: { type: "navigate", href: buildTransactionsHref({ trash: true }) } },
    { id: "go:settings", group: "goTo", label: t("goTo.settings"), shortcut: SHELL_SHORTCUTS.settings.combo, action: { type: "settings" } },
    ...SETTINGS_PAGES.map((page): CommandItem =>
      // Importações is a destination of its own in Ir para (always listed); the other pages show once something is typed.
      page === "imports"
        ? { id: `go:settings:${page}`, group: "goTo", label: t("goTo.imports"), keywords: [t("goTo.settings")], action: { type: "settings", page } }
        : {
            id: `go:settings:${page}`,
            group: "goTo",
            label: t("goTo.settingsPage", { page: t(`settingsPages.${page}`) }),
            searchOnly: true,
            action: { type: "settings", page },
          },
    ),
  ];

  for (const view of views) {
    items.push({
      id: `view:${view.id}`,
      group: "views",
      label: view.name,
      glyph: layoutGlyph(view.config?.layout ?? "table"),
      hint: view.isFavorite ? t("views.favorite") : undefined,
      action: { type: "navigate", href: buildTransactionsHref({ viewId: view.id }) },
    });
  }

  items.push(
    { id: "create:entry", group: "create", label: t("create.entry"), shortcut: SHELL_SHORTCUTS.create.combo, action: { type: "create" } },
    { id: "create:import", group: "create", label: t("create.import"), action: { type: "import" } },
    { id: "create:view", group: "create", label: t("create.view"), action: { type: "newView" } },
  );

  for (const option of THEMES) {
    items.push({ id: `theme:${option}`, group: "account", label: t("account.theme", { theme: themeLabels[option] }), checked: option === theme, searchOnly: true, action: { type: "theme", theme: option } });
  }
  for (const option of locales) {
    items.push({
      id: `locale:${option.locale}`,
      group: "account",
      label: t("account.language", { language: option.label }),
      checked: option.locale === locale,
      searchOnly: true,
      action: { type: "locale", locale: option.locale },
    });
  }
  items.push({ id: "account:signOut", group: "account", label: t("account.signOut"), action: { type: "signOut" } });
  return items;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/** Lower case, no accents, single spaces: "Orçamentos" and "orcamentos" match. */
export function normalizeSearch(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

const WORD_SPLIT = /[\s›·:/,()–—-]+/;

/**
 * How well `query` finds `label` (0 = not at all, 1 = exactly): the whole
 * label, then its start, a word's start, every typed word starting a word,
 * anywhere in the label, and last the keywords.
 */
export function commandScore(label: string, query: string, keywords: readonly string[] = []): number {
  const q = normalizeSearch(query);
  if (!q) return 1;
  const text = normalizeSearch(label);
  if (text === q) return 1;
  if (text.startsWith(q)) return 0.9;
  const words = text.split(WORD_SPLIT).filter(Boolean);
  if (words.some((word) => word.startsWith(q))) return 0.8;
  const tokens = q.split(" ");
  if (tokens.every((token) => words.some((word) => word.startsWith(token)))) return 0.7;
  if (text.includes(q)) return 0.6;
  const extra = normalizeSearch(keywords.join(" "));
  if (extra && tokens.every((token) => text.includes(token) || extra.includes(token))) return 0.4;
  return 0;
}

export interface CommandSection {
  group: CommandGroup;
  items: CommandItem[];
}

/**
 * The items that match `query`, grouped in COMMAND_GROUPS order; inside a
 * group the best matches first (ties keep their order). An empty query
 * keeps everything as listed, except the `searchOnly` items.
 */
export function filterCommands(items: readonly CommandItem[], query: string): CommandSection[] {
  const empty = !normalizeSearch(query);
  const scored = items
    .filter((item) => !(empty && item.searchOnly))
    .map((item, index) => ({ item, index, score: commandScore(item.label, query, item.keywords) }))
    .filter((entry) => entry.score > 0);
  return COMMAND_GROUPS.map((group) => ({
    group,
    items: scored
      .filter((entry) => entry.item.group === group)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map((entry) => entry.item),
  })).filter((section) => section.items.length > 0);
}
