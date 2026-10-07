"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { parseAsString, useQueryState } from "nuqs";
import { useTranslations } from "next-intl";
import { Badge, Btn, Combobox, Field, Select, TextInput } from "@/components/cap";
import type { OpenStatement } from "@capital/server/modules/ledger/services/statements";
import { useAccounts, useCurrencies, useEntities, type AccountRecord, type EntityRecord } from "@/lib/api/catalog";
import { ApiError, apiGet, apiPatch, apiPost } from "@/lib/api/client";
import { invalidFields } from "@/lib/api/errors";
import { keys } from "@/lib/api/keys";
import { useSession } from "@/lib/api/session";
import { useAppMutation } from "@/lib/api/use-app-mutation";
import { useFmt } from "@/lib/format/provider";
import { limitShare } from "@/lib/settings/card";
import { accountForm, accountSave, type AccountForm } from "@/lib/settings/forms";
import { useShortcut } from "@/lib/shortcuts/provider";
import { AddRow, DetailFooter, GroupLabel, ListDetail, ListItem } from "./master";

export type AccountsPageKind = "bank" | "card" | "broker";

/** GET /v2/accounts rows: initialBalance, and the open statement on cards. */
type AccountRow = AccountRecord & { initialBalance: number; openStatement?: OpenStatement | null };

const TYPES: Record<AccountsPageKind, AccountRecord["type"][]> = {
  bank: ["checking", "cash"],
  card: ["credit_card"],
  broker: ["brokerage"],
};
const NEW_TYPE = { bank: "checking", card: "credit_card", broker: "brokerage" } as const;
const NEW = "new";
/** Refusals that mean "this field cannot change on this account" (the toast explains). */
const LOCK_CODES: Record<string, "entityId" | "currency"> = {
  "account.entity_locked": "entityId",
  "account.default_entity_locked": "entityId",
  "account.currency_locked": "currency",
};

/**
 * Contas bancárias, Cartões de crédito and Corretoras: accounts grouped by
 * entity (currency on the right) and the selected one's form. Entity and
 * currency are real fields: the server refuses them, with a coded error,
 * once the account has entries; the form then puts the old value back and
 * makes that field read-only (the error toast says why).
 */
export function AccountsPage({ kind }: { kind: AccountsPageKind }) {
  const t = useTranslations("settings.acc");
  const ta = useTranslations("settings.acc.archivedBadge");
  const accounts = useAccounts(true);
  const entities = useEntities(true);
  const [selected, setSelected] = useQueryState("id", parseAsString);
  const all = (accounts.data ?? []) as AccountRow[];
  const rows = all.filter((a) => TYPES[kind].includes(a.type));
  const current = selected === NEW ? null : rows.find((a) => a.id === selected) ?? rows.find((a) => !a.archivedAt) ?? rows[0] ?? null;
  const isNew = selected === NEW || (!current && accounts.isSuccess);
  const entityList = entities.data ?? [];

  return (
    <ListDetail
      list={
        <>
          {entityList.map((entity) => {
            const items = rows.filter((a) => a.entityId === entity.id).sort((a, b) => Number(!!a.archivedAt) - Number(!!b.archivedAt));
            if (!items.length) return null;
            return (
              <div key={entity.id} className="flex flex-col gap-0.5">
                <GroupLabel>{entity.name}</GroupLabel>
                {items.map((account) => (
                  <ListItem
                    key={account.id}
                    on={!isNew && current?.id === account.id}
                    faded={!!account.archivedAt}
                    onClick={() => void setSelected(account.id)}
                    left={
                      <>
                        <span className="truncate">{account.name}</span>
                        {account.archivedAt ? <Badge>{ta(kind)}</Badge> : null}
                      </>
                    }
                    right={<span className="shrink-0 text-caption text-fg-3">{account.currency}</span>}
                  />
                ))}
              </div>
            );
          })}
          {accounts.isSuccess && !rows.length ? <span className="px-2.5 py-2 text-body-sm text-fg-3">{t(`empty.${kind}`)}</span> : null}
          <AddRow on={isNew} onClick={() => void setSelected(NEW)}>
            {t(`new.${kind}`)}
          </AddRow>
        </>
      }
      detail={
        accounts.isSuccess && entities.isSuccess ? (
          <AccountDetail key={isNew ? NEW : current?.id} kind={kind} account={isNew ? null : current} all={all} entities={entityList} onCreated={(id) => void setSelected(id)} />
        ) : null
      }
    />
  );
}

