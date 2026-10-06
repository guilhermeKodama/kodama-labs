"use client";

import { useEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { LedgerRow } from "@capital/server/modules/ledger/contracts";
import { Combobox, TextInput, type ComboboxOption } from "@/components/cap";
import { apiPatch, apiPost } from "@/lib/api/client";
import { useCreateCategory, type Names } from "@/lib/api/catalog";
import { invalidateEvent } from "@/lib/api/invalidation";
import { announceWrite, rememberUndo, undoBatch } from "@/lib/api/undo";
import { useAppMutation, useErrorMessage } from "@/lib/api/use-app-mutation";
import { useFmt } from "@/lib/format/provider";
import { todayIn } from "@/lib/ledger/entry-form";
import { accountOptions, categoryOptions, entityOptions } from "@/lib/pickers/options";
import { cn } from "@/lib/utils";
import { DateInput } from "./entry/date-input";
import type { DisplayRow } from "./rows";

/** Table columns that can be edited in place. */
export type EditableField = "description" | "amount" | "date" | "categoryId" | "accountId" | "entityId" | "notes";

export interface EditableCellProps {
  row: DisplayRow;
  field: EditableField;
  names: Names;
  /** The cell as it reads when not editing. */
  children: ReactNode;
  /** Read-only, e.g. the account of a transfer leg. */
  disabled?: boolean;
  /**
   * Tab / ⇧Tab after a commit ("next" / "previous"), ↵ ("down"). The cell
   * already moves the editor to the next editable cell in the page (DOM
   * order) on Tab; this tells the table, e.g. to scroll a virtual list.
   */
  onNavigate?: (direction: "next" | "previous" | "down") => void;
}

type Patch = Partial<Record<"description" | "notes" | "date" | "categoryId" | "accountId" | "entityId", string | null> & { amount: number }>;

interface PatchRequest {
  row: Pick<DisplayRow, "id" | "description">;
  patch: Patch;
  /** Undo pill text; null to stack the batch silently (the caller toasts). */
  message: string | null;
}

/** PATCH one entry (a transfer through any leg) as one undoable batch. */
export function useEntryPatch(onSuccess?: (result: { batchId: string | null; entry: LedgerRow }, request: PatchRequest) => void) {
  return useAppMutation<{ batchId: string | null; entry: LedgerRow }, PatchRequest>({
    event: "ledger.write",
    mutationFn: ({ row, patch }) => apiPatch(`/api/v2/ledger/entries/${encodeURIComponent(row.id)}`, patch),
    undo: (_data, request) => request.message,
    onSuccess,
  });
}

/**
 * Changing one entry's category: the pill "Categoria de “X” → Y · criar
 * regra? · Desfazer" (mockup 5237), where "criar regra?" learns an
 * "equals" rule for the description.
 */
export function useCategoryChange(names: Names) {
  const t = useTranslations("entry.toast");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();
  const errorText = useErrorMessage();
  // A plain call, not a mutation hook: the toast's button outlives the menu or cell that showed it.
  const learnRule = (pattern: string, categoryId: string) =>
    apiPost<{ batchId: string | null }>("/api/v2/rules", { matchType: "equals", pattern, categoryId, entityId: null })
      .then((rule) => {
        void invalidateEvent(queryClient, "catalog.write");
        announceWrite(rule.batchId, t("ruleCreated", { pattern, category: names.category.get(categoryId) ?? "" }));
      })
      .catch((error: unknown) => toast(errorText(error)));
  const patch = useEntryPatch((result, request) => {
    const categoryId = request.patch.categoryId;
    if (!result.batchId || !categoryId) return;
    const message = t("category", { description: request.row.description, category: names.category.get(categoryId) ?? "" });
    const batchId = result.batchId;
    toast(message, {
      id: `undo:${batchId}`,
      duration: 8000,
      cancel: { label: t("createRule"), onClick: () => void learnRule(request.row.description, categoryId) },
      action: { label: tCommon("undo"), onClick: () => void undoBatch(batchId) },
    });
    rememberUndo(batchId, message);
  });
  return (row: Pick<DisplayRow, "id" | "description">, categoryId: string | null) => patch.mutate({ row, patch: { categoryId }, message: null });
}

const CELL = "[data-cell-edit]:not([data-disabled])";

/** Opens the editable cell after (or before) this one in page order: Tab moves along a row, then to the next. */
function moveEditor(from: HTMLElement | null, direction: "next" | "previous") {
  if (!from) return;
  const cells = Array.from(document.querySelectorAll<HTMLElement>(CELL));
  const index = cells.indexOf(from);
  const target = cells[index + (direction === "next" ? 1 : -1)];
  target?.click();
}

/** Focus moved into a list portaled out of the cell (the combobox popover): still editing. */
const intoPopover = (target: EventTarget | null) => target instanceof Element && !!target.closest("[data-radix-popper-content-wrapper]");

/**
 * One table cell that turns into an editor on click (mockup EditFlow
 * 5128-5266: "Clique numa célula para editar · Tab próxima célula · ↵
 * confirma · Esc cancela · ⌘Z desfaz · ↗ abre o detalhe"): text, amount and
 * date inputs, category / account / entity lists. ↵, Tab or leaving the
 * cell saves through PATCH /v2/ledger/entries/{id} (one undo batch, with
 * the mockup's toast), Esc cancels, a rejected value keeps the editor open
 * and marked.
 */
export function EditableCell({ row, field, names, children, disabled, onNavigate }: EditableCellProps) {
  const [editing, setEditing] = useState(false);
  const cellRef = useRef<HTMLSpanElement>(null);
  const transfer = !!row.transferGroupId || row.neutral;
  // A transfer's endpoints, entity and category are edited in its sheet.
  const locked = disabled || (transfer && (field === "categoryId" || field === "accountId" || field === "entityId"));
  const right = field === "amount";
  return (
    <span
      ref={cellRef}
      data-cell-edit=""
      data-field={field}
      data-row={row.id}
      data-disabled={locked || undefined}
      onClick={() => !locked && !editing && setEditing(true)}
      className={cn(
        "flex h-7 min-w-0 flex-1 items-center rounded-[5px] border px-1.5",
        editing ? "border-fg-1" : "border-transparent",
        !locked && !editing && "cursor-text",
        right && "justify-end",
      )}
    >
      {editing ? (
        <CellEditor
          row={row}
          field={field}
          names={names}
          onDone={(move) => {
            setEditing(false);
            if (move) {
              onNavigate?.(move);
              if (move !== "down") moveEditor(cellRef.current, move);
            }
          }}
        />
      ) : (
        children
      )}
    </span>
  );
}

type Move = "next" | "previous" | "down" | null;

function CellEditor({ row, field, names, onDone }: { row: DisplayRow; field: EditableField; names: Names; onDone: (move: Move) => void }) {
  const t = useTranslations("entry.toast");
  const fmt = useFmt();
  const changeCategory = useCategoryChange(names);
  const [invalid, setInvalid] = useState(false);
  const patch = useEntryPatch();
  const pendingMove = useRef<Move>(null);

  const commit = (body: Patch, message: string, move: Move) => {
    // ↵ then the blur of the closing input: one save.
    if (patch.isPending) return;
    pendingMove.current = move;
    patch.mutate(
      { row, patch: body, message },
      {
        onSuccess: () => onDone(pendingMove.current),
        onError: () => setInvalid(true),
      },
    );
  };

  const keys = (save: (move: Move) => void) => (event: KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      save("down");
    } else if (event.key === "Tab") {
      event.preventDefault();
      save(event.shiftKey ? "previous" : "next");
    } else if (event.key === "Escape") {
      event.preventDefault();
      onDone(null);
    }
  };

  if (field === "description" || field === "notes") {
    const initial = field === "description" ? row.description : (row.notes ?? "");
    return (
      <TextEditor
        initial={initial}
        invalid={invalid}
        onSave={(value, move) => {
          const text = value.trim();
          if ((field === "description" && !text) || text === initial.trim()) return onDone(move);
          commit(
            field === "description" ? { description: text } : { notes: text || null },
            field === "description" ? t("description", { description: text }) : t("notes", { description: row.description }),
            move,
          );
        }}
        onCancel={() => onDone(null)}
        keys={keys}
      />
    );
  }

  if (field === "amount") {
    const current = Math.abs(row.amount);
    return (
      <TextEditor
        initial={fmt.number(current)}
        invalid={invalid}
        mono
        onSave={(value, move) => {
          const amount = Math.abs(fmt.parseNumber(value));
          if (!Number.isFinite(amount) || amount <= 0) return setInvalid(true);
          if (Math.abs(amount - current) < 0.005) return onDone(move);
          const sign = row.amount < 0 && !row.neutral ? -1 : 1;
          commit({ amount }, t("amount", { description: row.description, amount: fmt.money(sign * amount, row.currency) }), move);
        }}
        onCancel={() => onDone(null)}
        keys={keys}
      />
    );
  }

  if (field === "date") {
    return <DateEditor row={row} invalid={invalid} onSave={(date, move) => (date === row.date.slice(0, 10) ? onDone(move) : commit({ date }, t("date", { description: row.description, date: fmt.date(date) }), move))} keys={keys} />;
  }

  return (
    <ListEditor
      row={row}
      field={field}
      names={names}
      invalid={invalid}
      onPick={(value) => {
        if (field === "categoryId") {
          if (value !== row.categoryId) changeCategory(row, value);
          return onDone(null);
        }
        if (field === "accountId") {
          if (value === row.accountId) return onDone(null);
          return commit({ accountId: value }, t("account", { description: row.description, account: names.account.get(value) ?? "" }), null);
        }
        if (value === row.entityId) return onDone(null);
        commit({ entityId: value }, t("entity", { description: row.description, entity: names.entity.get(value) ?? "" }), null);
      }}
      onCancel={() => onDone(null)}
      onMove={(move) => onDone(move)}
    />
  );
}

