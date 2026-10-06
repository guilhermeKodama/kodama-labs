"use client";

import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Command } from "cmdk";
import { useTranslations } from "next-intl";
import { Dialog as DialogPrimitive } from "radix-ui";
import { CheckIcon, Search } from "lucide-react";
import { Kbd } from "@/components/cap";
import { BACKDROP } from "@/components/cap/styles";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { api, apiPost } from "@/lib/api/client";
import { useAccounts, useCategories, useCurrencies, useEntities, useNames } from "@/lib/api/catalog";
import { keys } from "@/lib/api/keys";
import { useSession, useSignOut } from "@/lib/api/session";
import { readLastConversation } from "@/lib/assistant/history";
import { useFmt } from "@/lib/format/provider";
import { parseQuickAdd, type QuickAddDraft, type QuickAddResult } from "@/lib/ledger/quick-add";
import { useAssistantBridge } from "@/lib/shell/assistant-bridge";
import { commandItems, filterCommands, normalizeSearch, type CommandAction, type CommandGroup, type CommandItem } from "@/lib/shell/command-items";
import { COMMAND_MENU_EVENT } from "@/lib/shell/command-menu";
import {
  isQuickAdd,
  ledgerHref,
  quickAddCatalog,
  quickAddChipFields,
  SEARCH_MIN_LENGTH,
  todayIn,
  transactionSearchQuery,
  type LedgerTarget,
  type QuickAddChipField,
} from "@/lib/shell/command-targets";
import { SHELL_SHORTCUTS } from "@/lib/shell/shortcuts";
import { useShellShortcut } from "@/lib/shell/use-shell-shortcut";
import { formatCombo } from "@/lib/shortcuts/combo";
import { OverlayScope, useIsMac, useOverlay, useShortcut } from "@/lib/shortcuts/provider";
import { THEME_PREFERENCES, type ThemePreference } from "@/lib/theme/preference";
import { cn } from "@/lib/utils";
import { AssistantPanel } from "./assistant/assistant-panel";
import { useAssistant, type AssistantController } from "./assistant/use-assistant";
import { useNewView } from "./sidebar";
import { LANGUAGE_KEY, useLocaleChoice, useOpenSettings, useThemeChoice } from "./user-menu";

type Mode = "commands" | "assistant";

/**
 * ⌘K, "Buscar ou executar…": quick add, Ir para (screens and Ajustes'
 * pages), Views, Criar, Lançamentos (search), Assistente and Conta, and
 * the assistant itself. Mounted once per signed-in layout; opened by ⌘K,
 * the sidebar trigger (COMMAND_MENU_EVENT) and openAssistant(). The
 * assistant's conversation lives here, so a reply keeps streaming while
 * the palette is closed.
 */
export function CommandMenu() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("commands");
  const assistant = useAssistant();
  // Radix closes the dialog on Esc; while open, app shortcuts pause.
  const overlayId = useOverlay(open);

  const close = () => {
    setOpen(false);
    setMode("commands");
  };

  useAssistantBridge((request) => {
    setOpen(true);
    setMode("assistant");
    // Something to send (a statement from the import dialog, a prompt): a new conversation for it.
    if (request.prompt || request.files?.length) assistant.newConversation();
    if (request.prompt) assistant.setDraft(request.prompt);
    if (request.files?.length) assistant.addFiles(request.files);
  });

  // ⌘K opens it from anywhere (also from a text field); inside, ⌘K closes it (CloseOnCommandKey).
  useShellShortcut("command", () => setOpen(true));
  useEffect(() => {
    const openMenu = () => setOpen(true);
    window.addEventListener(COMMAND_MENU_EVENT, openMenu);
    return () => window.removeEventListener(COMMAND_MENU_EVENT, openMenu);
  }, []);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={BACKDROP} />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          style={{ width: mode === "assistant" ? 640 : 560 }}
          className="fixed top-7 left-1/2 z-50 flex max-w-[94vw] -translate-x-1/2 flex-col overflow-hidden rounded-[12px] border border-stroke-1 bg-editor text-fg-1 shadow-lg outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0"
        >
          <OverlayScope id={overlayId}>
            <CloseOnCommandKey onClose={close} />
            {mode === "assistant" ? (
              <AssistantPanel controller={assistant} onBack={() => setMode("commands")} onNavigate={close} />
            ) : (
              <Palette assistant={assistant} onClose={close} onAssistant={() => setMode("assistant")} />
            )}
          </OverlayScope>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** ⌘K again, from inside the open palette (an overlay, where global keys are off), closes it. */
