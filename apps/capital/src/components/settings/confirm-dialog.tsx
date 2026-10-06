"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Btn, Dialog, DialogFooter, DialogHead } from "@/components/cap";
import { useShortcut } from "@/lib/shortcuts/provider";

/** A yes/no confirmation (480px): Cancelar and the action; ⌘↵ confirms, Esc cancels. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  desc,
  confirmLabel,
  onConfirm,
  danger,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  desc?: ReactNode;
  confirmLabel: ReactNode;
  onConfirm: () => void;
  danger?: boolean;
  pending?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} width={480}>
      {open ? <ConfirmBody title={title} desc={desc} confirmLabel={confirmLabel} onConfirm={onConfirm} onCancel={() => onOpenChange(false)} danger={danger} pending={pending} /> : null}
    </Dialog>
  );
}

function ConfirmBody({
  title,
  desc,
  confirmLabel,
  onConfirm,
  onCancel,
  danger,
  pending,
}: {
  title: ReactNode;
  desc?: ReactNode;
  confirmLabel: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
  pending?: boolean;
}) {
  const t = useTranslations("common");
  useShortcut("mod+enter", () => {
    if (!pending) onConfirm();
  }, { allowInInputs: true });
  return (
    <>
      <DialogHead title={title} desc={desc} />
      <DialogFooter>
        <Btn ghost onClick={onCancel}>
          {t("cancel")}
        </Btn>
        <Btn primary={!danger} danger={danger} disabled={pending} onClick={onConfirm}>
          {confirmLabel}
        </Btn>
      </DialogFooter>
    </>
  );
}
