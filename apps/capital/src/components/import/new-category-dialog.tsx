"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Btn, Dialog, DialogFooter, DialogHead, Field, Kbd, Select, TextInput } from "@/components/cap";
import { useCreateCategory, type CategoryRecord, type CategoryType } from "@/lib/api/catalog";
import { useShortcut, useShortcutLabel } from "@/lib/shortcuts/provider";

/**
 * "Nova categoria" form opened from a review row's "+ Criar categoria…":
 * name (prefilled with what was typed in the picker) and type (only the
 * types that row accepts). The created category is passed to `onCreated`,
 * which picks it for the row.
 */
export function NewCategoryDialog({
  open,
  onOpenChange,
  initialName,
  types,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName: string;
  /** Types the row accepts; the first is preselected. */
  types: readonly CategoryType[];
  onCreated: (category: CategoryRecord) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} width={460}>
      {open ? (
        <NewCategoryForm
          initialName={initialName}
          types={types}
          onCancel={() => onOpenChange(false)}
          onCreated={(category) => {
            onOpenChange(false);
            onCreated(category);
          }}
        />
      ) : null}
    </Dialog>
  );
}

// Mounted only while open, so every opening starts from the props.
function NewCategoryForm({
  initialName,
  types,
  onCancel,
  onCreated,
}: {
  initialName: string;
  types: readonly CategoryType[];
  onCancel: () => void;
  onCreated: (category: CategoryRecord) => void;
}) {
  const t = useTranslations("import.review.newCategory");
  const tCommon = useTranslations("common");
  const ids = useId();
  const create = useCreateCategory();
  const submitHint = useShortcutLabel("mod+enter");
  const [name, setName] = useState(initialName);
  const [type, setType] = useState<CategoryType>(types[0] ?? "expense");
  const [showErrors, setShowErrors] = useState(false);
  const trimmed = name.trim();
  const invalid = showErrors && (!trimmed || trimmed.length > 80);

  const submit = () => {
    if (!trimmed || trimmed.length > 80) {
      setShowErrors(true);
      return;
    }
    if (!create.isPending) create.mutate({ name: trimmed, type }, { onSuccess: onCreated });
  };
  useShortcut("mod+enter", submit, { allowInInputs: true });

  return (
    <form
      className="flex flex-col gap-3.5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <DialogHead title={t("title")} />
      <div className="grid grid-cols-2 gap-2.5">
        <Field label={t("name")} htmlFor={`${ids}-name`}>
          <TextInput id={`${ids}-name`} value={name} onChange={setName} invalid={invalid} maxLength={80} autoFocus />
        </Field>
        <Field label={t("type")} htmlFor={`${ids}-type`}>
          <Select
            id={`${ids}-type`}
            value={type}
            onChange={(next) => setType(next as CategoryType)}
            options={types.map((value) => ({ value, label: tCommon(`pickers.categoryType.${value}`) }))}
            disabled={types.length < 2}
          />
        </Field>
      </div>
      <DialogFooter>
        <Btn ghost onClick={onCancel}>
          {tCommon("cancel")}
        </Btn>
        <Kbd>{submitHint}</Kbd>
        <Btn primary type="submit" disabled={create.isPending}>
          {t("submit")}
        </Btn>
      </DialogFooter>
    </form>
  );
}