function AccountDetail({
  kind,
  account,
  all,
  entities,
  onCreated,
}: {
  kind: AccountsPageKind;
  account: AccountRow | null;
  all: AccountRow[];
  /** Every entity, archived included (already loaded: a Select must have its options when it gets its value). */
  entities: EntityRecord[];
  onCreated: (id: string) => void;
}) {
  const t = useTranslations("settings.acc");
  const ts = useTranslations("settings");
  const fmt = useFmt();
  const me = useSession().data;
  const currencies = useCurrencies();
  const type = account?.type ?? NEW_TYPE[kind];
  const format = (n: number) => fmt.number(n, 2);
  const defaults = { entityId: me?.personalEntityId ?? entities[0]?.id ?? "", currency: me?.baseCurrency ?? "BRL" };
  const [form, setForm] = useState<AccountForm>(() => accountForm(account, defaults, format));
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [locked, setLocked] = useState<{ entityId?: boolean; currency?: boolean }>({});
  const set = (patch: Partial<AccountForm>) => setForm((f) => ({ ...f, ...patch }));
  const isCard = type === "credit_card";
  const isBroker = type === "brokerage";

  const holdings = useQuery({
    queryKey: keys.holdingsByAccount(account?.id ?? ""),
    enabled: isBroker && !!account,
    queryFn: () => apiGet<{ holdings: unknown[] }>("/api/v2/holdings", { accountId: account!.id }),
  });

  const save = useAppMutation({
    event: "catalog.write",
    mutationFn: async (input: { body: Record<string, unknown>; cash: number | null }) => {
      if (!account) return apiPost<AccountRow>("/api/v2/accounts", input.body);
      // One PATCH, so the fields and the broker's cash (balance) are one undo batch.
      return apiPatch<AccountRow & { batchId: string | null }>(`/api/v2/accounts/${account.id}`, { ...input.body, ...(input.cash !== null && { balance: input.cash }) });
    },
    undo: (saved, input) =>
      !account ? t("toastCreated", { name: saved.name }) : input.cash !== null ? t("toastCash", { name: saved.name, amount: fmt.money(input.cash, saved.currency) }) : t("toastSaved", { name: saved.name }),
    onSuccess: (saved) => {
      if (!account) onCreated(saved.id);
    },
    onError: (error) => {
      if (account && error instanceof ApiError) {
        const field = LOCK_CODES[error.code ?? ""];
        if (field) {
          setLocked((l) => ({ ...l, [field]: true }));
          set({ [field]: account[field] });
          return;
        }
      }
      const fields = invalidFields(error);
      if (fields.size) {
        setInvalid(fields);
        return true;
      }
    },
  });
  const archive = useAppMutation({
    event: "catalog.write",
    mutationFn: (archived: boolean) => apiPatch<AccountRow & { batchId: string | null }>(`/api/v2/accounts/${account!.id}`, { archived }),
    undo: (saved, archived) => t(archived ? "toastArchived" : "toastUnarchived", { name: saved.name }),
  });

  const submit = () => {
    const result = accountSave(form, account, type, fmt.parseNumber);
    setInvalid(new Set(result.invalid));
    if (result.invalid.length) return;
    if (account && !Object.keys(result.body).length && result.cash === null) return;
    save.mutate({ body: result.body, cash: result.cash });
  };
  useShortcut("mod+enter", () => submit(), { allowInInputs: true });

  // Institutions the user already typed, for the Banco / Instituição picker (a new name can be created).
  const institutions = useMemo(() => {
    const names = new Set(all.map((a) => a.institution).filter((name): name is string => !!name));
    if (form.institution) names.add(form.institution);
    return [...names].sort((a, b) => a.localeCompare(b)).map((name) => ({ value: name, label: name }));
  }, [all, form.institution]);
  const currencyCodes = currencies.data?.currencies.map((c) => c.code) ?? [];
  const currencyOptions = (currencyCodes.includes(form.currency) ? currencyCodes : [form.currency, ...currencyCodes]).map((code) => ({ value: code, label: code }));
  const entityOptions = entities.filter((e) => !e.archivedAt || e.id === form.entityId).map((e) => ({ value: e.id, label: e.name }));
  const payOptions = [
    { value: "", label: t("payFromDefault") },
    ...all.filter((a) => a.type === "checking" && (!a.archivedAt || a.id === form.payFromAccountId)).map((a) => ({ value: a.id, label: `${a.name} · ${entities.find((e) => e.id === a.entityId)?.name ?? ""}` })),
  ];
  const open = account?.openStatement ?? null;
  const share = open ? limitShare(open.total, account?.creditLimit) : 0;
  const positions = (holdings.data?.holdings ?? []).length;

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {isCard && account && open ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 text-body-sm">
            <span>{t("usage", { amount: fmt.money0(open.total, account.currency), date: fmt.date(open.closingDate) })}</span>
            <span className="flex-1" />
            <span className="text-fg-3">{t("usageShare", { share: fmt.pct(share, 0) })}</span>
          </div>
          <span role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(1, share) * 100)} className="relative block h-1.5 rounded-full bg-fill-2">
            <span className="absolute inset-y-0 left-0 rounded-full bg-cat-blue" style={{ width: `${Math.min(1, share) * 100}%` }} />
          </span>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-2.5">
        <Field label={t("name")} htmlFor="acc-name">
          <TextInput id="acc-name" value={form.name} onChange={(name) => set({ name })} invalid={invalid.has("name")} />
        </Field>
        <Field label={isBroker ? t("institution") : t("bank")}>
          <Combobox
            aria-label={isBroker ? t("institution") : t("bank")}
            value={form.institution || null}
            onChange={(institution) => set({ institution })}
            onCreate={(institution) => set({ institution })}
            options={institutions}
            placeholder={t("institutionPlaceholder")}
          />
        </Field>
        <Field label={t("entity")}>
          <Select aria-label={t("entity")} value={form.entityId} onChange={(entityId) => set({ entityId })} options={entityOptions} disabled={account?.isDefault || locked.entityId} invalid={invalid.has("entityId")} />
        </Field>
        <Field label={t("currency")}>
          <Select aria-label={t("currency")} value={form.currency} onChange={(currency) => set({ currency })} options={currencyOptions} disabled={locked.currency} invalid={invalid.has("currency")} />
        </Field>
        {isCard ? (
          <>
            <Field label={t("limit")} htmlFor="acc-limit">
              <TextInput id="acc-limit" value={form.creditLimit} onChange={(creditLimit) => set({ creditLimit })} mono invalid={invalid.has("creditLimit")} />
            </Field>
            <Field label={t("last4")} htmlFor="acc-last4">
              <TextInput id="acc-last4" value={form.externalId} onChange={(externalId) => set({ externalId })} mono />
            </Field>
            <Field label={t("closingDay")} htmlFor="acc-closing">
              <TextInput id="acc-closing" value={form.closingDay} onChange={(closingDay) => set({ closingDay })} mono inputMode="numeric" invalid={invalid.has("closingDay")} />
            </Field>
            <Field label={t("dueDay")} htmlFor="acc-due">
              <TextInput id="acc-due" value={form.dueDay} onChange={(dueDay) => set({ dueDay })} mono inputMode="numeric" invalid={invalid.has("dueDay")} />
            </Field>
            <Field label={t("payFrom")} span={2}>
              <Select aria-label={t("payFrom")} value={form.payFromAccountId} onChange={(payFromAccountId) => set({ payFromAccountId })} options={payOptions} />
            </Field>
          </>
        ) : isBroker ? (
          <>
            <Field label={t("cash")} htmlFor="acc-cash" hint={t("cashHint")}>
              <TextInput id="acc-cash" value={form.cash} onChange={(cash) => set({ cash })} mono invalid={invalid.has("cash")} />
            </Field>
            <Field label={t("brokerNumber")} htmlFor="acc-number" hint={t("brokerNumberHint")}>
              <TextInput id="acc-number" value={form.externalId} onChange={(externalId) => set({ externalId })} mono />
            </Field>
            {account ? (
              <span className="col-span-2 text-body-sm text-fg-3">{t("brokerSummary", { positions, cash: fmt.money0(account.balance ?? 0, account.currency) })}</span>
            ) : null}
          </>
        ) : (
          <>
            <Field label={t("agency")} htmlFor="acc-number">
              <TextInput id="acc-number" value={form.externalId} onChange={(externalId) => set({ externalId })} mono />
            </Field>
            <Field label={t("initialBalance")} htmlFor="acc-initial" hint={account ? t("balanceHint", { amount: fmt.money0(account.balance ?? 0, account.currency) }) : undefined}>
              <TextInput id="acc-initial" value={form.initialBalance} onChange={(initialBalance) => set({ initialBalance })} mono invalid={invalid.has("initialBalance")} />
            </Field>
          </>
        )}
      </div>
      <DetailFooter
        end={
          account && !account.isDefault ? (
            <Btn ghost disabled={archive.isPending} onClick={() => archive.mutate(!account.archivedAt)}>
              {account.archivedAt ? t(`unarchive.${kind}`) : t(`archive.${kind}`)}
            </Btn>
          ) : null
        }
      >
        <Btn primary type="submit" disabled={save.isPending}>
          {ts("save")}
        </Btn>
      </DetailFooter>
    </form>
  );
}