function CloseOnCommandKey({ onClose }: { onClose: () => void }) {
  useShortcut(SHELL_SHORTCUTS.command.combo, onClose, { allowInInputs: true });
  return null;
}

// ---------------------------------------------------------------------------
// The command list
// ---------------------------------------------------------------------------

/** Groups in the palette, top to bottom: the dynamic ones around the fixed commands. */
type Section = "quickAdd" | CommandGroup | "entries" | "assistant";
const SECTION_ORDER: readonly Section[] = ["quickAdd", "goTo", "views", "create", "entries", "assistant", "account"];

/** What ⌘K shows of a Lançamentos row (display rows carry displayAmount, C3). */
interface SearchRow {
  id: string;
  date: string;
  description: string;
  accountId: string;
  currency: string;
  amount: number;
  displayAmount?: number;
}

interface LedgerView {
  id: string;
  name: string;
  isFavorite?: boolean;
  config?: { layout?: string } | null;
}

function Palette({ assistant, onClose, onAssistant }: { assistant: AssistantController; onClose: () => void; onAssistant: () => void }) {
  const t = useTranslations("command");
  const tMenu = useTranslations("shell.userMenu");
  const router = useRouter();
  const pathname = usePathname();
  const isMac = useIsMac();
  const [query, setQuery] = useState("");
  const signOut = useSignOut();
  const openSettings = useOpenSettings();
  const themeChoice = useThemeChoice();
  const localeChoice = useLocaleChoice();
  const newView = useNewView(onClose);

  const views = useQuery({
    queryKey: keys.views("ledger"),
    queryFn: () => api<LedgerView[]>("/api/v2/views?dataset=ledger"),
  });

  const items = useMemo(
    () =>
      commandItems({
        t: (key, values) => t(key, values),
        views: views.data ?? [],
        theme: themeChoice.theme,
        themeLabels: Object.fromEntries(THEME_PREFERENCES.map((option) => [option, tMenu(`themes.${option}`)])) as Record<ThemePreference, string>,
        locale: localeChoice.locale,
        locales: routing.locales.map((locale) => ({ locale, label: tMenu(`languages.${LANGUAGE_KEY[locale]}`) })),
      }),
    [t, tMenu, views.data, themeChoice.theme, localeChoice.locale],
  );
  const sections = useMemo(() => filterCommands(items, query), [items, query]);
  const quick = useQuickAdd(query);
  const typed = normalizeSearch(query);
  const text = query.trim();
  const searching = typed.length >= SEARCH_MIN_LENGTH;
  const search = useTransactionSearch(query);

  const goLedger = (target: LedgerTarget) => {
    onClose();
    // On Transações the view on screen stays; elsewhere its default view opens.
    router.push(ledgerHref({ pathname, search: window.location.search }, target));
  };

  const run = (action: CommandAction) => {
    switch (action.type) {
      case "navigate":
        onClose();
        router.push(action.href);
        return;
      case "settings":
        onClose();
        openSettings(action.page);
        return;
      case "create":
        goLedger({ create: {} });
        return;
      case "import":
        goLedger({ import: true });
        return;
      case "newView":
        // Closes and opens the new view (with Exibição) once it is saved.
        newView.mutate();
        return;
      case "theme":
        themeChoice.pick(action.theme);
        onClose();
        return;
      case "locale":
        localeChoice.pick(action.locale);
        onClose();
        return;
      case "signOut":
        onClose();
        signOut();
        return;
    }
  };

  const hasConversation = Boolean(assistant.state.conversationId || assistant.state.messages.length || lastConversation());
  const noEntries = !searching || (search.data !== undefined && search.data.length === 0);
  const noMatches = Boolean(typed) && !quick && sections.length === 0 && noEntries;

  const rendered: Partial<Record<Section, ReactNode>> = {
    quickAdd: quick ? (
      <Command.Group heading={t("groups.quickAdd")}>
        <Command.Item value="quick-add" onSelect={() => goLedger({ create: quick.draft })} className={ITEM_TALL}>
          <Glyph>+</Glyph>
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <QuickAddLabel draft={quick.draft} />
            <QuickAddChips result={quick} />
          </span>
          <span className="shrink-0 text-[11px] text-fg-3">{t("quickAdd.fill")}</span>
        </Command.Item>
      </Command.Group>
    ) : null,
    entries:
      searching && !noMatches ? (
        <Command.Group heading={t("groups.entries")}>
          {search.isPending ? <Note>{t("entries.searching")}</Note> : null}
          {search.isError ? <Note>{t("entries.failed")}</Note> : null}
          {search.data && !search.data.length ? <Note>{t("entries.none", { query: text })}</Note> : null}
          {search.data?.map((row) => (
            <Command.Item key={row.id} value={`entry:${row.id}`} onSelect={() => goLedger({ entry: row.id })} className={ITEM}>
              <EntryRow row={row} />
            </Command.Item>
          ))}
          {search.data?.length ? (
            <Command.Item value="entries:all" onSelect={() => goLedger({ q: text })} className={ITEM}>
              <Glyph>→</Glyph>
              <span className="min-w-0 flex-1 truncate text-fg-2">{t("entries.seeAll", { query: text })}</span>
            </Command.Item>
          ) : null}
        </Command.Group>
      ) : null,
    assistant: (
      <Command.Group heading={t("groups.assistant")}>
        {typed ? (
          <Command.Item
            value="assistant:ask"
            onSelect={() => {
              assistant.ask(query);
              onAssistant();
            }}
            className={ITEM}
          >
            <Glyph>✦</Glyph>
            <span className="min-w-0 flex-1 truncate">{t("assistant.ask", { query: text })}</span>
          </Command.Item>
        ) : (
          <Command.Item value="assistant:open" onSelect={onAssistant} className={ITEM}>
            <Glyph>✦</Glyph>
            <span className="min-w-0 flex-1 truncate">{hasConversation ? t("assistant.continue") : t("assistant.open")}</span>
          </Command.Item>
        )}
      </Command.Group>
    ),
  };
  for (const section of sections) {
    rendered[section.group] = (
      <Command.Group heading={t(`groups.${section.group}`)}>
        {section.items.map((item) => (
          <CommandRow key={item.id} item={item} isMac={isMac} onSelect={() => run(item.action)} />
        ))}
      </Command.Group>
    );
  }

  return (
    <Command shouldFilter={false} loop label={t("title")} className="flex flex-col">
      <DialogPrimitive.Title className="sr-only">{t("title")}</DialogPrimitive.Title>
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-stroke-3 px-3">
        <Search className="size-3.5 shrink-0 text-fg-3" aria-hidden />
        <Command.Input
          autoFocus
          value={query}
          onValueChange={setQuery}
          placeholder={t("placeholder")}
          className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-fg-3"
        />
        <Kbd>Esc</Kbd>
      </div>
      <Command.List className="max-h-[min(400px,calc(100dvh-160px))] overflow-y-auto p-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-fg-3">
        {noMatches ? <div className="px-2 pt-4 pb-3 text-center text-[12.5px] text-fg-3">{t("empty")}</div> : null}
        {SECTION_ORDER.map((section) => (
          <Fragment key={section}>{rendered[section] ?? null}</Fragment>
        ))}
      </Command.List>
      <div className="flex h-8 shrink-0 items-center gap-3 border-t border-stroke-3 px-3 text-[11px] text-fg-3">
        <FooterHint keys="↑↓" label={t("footer.navigate")} />
        <FooterHint keys="↵" label={t("footer.open")} />
        <FooterHint keys="Esc" label={t("footer.close")} />
      </div>
    </Command>
  );
}

