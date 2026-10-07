"use client";

import { useEffect, useState, useSyncExternalStore, type ComponentProps, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Briefcase, PiggyBank, Plus, Search, Target } from "lucide-react";
import { Kbd } from "@/components/cap";
import { BACKDROP } from "@/components/cap/styles";
import { LayoutIcon } from "@/components/ledger/toolbar/layout-icon";
import { RenameInput, useViewMenu, ViewMenu, ViewMenuTarget } from "@/components/ledger/toolbar/view-menu";
import { Link, usePathname } from "@/i18n/navigation";
import { useSession } from "@/lib/api/session";
import { useLedgerViewActions, useLedgerViews, useNewView, type LedgerView } from "@/lib/ledger/use-views";
import { buildTransactionsHref } from "@/lib/ledger/view-draft";
import { openCommandMenu } from "@/lib/shell/command-menu";
import { SHELL_SHORTCUTS, TRANSACTIONS_PATH } from "@/lib/shell/shortcuts";
import {
  activeViewId,
  createSidebarStore,
  favoriteViews,
  SIDEBAR_DRAWER_QUERY,
  type SidebarState,
  type SidebarStore,
} from "@/lib/shell/sidebar";
import { firstName, initials } from "@/lib/shell/user";
import { OverlayScope, useOverlay, useShortcutLabel } from "@/lib/shortcuts/provider";
import { cn } from "@/lib/utils";
import { UserMenu } from "./user-menu";

// ---------------------------------------------------------------------------
// State: rail or expanded (kept in localStorage), drawer below md
// ---------------------------------------------------------------------------

let store: SidebarStore | null = null;

function sidebarStore(): SidebarStore {
  if (!store) {
    let storage: Storage | null = null;
    try {
      storage = window.localStorage;
    } catch {
      storage = null;
    }
    store = createSidebarStore(storage);
  }
  return store;
}

const SERVER_STATE: SidebarState = { mode: "expanded", drawerOpen: false };
const subscribe = (listener: () => void) => sidebarStore().subscribe(listener);
const snapshot = () => sidebarStore().get();
const serverSnapshot = () => SERVER_STATE;