function TextEditor({
  initial,
  invalid,
  mono,
  onSave,
  onCancel,
  keys,
}: {
  initial: string;
  invalid: boolean;
  mono?: boolean;
  onSave: (value: string, move: Move) => void;
  onCancel: () => void;
  keys: (save: (move: Move) => void) => (event: KeyboardEvent) => void;
}) {
  const [value, setValue] = useState(initial);
  // Esc already closed the editor: the blur that follows must not save.
  const cancelled = useRef(false);
  return (
    <TextInput
      autoFocus
      value={value}
      onChange={setValue}
      mono={mono}
      invalid={invalid}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          cancelled.current = true;
          onCancel();
          return;
        }
        keys((move) => onSave(value, move))(event);
      }}
      onBlur={() => !cancelled.current && onSave(value, null)}
      onFocus={(event) => event.currentTarget.select()}
      className={cn("h-6 w-full border-none px-0", mono && "text-right")}
    />
  );
}

function DateEditor({
  row,
  invalid,
  onSave,
  keys,
}: {
  row: DisplayRow;
  invalid: boolean;
  onSave: (date: string, move: Move) => void;
  keys: (save: (move: Move) => void) => (event: KeyboardEvent) => void;
}) {
  const fmt = useFmt();
  const [value, setValue] = useState(row.date.slice(0, 10));
  return (
    <span className="flex w-full" onKeyDown={keys((move) => onSave(value, move))} onBlur={(event: FocusEvent) => !event.currentTarget.contains(event.relatedTarget) && onSave(value, null)}>
      <DateInput value={value} onChange={setValue} today={todayIn(fmt.prefs.timezone)} invalid={invalid} className="h-6 w-full border-none px-0" />
    </span>
  );
}