function lastConversation(): string | null {
  try {
    return readLastConversation(window.localStorage);
  } catch {
    return null;
  }
}

/** 28px row, radius 5, 12.5px; the selected one on fill.tertiary (MenuItem). */
const ITEM =
  "flex h-7 cursor-pointer items-center gap-2 rounded-[5px] px-2 text-[12.5px] text-fg-1 outline-none select-none data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-40 data-[selected=true]:bg-fill-3";
const ITEM_TALL = "flex min-h-7 cursor-pointer items-center gap-2 rounded-[5px] px-2 py-1.5 text-[12.5px] text-fg-1 outline-none select-none data-[selected=true]:bg-fill-3";

function FooterHint({ keys: combo, label }: { keys: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <Kbd>{combo}</Kbd>
      {label}
    </span>
  );
}

function Glyph({ children }: { children?: ReactNode }) {
  return (
    <span aria-hidden className="flex w-4 shrink-0 justify-center text-[12px] text-fg-3">
      {children}
    </span>
  );
}

/** A line inside a group that is not a command (searching, nothing found). */
function Note({ children }: { children: ReactNode }) {
  return <div className="flex h-7 items-center pr-2 pl-8 text-[12px] text-fg-3">{children}</div>;
}

function CommandRow({ item, isMac, onSelect }: { item: CommandItem; isMac: boolean; onSelect: () => void }) {
  return (
    <Command.Item value={item.id} onSelect={onSelect} className={ITEM}>
      <Glyph>{item.glyph}</Glyph>
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.hint ? <span className="shrink-0 text-[11px] text-fg-3">{item.hint}</span> : null}
      {item.shortcut ? <span className="shrink-0 font-mono text-[10.5px] text-fg-4">{formatCombo(item.shortcut, isMac)}</span> : null}
      {item.checked ? <CheckIcon className="size-3.5 shrink-0 text-fg-2" aria-hidden /> : null}
    </Command.Item>
  );
}