export function useSidebar(): SidebarState {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

/** ▤ and ⌘B: the rail on wide screens, the drawer on narrow ones. */
export function toggleSidebar(): void {
  sidebarStore().toggle(window.matchMedia(SIDEBAR_DRAWER_QUERY).matches);
}

function subscribeNarrow(listener: () => void) {
  const query = window.matchMedia(SIDEBAR_DRAWER_QUERY);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

/** Below md, where ▤ opens the drawer instead of switching the rail. */
function useNarrow(): boolean {
  return useSyncExternalStore(subscribeNarrow, () => window.matchMedia(SIDEBAR_DRAWER_QUERY).matches, () => false);
}

/** ▤ at the start of every page header. */
export function SidebarTrigger() {
  const t = useTranslations("shell.sidebar");
  const { mode } = useSidebar();
  const narrow = useNarrow();
  const shortcut = useShortcutLabel(SHELL_SHORTCUTS.sidebar.combo);
  const label = narrow ? t("openMenu") : mode === "rail" ? t("expand") : t("collapse");
  return (
    <button
      type="button"
      onClick={toggleSidebar}
      title={`${label} (${shortcut})`}
      aria-label={label}
      className="text-[13px] text-fg-3 outline-none hover:text-fg-strong focus-visible:text-fg-strong"
    >
      ▤
    </button>
  );
}

// ---------------------------------------------------------------------------
// Content (mockup MockSidebar)
// ---------------------------------------------------------------------------

/** 28px row, radius 6, 12.5px; the active one on fill.secondary in the primary ink. */
const ITEM = "flex h-7 shrink-0 items-center gap-2 rounded-[6px] px-2 text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-fg-3/40";
const RAIL_ITEM = "flex size-8 shrink-0 items-center justify-center rounded-[6px] text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-fg-3/40";
const ON = "bg-fill-2 font-medium text-fg-1";
const OFF = "text-fg-2 hover:bg-fill-3";

/**
 * A favorite view in the sidebar: layout icon and name, and the view's
 * menu on "⋯" or a right click (Renomear in place, Duplicar, Desfavoritar,
 * Excluir view; nothing for Todas). The rail has no room to rename, so its
 * menu (right click) leaves Renomear out.
 */
function SidebarViewItem({
  view,
  rail,
  on,
  onNavigate,
  actions,
}: {
  view: LedgerView;
  rail: boolean;
  on: boolean;
  onNavigate?: () => void;
  actions: ReturnType<typeof useLedgerViewActions>;
}) {
  const menu = useViewMenu();
  const [renaming, setRenaming] = useState(false);
  const href = buildTransactionsHref({ viewId: view.id });
  const editable = !view.isBuiltin;
  if (rail) {
    // No room to rename in place: the right click (or the hidden "⋯", reached with Tab) offers the rest, to the right.
    const link = (
      <Link href={href} title={view.name} aria-label={view.name} aria-current={on ? "page" : undefined} onClick={onNavigate} className={cn(RAIL_ITEM, on ? ON : OFF)}>
        <LayoutIcon layout={view.config.layout} className="size-3.5" />
      </Link>
    );
    if (!editable) return link;
    return (
      <ViewMenuTarget onContextMenu={menu.onContextMenu} className="relative flex shrink-0">
        {link}
        <ViewMenu
          label={view.name}
          open={menu.open}
          onOpenChange={menu.setOpen}
          side="right"
          className="pointer-events-none absolute inset-0 size-auto bg-fill-2 group-hover:opacity-0 focus-visible:pointer-events-auto data-[state=open]:opacity-0"
          actions={{
            onDuplicate: () => actions.duplicate(view),
            favorite: view.isFavorite,
            onFavorite: () => actions.toggleFavorite(view),
            onDelete: () => actions.remove(view),
          }}
        />
      </ViewMenuTarget>
    );
  }
  if (renaming) {
    // The menu is unmounted while renaming, so closing it cannot take the focus back from the field.
    return (
      <div className={cn(ITEM, ON)}>
        <LayoutIcon layout={view.config.layout} />
        <RenameInput
          name={view.name}
          className="w-full"
          onDone={(name) => {
            setRenaming(false);
            if (name) actions.rename(view, name);
          }}
        />
      </div>
    );
  }
  return (
    <ViewMenuTarget onContextMenu={editable ? menu.onContextMenu : undefined} className={cn("relative flex shrink-0 items-center rounded-[6px]", on ? ON : OFF)}>
      <Link href={href} aria-current={on ? "page" : undefined} onClick={onNavigate} className={cn(ITEM, "min-w-0 flex-1", editable && "pr-7")}>
        <LayoutIcon layout={view.config.layout} />
        <span className="truncate">{view.name}</span>
      </Link>
      {editable ? (
        <ViewMenu
          label={view.name}
          open={menu.open}
          onOpenChange={menu.setOpen}
          className="absolute right-1"
          actions={{
            onRename: () => setRenaming(true),
            onDuplicate: () => actions.duplicate(view),
            favorite: view.isFavorite,
            onFavorite: () => actions.toggleFavorite(view),
            onDelete: () => actions.remove(view),
          }}
        />
      ) : null}
    </ViewMenuTarget>
  );
}

function SidebarContent({ rail, onNavigate }: { rail: boolean; onNavigate?: () => void }) {
  const t = useTranslations("shell.nav");
  const pathname = usePathname();
  const params = useSearchParams();
  const session = useSession();
  const searchLabel = useShortcutLabel(SHELL_SHORTCUTS.command.combo);
  const views = useLedgerViews();
  const newView = useNewView(onNavigate);
  const user = session.data;
  const list = views.data ?? [];
  const activeId = pathname === TRANSACTIONS_PATH ? activeViewId(list, params.get("view")) : null;
  const actions = useLedgerViewActions({ activeId, onNavigate });

  const nav = (href: string, label: string, icon: ReactNode) => {
    const on = pathname === href;
    return rail ? (
      <Link href={href} title={label} aria-label={label} aria-current={on ? "page" : undefined} onClick={onNavigate} className={cn(RAIL_ITEM, on ? ON : OFF)}>
        {icon}
      </Link>
    ) : (
      <Link href={href} aria-current={on ? "page" : undefined} onClick={onNavigate} className={cn(ITEM, on ? ON : OFF)}>
        {label}
      </Link>
    );
  };
  const section = (label: string) =>
    rail ? <span aria-hidden className="my-1.5 h-px w-6 shrink-0 bg-stroke-3" /> : <p className="shrink-0 px-2 pt-3 pb-1 text-[11px] text-fg-3">{label}</p>;
  const openCommand = () => {
    onNavigate?.();
    openCommandMenu();
  };
  const accountName = firstName(user?.name, user?.email);
  const avatar = (
    <span aria-hidden className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-fill-2 text-[10px] font-semibold text-fg-1">
      {initials(user?.name, user?.email)}
    </span>
  );

  return (
    <>
      <div className={cn("flex shrink-0 items-center gap-2", rail ? "justify-center pt-1 pb-2" : "px-1.5 pt-1 pb-2")}>
        <span aria-hidden className="inline-flex size-6 shrink-0 items-center justify-center rounded-[6px] bg-fg-1 text-[12px] font-bold text-editor">
          C
        </span>
        {rail ? null : <span className="text-[12.5px] font-semibold">Capital</span>}
      </div>
      {rail ? (
        <button
          type="button"
          onClick={openCommand}
          title={t("railSearch", { shortcut: searchLabel })}
          aria-label={t("search")}
          className={cn(RAIL_ITEM, "mb-1 text-fg-3 hover:bg-fill-3")}
        >
          <Search className="size-3.5" />
        </button>
      ) : (
        <button
          type="button"
          onClick={openCommand}
          className="mb-1 flex h-7 shrink-0 items-center gap-1.5 rounded-[6px] border border-stroke-2 px-2 text-[12px] text-fg-3 outline-none hover:text-fg-2 focus-visible:ring-2 focus-visible:ring-fg-3/40"
        >
          <span className="flex-1 truncate text-left">{t("search")}</span>
          <Kbd>{searchLabel}</Kbd>
        </button>
      )}
      {section(t("transactions"))}
      {favoriteViews(list).map((view) => (
        <SidebarViewItem key={view.id} view={view} rail={rail} on={view.id === activeId} onNavigate={onNavigate} actions={actions} />
      ))}
      <button
        type="button"
        disabled={newView.isPending}
        onClick={() => newView.mutate()}
        title={rail ? t("newView") : undefined}
        aria-label={rail ? t("newView") : undefined}
        className={cn(rail ? RAIL_ITEM : ITEM, "text-left text-fg-3 hover:bg-fill-3 disabled:cursor-progress")}
      >
        {rail ? (
          <Plus className="size-3.5" />
        ) : (
          <>
            <Plus aria-hidden className="size-3.5 shrink-0" />
            <span>{t("newView")}</span>
          </>
        )}
      </button>
      {nav("/transactions/budgets", t("budgets"), <Target className="size-3.5" />)}
      {section(t("investments"))}
      {nav("/investments", t("portfolio"), <Briefcase className="size-3.5" />)}
      {nav("/investments/contributions", t("contributions"), <PiggyBank className="size-3.5" />)}
      <div className="flex-1" />
      {rail ? (
        <UserMenu
          side="right"
          onNavigate={onNavigate}
          trigger={
            <FooterButton title={accountName} aria-label={accountName} className="mt-1 justify-center rounded-full">
              {avatar}
            </FooterButton>
          }
        />
      ) : (
        <div className="shrink-0 border-t border-stroke-3">
          <UserMenu
            onNavigate={onNavigate}
            trigger={
              <FooterButton className="w-full gap-2 rounded-[6px] px-1.5 py-2 text-left hover:bg-fill-3 data-[state=open]:bg-fill-3">
                {avatar}
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[12px] text-fg-1">{accountName}</span>
                  <span className="truncate text-[11px] text-fg-3">{t("accountHint")}</span>
                </span>
              </FooterButton>
            }
          />
        </div>
      )}
    </>
  );
}

/** The footer block as the user menu's trigger (Radix passes ref and props). */
function FooterButton({ className, ...props }: ComponentProps<"button">) {
  return <button type="button" {...props} className={cn("flex shrink-0 items-center outline-none focus-visible:ring-2 focus-visible:ring-fg-3/40", className)} />;
}

// ---------------------------------------------------------------------------
// Placements: in the page (md and up) and as a drawer (below md)
// ---------------------------------------------------------------------------

/** The persistent sidebar of the (app) layout, 200px or a 48px rail; hidden below md. */
export function Sidebar() {
  const { mode } = useSidebar();
  const rail = mode === "rail";
  return (
    <aside
      className={cn(
        "hidden h-dvh min-h-0 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-stroke-3 bg-chrome md:flex",
        rail ? "w-12 items-center px-1.5 py-2" : "w-[200px] p-2",
      )}
    >
      <SidebarContent rail={rail} />
    </aside>
  );
}

/** Below md the sidebar opens over the page from ▤ (or ⌘B) and closes on navigation. */
export function SidebarDrawer() {
  const { drawerOpen } = useSidebar();
  const overlayId = useOverlay(drawerOpen);
  const close = () => sidebarStore().setDrawerOpen(false);

  // Growing past md puts the sidebar back in the page.
  useEffect(() => {
    const query = window.matchMedia(SIDEBAR_DRAWER_QUERY);
    const onChange = () => {
      if (!query.matches) sidebarStore().setDrawerOpen(false);
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return (
    <DialogPrimitive.Root open={drawerOpen} onOpenChange={(open) => sidebarStore().setDrawerOpen(open)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={cn(BACKDROP, "md:hidden")} />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 left-0 z-50 flex w-[240px] max-w-[85vw] flex-col gap-0.5 overflow-y-auto border-r border-stroke-1 bg-chrome p-2 text-fg-1 outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-left-4 md:hidden"
        >
          <DialogPrimitive.Title className="sr-only">Capital</DialogPrimitive.Title>
          <OverlayScope id={overlayId}>
            <SidebarContent rail={false} onNavigate={close} />
          </OverlayScope>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
