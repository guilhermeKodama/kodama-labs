"use client";

import { useState, type ReactNode } from "react";
import { DropdownMenu } from "radix-ui";
import { useTranslations } from "next-intl";
import type { LedgerRow } from "@capital/server/modules/ledger/contracts";
import { Menu, MenuItem, MenuSep } from "@/components/cap";
import { FLOATING, MENU_ROW } from "@/components/cap/styles";
import { apiPost } from "@/lib/api/client";
import { useNames } from "@/lib/api/catalog";
import { useAppMutation } from "@/lib/api/use-app-mutation";
import { needsScopeQuestion } from "@/lib/ledger/delete-scope";
import { useShortcut, useShortcutLabel } from "@/lib/shortcuts/provider";
import { cn } from "@/lib/utils";
import { DeleteScopeDialog } from "./delete-scope-dialog";
import { useCategoryChange, useEntryPatch } from "./inline-edit";
import { useLedgerOverlays } from "./overlay-state";
import type { DisplayRow } from "./rows";

/**
 * What can be done to one transaction row, shared by the table's ⋯ menu,
 * the row shortcuts (↵ open, ⌫ delete, ⌘D duplicate) and the detail
 * sheet, so they all behave the same (mockup DeleteFlow 5270-5465).
 */
export interface RowActions {
  /** Opens the detail sheet (?entry=). */
  open: (row: ActionRow) => void;
  /**
   * Deletes the row with Desfazer: at once when it stands alone, after the
   * scope question for recurring, installment and investment-linked rows.
   */
  remove: (row: ActionRow) => void;
  duplicate: (row: ActionRow) => void;
  /** Dialogs these actions open (the delete scope); render it next to whatever uses the actions. */
  dialogs: ReactNode;
}

/** What the actions read from a row: a table row (DisplayRow) or an entry as GET /v2/ledger/entries/{id} returns it. */
export type ActionRow = Pick<LedgerRow, "id" | "description" | "kind"> &
  Partial<Pick<LedgerRow, "isRecurring" | "recurringRuleId" | "installmentPlanId" | "transferDirection">> & {
    /** Every leg of a transfer (duplicating copies the whole transfer either way). */
    legIds?: readonly string[];
    linkedOperationId?: string | null;
  };

type RowLike = ActionRow;

/** `onDeleted` runs after a delete went through (the sheet closes then). */
export function useRowActions({ onDeleted }: { onDeleted?: () => void } = {}): RowActions {
  const t = useTranslations("entry.toast");
  const overlays = useLedgerOverlays();
  const [asking, setAsking] = useState<{ id: string; description: string } | null>(null);
  const remove = useAppMutation({
    event: "ledger.write",
    mutationFn: (row: RowLike) => apiPost<{ batchId: string | null }>(`/api/v2/ledger/entries/${encodeURIComponent(row.id)}/delete`, { scope: "one" }),
    undo: (_result, row) => t("deleted", { description: row.description }),
    onSuccess: () => onDeleted?.(),
  });
  const duplicate = useAppMutation({
    event: "ledger.write",
    mutationFn: (row: RowLike) => apiPost<{ batchId: string | null; affected: number }>("/api/v2/ledger/bulk", { op: "duplicate", selection: { ids: row.legIds?.length ? row.legIds : [row.id] } }),
    undo: (_result, row) => t("duplicated", { description: row.description }),
  });
  return {
    open: (row) => overlays.openEntry(row.id),
    remove: (row) => (needsScopeQuestion(row) ? setAsking({ id: row.id, description: row.description }) : remove.mutate(row)),
    duplicate: (row) => duplicate.mutate(row),
    dialogs: (
      <DeleteScopeDialog
        entryId={asking?.id ?? null}
        description={asking?.description}
        onOpenChange={(open) => !open && setAsking(null)}
        onDeleted={() => {
          setAsking(null);
          onDeleted?.();
        }}
      />
    ),
  };
}

/**
 * Row shortcuts for the focused row (mockup Atalhos 6362-6368 and the row
 * menu 5426-5433): ↵ or E opens it to edit, ⌘D duplicates it, ⌫ deletes
 * it. The table calls this with the row that has keyboard focus (null for
 * none) and renders `actions.dialogs`.
 */
