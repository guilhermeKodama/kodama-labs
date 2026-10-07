"use client";

import { useRef, useState, type KeyboardEvent, type Ref } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { Btn, Dialog, DialogFooter, DialogHead } from "@/components/cap";
import { cn } from "@/lib/utils";

/**
 * Whether a key press inside the confirmation confirms it: a plain Enter,
 * except on a button or link, which Enter already activates (Cancelar, ✕,
 * Excluir itself).
 */
export function confirmsOnEnter(event: {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  repeat?: boolean;
  isComposing?: boolean;
  target: { tagName?: string } | null;
}): boolean {
  if (event.key !== "Enter" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.repeat || event.isComposing) return false;
  const tag = event.target?.tagName?.toUpperCase();
  return tag !== "BUTTON" && tag !== "A";
}

/** The body of the confirmation: title, what deleting does, Cancelar / Excluir. Rendered inside a Dialog. */
export function DeleteViewConfirm({ name, onCancel, onConfirm, confirmRef }: { name: string; onCancel: () => void; onConfirm: () => void; confirmRef?: Ref<HTMLButtonElement> }) {
  const t = useTranslations("ledger.deleteView");
  const tc = useTranslations("common");
  return (
    <div
      className="flex flex-col gap-3.5"
      // The dialog is portaled, but React events still bubble to the tab or sidebar row it was opened from.
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        const { key, shiftKey, altKey, ctrlKey, metaKey, repeat } = event;
        if (!confirmsOnEnter({ key, shiftKey, altKey, ctrlKey, metaKey, repeat, isComposing: event.nativeEvent.isComposing, target: event.target as HTMLElement })) return;
        event.preventDefault();
        onConfirm();
      }}
    >
      <DialogHead title={t("title", { name })} desc={t("body")} onClose={onCancel} />
      <DialogFooter>
        <Btn ghost onClick={onCancel}>
          {tc("cancel")}
        </Btn>
        <Btn ref={confirmRef} danger onClick={onConfirm}>
          {t("confirm")}
        </Btn>
      </DialogFooter>
    </div>
  );
}

/**
 * "×" right of a view's name (Transações tabs, sidebar favorites, Carteira
 * tabs; never on Todas): the one way to delete a view. Shown on hover or
 * focus, and always when `visible` (the active tab). It asks first, in a
 * small dialog (480): Excluir (or Enter) calls `onDelete`, which deletes
 * undoably and leaves the view if it was on screen; Cancelar or Esc keeps
 * it.
 */
export function DeleteViewButton({ name, onDelete, visible, className }: { name: string; onDelete: () => void; visible?: boolean; className?: string }) {
  const t = useTranslations("ledger.deleteView");
  const [open, setOpen] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        type="button"
        aria-label={t("button", { name })}
        title={t("button", { name })}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
        className={cn(
          "inline-flex size-5 shrink-0 items-center justify-center rounded-[4px] text-fg-3 outline-none hover:bg-fill-3 hover:text-fg-1 focus-visible:opacity-100",
          visible || open ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          className,
        )}
      >
        <X aria-hidden className="size-3.5" />
      </button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        width={480}
        onOpenAutoFocus={(event) => {
          // Enter right away confirms: Excluir has the focus, not the ✕.
          event.preventDefault();
          confirmRef.current?.focus();
        }}
      >
        {open ? (
          <DeleteViewConfirm
            name={name}
            confirmRef={confirmRef}
            onCancel={() => setOpen(false)}
            onConfirm={() => {
              setOpen(false);
              onDelete();
            }}
          />
        ) : null}
      </Dialog>
    </>
  );
}
