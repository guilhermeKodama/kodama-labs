"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import type { LedgerView } from "@/lib/ledger/use-views";
import { cn } from "@/lib/utils";
import { DeleteViewButton } from "./delete-view";
import { LayoutIcon } from "./layout-icon";
import { RenameInput, useViewMenu, ViewMenu, ViewMenuTarget } from "./view-menu";

/** What the tabs can do to a view (its menu and its "×"); Todas gets none. */
export interface ViewTabActions {
  rename: (view: LedgerView, name: string) => void;
  duplicate: (view: LedgerView) => void;
  toggleFavorite: (view: LedgerView) => void;
  remove: (view: LedgerView) => void;
}

function ViewTab({ view, on, dirty, onPick, actions }: { view: LedgerView; on: boolean; dirty: boolean; onPick: () => void; actions: ViewTabActions }) {
  const t = useTranslations("ledger.tabs");
  const menu = useViewMenu();
  const [renaming, setRenaming] = useState(false);
  const editable = !view.isBuiltin;
  return (
    <ViewMenuTarget
      onContextMenu={editable && !renaming ? menu.onContextMenu : undefined}
      className={cn("inline-flex h-[38px] shrink-0 items-center gap-0.5 border-b-2", on ? "border-fg-1" : "border-transparent")}
    >
      {renaming ? (
        // The menu is unmounted while renaming, so closing it cannot take the focus back from the field.
        <span className="inline-flex items-center gap-1.5 px-2">
          <LayoutIcon layout={view.config.layout} />
          <RenameInput
            name={view.name}
            className="w-[150px]"
            onDone={(name) => {
              setRenaming(false);
              if (name) actions.rename(view, name);
            }}
          />
        </span>
      ) : (
        <>
          <button
            type="button"
            onClick={onPick}
            onDoubleClick={editable ? () => setRenaming(true) : undefined}
            className={cn(
              "inline-flex h-full items-center gap-1.5 pl-2 text-[12.5px] whitespace-nowrap outline-none focus-visible:bg-fill-4",
              editable ? "pr-0.5" : "pr-2",
              on ? "font-medium text-fg-1" : "text-fg-3 hover:text-fg-strong",
            )}
          >
            <LayoutIcon layout={view.config.layout} />
            {view.name}
            {view.isBuiltin ? <span className="text-[10px] text-fg-4">{t("fixed")}</span> : null}
            {on && dirty ? <span title={t("modified")} className="size-1.5 rounded-full bg-cat-yellow" /> : null}
          </button>
          {editable ? <DeleteViewButton name={view.name} visible={on} onDelete={() => actions.remove(view)} /> : null}
          {editable ? (
            <ViewMenu
              label={view.name}
              open={menu.open}
              onOpenChange={menu.setOpen}
              visible={on}
              className="mr-1"
              actions={{
                onRename: () => setRenaming(true),
                onDuplicate: () => actions.duplicate(view),
                favorite: view.isFavorite,
                onFavorite: () => actions.toggleFavorite(view),
              }}
            />
          ) : null}
        </>
      )}
    </ViewMenuTarget>
  );
}

/**
 * The view tabs above the table (mockup 2196–2231): layout icon, name,
 * "fixa" on Todas, the active underline, the yellow dot while the active
 * view has an unsaved draft, "×" to delete the view (after a confirmation),
 * "⋯" (or a right click, or a double click to rename) for the view's menu,
 * and "+" for a new view. Todas has neither "×" nor "⋯".
 */
export function ViewTabs({
  views,
  activeId,
  dirty,
  onPick,
  onNew,
  creating,
  actions,
}: {
  views: readonly LedgerView[];
  activeId: string | null;
  dirty: boolean;
  onPick: (view: LedgerView) => void;
  onNew: () => void;
  creating?: boolean;
  actions: ViewTabActions;
}) {
  const t = useTranslations("ledger.tabs");
  return (
    <div className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-stroke-3 px-2.5">
      {views.map((view) => (
        <ViewTab key={view.id} view={view} on={view.id === activeId} dirty={dirty} onPick={() => onPick(view)} actions={actions} />
      ))}
      <button
        type="button"
        title={t("newView")}
        aria-label={t("newView")}
        disabled={creating}
        onClick={onNew}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-[6px] text-fg-3 hover:bg-fill-3 hover:text-fg-strong disabled:opacity-40"
      >
        <Plus aria-hidden className="size-3.5" />
      </button>
    </div>
  );
}