function ListEditor({
  row,
  field,
  names,
  invalid,
  onPick,
  onCancel,
  onMove,
}: {
  row: DisplayRow;
  field: "categoryId" | "accountId" | "entityId";
  names: Names;
  invalid: boolean;
  onPick: (value: string) => void;
  onCancel: () => void;
  /** Tab / ⇧Tab: leave the list unchanged and open the next (previous) cell. */
  onMove: (move: "next" | "previous") => void;
}) {
  const tCommon = useTranslations("common");
  const trigger = useRef<HTMLButtonElement>(null);
  const createCategory = useCreateCategory();
  const options = useMemo<ComboboxOption[]>(() => {
    if (field === "categoryId") {
      const type = row.kind === "income" ? "income" : row.kind === "investment" ? "investment" : "expense";
      return categoryOptions(names.categories, { types: [type], value: row.categoryId, archivedLabel: tCommon("pickers.archived"), typeLabel: (kind) => tCommon(`pickers.categoryType.${kind}`) });
    }
    if (field === "accountId") {
      return accountOptions(names.accounts, {
        entityIds: null,
        types: ["checking", "credit_card", "cash"],
        value: row.accountId,
        entities: names.entities,
        archivedLabel: tCommon("pickers.archived"),
        typeLabel: (type) => tCommon(`pickers.accountType.${type}`),
      });
    }
    return entityOptions(names.entities, { kinds: null, baseCurrency: names.currency });
  }, [field, names, row.kind, row.categoryId, row.accountId, tCommon]);

  // Opens the list as the cell turns into the editor.
  useEffect(() => {
    trigger.current?.click();
  }, []);

  const value = field === "categoryId" ? row.categoryId : field === "accountId" ? row.accountId : row.entityId;
  return (
    <span
      className="flex w-full"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        } else if (event.key === "Tab") {
          event.preventDefault();
          onMove(event.shiftKey ? "previous" : "next");
        }
      }}
      onBlur={(event: FocusEvent) => {
        if (!event.currentTarget.contains(event.relatedTarget) && !intoPopover(event.relatedTarget)) onCancel();
      }}
    >
      <Combobox
        ref={trigger}
        value={value}
        onChange={onPick}
        options={options}
        invalid={invalid}
        onCreate={field === "categoryId" ? (name) => createCategory.mutate({ name, type: row.kind === "income" ? "income" : "expense" }, { onSuccess: (category) => onPick(category.id) }) : undefined}
        className="h-6 w-full border-none px-0"
      />
    </span>
  );
}
