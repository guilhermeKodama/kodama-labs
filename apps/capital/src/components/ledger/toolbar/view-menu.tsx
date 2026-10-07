"use client";

import { useState, type MouseEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Copy, Ellipsis, Pencil, Star, StarOff, Trash2 } from "lucide-react";
import { Menu, MenuItem, MenuSep } from "@/components/cap";
import { cn } from "@/lib/utils";

/** What a view's menu offers; an action left out is not shown ("Todas" gets no menu at all). */
export interface ViewMenuActions {
  /** Starts renaming the view in place. */
  onRename?: () => void;
  onDuplicate?: () => void;
  /** Whether the view is a favorite (in the sidebar), with its toggle. */
  favorite?: boolean;
  onFavorite?: () => void;
  onDelete?: () => void;
}

/**
 * The open state of a view's menu: the "⋯" button opens it, and so does a
 * right click anywhere on the tab or sidebar row (`onContextMenu`).
 */
export function useViewMenu() {
  const [open, setOpen] = useState(false);
  return {
    open,
    setOpen,
    onContextMenu: (event: MouseEvent) => {
      event.preventDefault();
      setOpen(true);
    },
  };
}

/**
 * "⋯" of a view (Transações tabs and sidebar, Carteira tabs): Renomear,
 * Duplicar, Favoritar / Desfavoritar and Excluir view. Shown on hover, on
 * the active tab and while open.
 */
export function ViewMenu({
  label,
  actions,
  open,
  onOpenChange,
  visible,
  side,
  className,
}: {
  /** The view's name, for the button's accessible label. */
  label: string;
  actions: ViewMenuActions;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Always shown (the active tab); otherwise on hover or focus. */
  visible?: boolean;
  /** Where the menu opens (below the button by default; the sidebar rail opens it to the right). */
  side?: "bottom" | "right";
  className?: string;
}) {
  const t = useTranslations("ledger.viewMenu");
  return (
    <Menu
      open={open}
      onOpenChange={onOpenChange}
      side={side}
      width={190}
      trigger={
        <button
          type="button"
          aria-label={t("open", { name: label })}
          title={t("title")}
          className={cn(
            "inline-flex size-5 shrink-0 items-center justify-center rounded-[4px] text-fg-3 outline-none hover:bg-fill-3 hover:text-fg-1 focus-visible:opacity-100 data-[state=open]:bg-fill-3 data-[state=open]:opacity-100",
            visible ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            className,
          )}
        >
          <Ellipsis aria-hidden className="size-3.5" />
        </button>
      }
    >
      {actions.onRename ? <MenuItem icon={<Pencil className="size-3.5" />} label={t("rename")} onSelect={actions.onRename} /> : null}
      {actions.onDuplicate ? <MenuItem icon={<Copy className="size-3.5" />} label={t("duplicate")} onSelect={actions.onDuplicate} /> : null}
      {actions.onFavorite ? (
        <MenuItem
          icon={actions.favorite ? <StarOff className="size-3.5" /> : <Star className="size-3.5" />}
          label={t(actions.favorite ? "unfavorite" : "favorite")}
          onSelect={actions.onFavorite}
        />
      ) : null}
      {actions.onDelete ? (
        <>
          <MenuSep />
          <MenuItem icon={<Trash2 className="size-3.5 text-neg" />} label={t("delete")} danger onSelect={actions.onDelete} />
        </>
      ) : null}
    </Menu>
  );
}

/**
 * The name of a view being renamed in place: ↵ or leaving the field saves,
 * Esc cancels. Starts with the whole name selected.
 */
export function RenameInput({ name, onDone, className }: { name: string; onDone: (name: string | null) => void; className?: string }) {
  const t = useTranslations("ledger.viewMenu");
  const [value, setValue] = useState(name);
  const [done, setDone] = useState(false);
  const finish = (next: string | null) => {
    if (done) return;
    setDone(true);
    onDone(next === null || !next.trim() || next.trim() === name ? null : next.trim());
  };
  return (
    <input
      autoFocus
      value={value}
      aria-label={t("rename")}
      maxLength={120}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => finish(value)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") finish(value);
        else if (event.key === "Escape") finish(null);
      }}
      className={cn("h-[22px] min-w-0 rounded-[4px] border border-stroke-1 bg-editor px-1.5 text-[12.5px] text-fg-1 outline-none focus:border-fg-muted", className)}
    />
  );
}

/** A row or tab with its menu: the right click opens the menu (see useViewMenu). */
export function ViewMenuTarget({ children, onContextMenu, className }: { children: ReactNode; onContextMenu?: (event: MouseEvent) => void; className?: string }) {
  return (
    <div onContextMenu={onContextMenu} className={cn("group", className)}>
      {children}
    </div>
  );
}