// ---------------------------------------------------------------------------
// Quick add
// ---------------------------------------------------------------------------

/** The typed text as a transaction (S2's parser, C4), when it reads as one. */
function useQuickAdd(query: string): QuickAddResult | null {
  const session = useSession();
  const accounts = useAccounts();
  const entities = useEntities();
  const categories = useCategories();
  const currencies = useCurrencies();
  const catalog = useMemo(
    () =>
      quickAddCatalog({
        accounts: accounts.data ?? [],
        entities: entities.data ?? [],
        categories: categories.data ?? [],
        currencies: (currencies.data?.currencies ?? []).map((currency) => currency.code),
        baseCurrency: session.data?.baseCurrency,
      }),
    [accounts.data, entities.data, categories.data, currencies.data, session.data?.baseCurrency],
  );
  const timezone = session.data?.timezone ?? "UTC";
  return useMemo(() => {
    if (!query.trim()) return null;
    const result = parseQuickAdd(query, catalog, todayIn(timezone));
    return isQuickAdd(result) ? result : null;
  }, [query, catalog, timezone]);
}

/** The amount of the draft in its currency (the typed one, else the account's, else the base). */
function useDraftMoney(draft: QuickAddDraft): string {
  const fmt = useFmt();
  const names = useNames();
  return fmt.money(draft.amount ?? 0, draft.currency ?? currencyOf(draft, names.accounts) ?? names.currency);
}

/** "Criar “Ifood” · R$ 86,90". */
function QuickAddLabel({ draft }: { draft: QuickAddDraft }) {
  const t = useTranslations("command.quickAdd");
  const amount = useDraftMoney(draft);
  return (
    <span className="truncate">
      {t("label", { hasDescription: draft.description ? "yes" : "no", description: draft.description ?? "", amount })}
    </span>
  );
}

