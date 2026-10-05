"use client";

import { useEffect, useSyncExternalStore, type ComponentProps, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Briefcase, PiggyBank, Plus, Search, Target } from "lucide-react";
import { Kbd } from "@/components/cap";
import { BACKDROP } from "@/components/cap/styles";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { api, apiPost } from "@/lib/api/client";
import { keys } from "@/lib/api/keys";
import { useSession } from "@/lib/api/session";
import { useAppMutation } from "@/lib/api/use-app-mutation";
import { layoutGlyph } from "@/lib/ledger/view-glyphs";
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
  type SidebarViewLike,
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

interface SidebarView extends SidebarViewLike {
  name: string;
  config: { layout: string };
}

/** 28px row, radius 6, 12.5px; the active one on fill.secondary in the primary ink. */
const ITEM = "flex h-7 shrink-0 items-center gap-2 rounded-[6px] px-2 text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-fg-3/40";
const RAIL_ITEM = "flex size-8 shrink-0 items-center justify-center rounded-[6px] text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-fg-3/40";
const ON = "bg-fill-2 font-medium text-fg-1";
const OFF = "text-fg-2 hover:bg-fill-3";

/**
 * "+ Nova view": creates a blank favorite view ("Nova view", the
 * defaults of a new table) and opens it on Transações with Exibição open,
 * where a new view starts.
 */
export function useNewView(onNavigate?: () => void) {
  const t = useTranslations("shell.nav");
  const router = useRouter();
  const queryClient = useQueryClient();
  return useAppMutation({
    event: "views.write",
    mutationFn: () => apiPost<SidebarView>("/api/v2/views", { name: t("newView"), dataset: "ledger", isFavorite: true, config: {} }),
    onSuccess: (view) => {
      // In the list before Transações reads it, so the screen opens this view and not the first one while the list refetches.
      queryClient.setQueryData<SidebarView[]>(keys.views("ledger"), (views) => (views && !views.some((item) => item.id === view.id) ? [...views, view] : views));
      onNavigate?.();
      router.push(buildTransactionsHref({ viewId: view.id, display: true }));
    },
  });
}

function SidebarContent({ rail, onNavigate }: { rail: boolean; onNavigate?: () => void }) {
  const t = useTranslations("shell.nav");
  const pathname = usePathname();
  const params = useSearchParams();
  const session = useSession();
  const searchLabel = useShortcutLabel(SHELL_SHORTCUTS.command.combo);
  const views = useQuery({
    queryKey: keys.views("ledger"),
    queryFn: () => api<SidebarView[]>("/api/v2/views?dataset=ledger"),
  });
  const newView = useNewView(onNavigate);
  const user = session.data;
  const list = views.data ?? [];
  const activeId = pathname === TRANSACTIONS_PATH ? activeViewId(list, params.get("view")) : null;

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
      {favoriteViews(list).map((view) => {
        const on = view.id === activeId;
        const href = buildTransactionsHref({ viewId: view.id });
        const glyph = layoutGlyph(view.config.layout);
        return rail ? (
          <Link key={view.id} href={href} title={view.name} aria-label={view.name} aria-current={on ? "page" : undefined} onClick={onNavigate} className={cn(RAIL_ITEM, on ? ON : OFF)}>
            <span className="text-[12px]">{glyph}</span>
          </Link>
        ) : (
          <Link key={view.id} href={href} aria-current={on ? "page" : undefined} onClick={onNavigate} className={cn(ITEM, on ? ON : OFF)}>
            <span aria-hidden className="w-3 shrink-0 text-[11px] text-fg-3">
              {glyph}
            </span>
            <span className="truncate">{view.name}</span>
          </Link>
        );
      })}
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
            <span aria-hidden className="w-3 shrink-0">
              +
            </span>
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