export function useRowShortcuts(row: ActionRow | null, actions: RowActions) {
  useShortcut(["enter", "e"], () => (row ? actions.open(row) : false), { enabled: !!row });
  useShortcut("mod+d", () => (row ? actions.duplicate(row) : false), { enabled: !!row });
  useShortcut(["backspace", "delete"], () => (row ? actions.remove(row) : false), { enabled: !!row });
}

const SUB_TRIGGER = cn(MENU_ROW, "text-fg-1 data-[state=open]:bg-fill-3");

/**
 * The ⋯ at the end of a table row (mockup 2617-2620, 5426-5433): Abrir
 * detalhe ↵, Editar E (the detail sheet is the edit form), Duplicar ⌘D, Mover para entidade…, Mudar categoria…, Excluir ⌫. A
 * transfer keeps its entity and category (edit its endpoints in the sheet).
 */
export function RowActionsMenu({ row }: { row: DisplayRow }) {
  const t = useTranslations("entry.rowMenu");
  const actions = useRowActions();
  return (
    <>
      <Menu
        align="end"
        trigger={
          <button
            type="button"
            aria-label={t("label")}
            onClick={(event) => event.stopPropagation()}
            className="h-[22px] w-full cursor-pointer rounded-[5px] text-center leading-[22px] text-fg-3 outline-none hover:bg-fill-2 focus-visible:bg-fill-2 data-[state=open]:bg-fill-2"
          >
            ⋯
          </button>
        }
      >
        <RowMenuItems row={row} actions={actions} />
      </Menu>
      {actions.dialogs}
    </>
  );
}

/** The menu's rows, mounted only while it is open (a table has one ⋯ per row). */
function RowMenuItems({ row, actions }: { row: DisplayRow; actions: RowActions }) {
  const t = useTranslations("entry.rowMenu");
  const tToast = useTranslations("entry.toast");
  const names = useNames();
  const changeCategory = useCategoryChange(names);
  const patch = useEntryPatch();
  const duplicateKey = useShortcutLabel("mod+d");
  const transfer = !!row.transferGroupId || row.neutral;
  const categoryType = row.kind === "income" ? "income" : row.kind === "investment" ? "investment" : "expense";
  const categories = names.categories
    .filter((category) => !category.isArchived && category.type === categoryType)
    .sort((a, b) => a.name.localeCompare(b.name));
  const sub = (label: string, disabled: boolean, items: ReactNode) => (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger disabled={disabled} className={SUB_TRIGGER}>
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent sideOffset={4} collisionPadding={8} className={cn(FLOATING, "max-h-[260px] w-[200px] overflow-y-auto rounded-[8px] p-1")}>
          {items}
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  );
  return (
    <>
      <MenuItem label={t("open")} shortcut="↵" onSelect={() => actions.open(row)} />
      <MenuItem label={t("edit")} shortcut="E" onSelect={() => actions.open(row)} />
      <MenuItem label={t("duplicate")} shortcut={duplicateKey} onSelect={() => actions.duplicate(row)} />
      {sub(
        t("moveEntity"),
        transfer || row.kind === "investment",
        names.entities.map((entity) => (
          <MenuItem
            key={entity.id}
            label={names.entity.get(entity.id)}
            disabled={entity.id === row.entityId}
            onSelect={() => patch.mutate({ row, patch: { entityId: entity.id }, message: tToast("entity", { description: row.description, entity: names.entity.get(entity.id) ?? "" }) })}
          />
        )),
      )}
      {sub(
        t("changeCategory"),
        transfer,
        categories.map((category) => (
          <MenuItem key={category.id} label={category.name} disabled={category.id === row.categoryId} onSelect={() => changeCategory(row, category.id)} />
        )),
      )}
      <MenuSep />
      <MenuItem label={t("delete")} shortcut="⌫" danger onSelect={() => actions.remove(row)} />
    </>
  );
}

/** The trailing ↗ of a row (mockup 5250-5252, editMode "both"): opens the detail sheet. */
export function RowOpenButton({ row }: { row: DisplayRow }) {
  const t = useTranslations("entry.rowMenu");
  const overlays = useLedgerOverlays();
  return (
    <button
      type="button"
      title={t("openDetail")}
      aria-label={t("openDetail")}
      onClick={(event) => {
        event.stopPropagation();
        overlays.openEntry(row.id);
      }}
      className="w-full cursor-pointer text-center text-fg-3 outline-none hover:text-fg-1 focus-visible:text-fg-1"
    >
      ↗
    </button>
  );
}