/** The other fields found, as in the create form's chips (mockup 4834-4840): "Conta: Nubank". The label already says the description and the amount. */
function QuickAddChips({ result }: { result: QuickAddResult }) {
  const t = useTranslations("command.quickAdd");
  const fmt = useFmt();
  const names = useNames();
  const { draft } = result;
  const amount = useDraftMoney(draft);
  const fields = quickAddChipFields(draft).filter((field) => field !== "description" && field !== "amount");
  if (!fields.length) return null;
  const value = (field: QuickAddChipField): string => {
    switch (field) {
      case "description":
        return draft.description ?? "";
      case "amount":
        return amount;
      case "kind":
        return draft.kind ? t(`kinds.${draft.kind}`) : "";
      case "account":
        return names.account.get(draft.accountId ?? "") ?? "";
      case "entity":
        return names.entity.get(draft.entityId ?? "") ?? "";
      case "date":
        return fmt.date(draft.date);
      case "category":
        return draft.categoryId ? (names.category.get(draft.categoryId) ?? "") : t("newCategory", { name: draft.categoryName ?? "" });
      case "currency":
        return draft.currency ?? "";
    }
  };
  return (
    <span className="flex flex-wrap gap-1">
      {fields.map((field) => (
        <span key={field} className="rounded-[4px] border border-stroke-2 px-1.5 py-px text-[11px]">
          <span className="text-fg-3">{t(`fields.${field}`)}: </span>
          {value(field)}
        </span>
      ))}
    </span>
  );
}

function currencyOf(draft: QuickAddDraft, accounts: readonly { id: string; currency: string }[]): string | undefined {
  return accounts.find((account) => account.id === draft.accountId)?.currency;
}

// ---------------------------------------------------------------------------
// Lançamentos
// ---------------------------------------------------------------------------

/** Debounced search over Lançamentos (C5), from SEARCH_MIN_LENGTH characters. */
function useTransactionSearch(query: string) {
  const [text, setText] = useState(query.trim());
  useEffect(() => {
    const timer = window.setTimeout(() => setText(query.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [query]);
  const input = transactionSearchQuery(text);
  const enabled = normalizeSearch(text).length >= SEARCH_MIN_LENGTH;
  const result = useQuery({
    queryKey: keys.ledgerQuery(input),
    // The whole answer under the shared ledger key (another reader of the same input gets what it expects); the palette keeps the rows.
    queryFn: () => apiPost<{ rows: SearchRow[] }>("/api/v2/ledger/query", input),
    select: (answer) => answer.rows,
    enabled,
    staleTime: 30_000,
  });
  // While the debounce runs, the rows of the previous text are not this text's answer.
  const settled = text === query.trim();
  return {
    data: settled && enabled ? result.data : undefined,
    isPending: !settled || (enabled && result.isPending),
    isError: settled && enabled && result.isError,
  };
}

function EntryRow({ row }: { row: SearchRow }) {
  const fmt = useFmt();
  const names = useNames();
  const session = useSession();
  const amount = row.displayAmount ?? row.amount;
  // The search covers every date: rows of another year carry it ("22/09/2025").
  const thisYear = todayIn(session.data?.timezone ?? "UTC").slice(0, 4);
  const date = row.date.slice(0, 4) === thisYear ? fmt.date(row.date) : fmt.dateFull(row.date);
  return (
    <>
      <span className="min-w-11 shrink-0 font-mono text-[11px] text-fg-3 tabular-nums">{date}</span>
      <span className="min-w-0 flex-1 truncate">{row.description}</span>
      <span className="max-w-[140px] shrink-0 truncate text-[11.5px] text-fg-3">{names.account.get(row.accountId) ?? ""}</span>
      <span className={cn("shrink-0 text-right font-mono text-[12px] tabular-nums", amount > 0 && "text-pos")}>{fmt.money(amount, row.currency)}</span>
    </>
  );
}
