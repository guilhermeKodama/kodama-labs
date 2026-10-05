"use client";

import { useId, useMemo, useState, type RefObject } from "react";
import { useTranslations } from "next-intl";
import { Btn, Dialog, DialogFooter, DialogHead, Field, Kbd, Select, TextInput } from "@/components/cap";
import { ACCOUNT_TYPES, useCreateAccount, useCurrencies, type AccountRecord, type AccountType } from "@/lib/api/catalog";
import { useSession } from "@/lib/api/session";
import { accountFormErrors, toAccountInput, type AccountFormState } from "@/lib/pickers/account-form";
import { useShortcut, useShortcutLabel } from "@/lib/shortcuts/provider";
import { EntitySelect } from "./entity-select";

/**
 * "Nova conta" mini form opened from an account field: name, type,
 * entity, currency and, for cards, the closing and due days. The new
 * account is passed to `onCreated` (the field selects it). On close,
 * focus goes back to `returnFocusRef` (the field), not to <body>.
 */
export function NewAccountDialog({
  open,
  onOpenChange,
  initialName = "",
  entityId,
  types,
  onCreated,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName?: string;
  /** Preselected entity (the field's entity filter). */
  entityId?: string | null;
  /** Types the field accepts; the first is preselected. */
  types?: readonly AccountType[];
  onCreated: (account: AccountRecord) => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      width={480}
      onCloseAutoFocus={(event) => {
        const target = returnFocusRef?.current;
        if (!target?.isConnected) return;
        event.preventDefault();
        target.focus();
      }}
    >
      <NewAccountForm
        initialName={initialName}
        entityId={entityId}
        types={types?.length ? types : ACCOUNT_TYPES}
        onCancel={() => onOpenChange(false)}
        onCreated={(account) => {
          onOpenChange(false);
          onCreated(account);
        }}
      />
    </Dialog>
  );
}

// Mounted only while the dialog is open, so every opening starts from the props.
function NewAccountForm({
  initialName,
  entityId,
  types,
  onCancel,
  onCreated,
}: {
  initialName: string;
  entityId?: string | null;
  types: readonly AccountType[];
  onCancel: () => void;
  onCreated: (account: AccountRecord) => void;
}) {
  const t = useTranslations("common");
  const ids = useId();
  const me = useSession().data;
  const currencies = useCurrencies();
  const create = useCreateAccount();
  const submitHint = useShortcutLabel("mod+enter");

  const defaultEntity = entityId ?? me?.personalEntityId ?? null;
  const entityCurrency = (id: string | null) => me?.entities.find((entity) => entity.id === id)?.defaultCurrency ?? me?.baseCurrency ?? "BRL";
  const [form, setForm] = useState<AccountFormState>(() => ({
    name: initialName,
    type: types[0],
    entityId: defaultEntity,
    currency: entityCurrency(defaultEntity),
    closingDay: "",
    dueDay: "",
  }));
  const [showErrors, setShowErrors] = useState(false);
  const errors: ReadonlySet<string> = showErrors ? accountFormErrors(form) : new Set();
  const update = (patch: Partial<AccountFormState>) => setForm((current) => ({ ...current, ...patch }));

  const currencyOptions = useMemo(() => {
    const codes = new Set([...(currencies.data?.currencies ?? []).map((currency) => currency.code), form.currency, me?.baseCurrency ?? "BRL"]);
    const names = new Map((currencies.data?.currencies ?? []).map((currency) => [currency.code, currency.name]));
    return [...codes].sort().map((code) => ({ value: code, label: code, hint: names.get(code) }));
  }, [currencies.data, form.currency, me?.baseCurrency]);

  const submit = () => {
    const input = toAccountInput(form);
    if (!input) {
      setShowErrors(true);
      return;
    }
    if (!create.isPending) create.mutate(input, { onSuccess: onCreated });
  };
  useShortcut("mod+enter", submit, { allowInInputs: true });

  const isCard = form.type === "credit_card";
  return (
    <form
      className="flex flex-col gap-3.5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <DialogHead title={t("pickers.newAccount.title")} />
      <div className="grid grid-cols-2 gap-2.5">
        <Field label={t("pickers.newAccount.name")} htmlFor={`${ids}-name`} span={2}>
          <TextInput id={`${ids}-name`} value={form.name} onChange={(name) => update({ name })} invalid={errors.has("name")} autoFocus />
        </Field>
        <Field label={t("pickers.newAccount.type")} htmlFor={`${ids}-type`}>
          <Select
            id={`${ids}-type`}
            value={form.type}
            onChange={(type) => update({ type: type as AccountType })}
            options={types.map((type) => ({ value: type, label: t(`pickers.accountType.${type}`) }))}
            disabled={types.length < 2}
          />
        </Field>
        <Field label={t("pickers.newAccount.entity")} htmlFor={`${ids}-entity`}>
          <EntitySelect
            id={`${ids}-entity`}
            value={form.entityId}
            onChange={(next) => update({ entityId: next, currency: entityCurrency(next) })}
            invalid={errors.has("entityId")}
          />
        </Field>
        <Field label={t("pickers.newAccount.currency")} htmlFor={`${ids}-currency`}>
          <Select id={`${ids}-currency`} value={form.currency} onChange={(currency) => update({ currency })} options={currencyOptions} invalid={errors.has("currency")} />
        </Field>
        {isCard ? (
          <>
            <Field label={t("pickers.newAccount.closingDay")} htmlFor={`${ids}-closing`}>
              <TextInput id={`${ids}-closing`} value={form.closingDay} onChange={(closingDay) => update({ closingDay })} inputMode="numeric" mono invalid={errors.has("closingDay")} />
            </Field>
            <Field label={t("pickers.newAccount.dueDay")} htmlFor={`${ids}-due`}>
              <TextInput id={`${ids}-due`} value={form.dueDay} onChange={(dueDay) => update({ dueDay })} inputMode="numeric" mono invalid={errors.has("dueDay")} />
            </Field>
          </>
        ) : null}
      </div>
      <DialogFooter>
        <Btn ghost onClick={onCancel}>
          {t("cancel")}
        </Btn>
        <Kbd>{submitHint}</Kbd>
        <Btn primary type="submit" disabled={create.isPending}>
          {t("pickers.newAccount.submit")}
        </Btn>
      </DialogFooter>
    </form>
  );
}
