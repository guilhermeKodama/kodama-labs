"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Btn, Callout, Field, Select, TextInput } from "@/components/cap";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api/client";
import { useAccounts, useCategories, useEntities, type AccountRecord } from "@/lib/api/catalog";
import { keys } from "@/lib/api/keys";
import { useAppMutation } from "@/lib/api/use-app-mutation";
import { useFmt } from "@/lib/format/provider";
import { ConfirmDialog } from "./confirm-dialog";

type EntityKind = "personal" | "business";
type ItemStatus = "idle" | "ok" | "expiring" | "expired" | "error";
type ReviewKind = "conflict" | "low_confidence" | "position";

interface PluggyAccountRow {
  id: string;
  name: string;
  type: string;
  subtype: string | null;
  capitalAccountId: string | null;
}

interface PluggyItemRow {
  id: string;
  label: string;
  itemId: string;
  entityKind: EntityKind;
  status: ItemStatus;
  consentExpiresAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  syncing: boolean;
  syncCutoff: string | null;
  incomeCategoryId: string | null;
  brokerageAccountId: string | null;
  accounts: PluggyAccountRow[];
}

interface PluggyReviewRow {
  id: string;
  itemRowId: string | null;
  kind: ReviewKind | string;
  draft: Record<string, unknown> | null;
  createdAt: string;
}

interface PluggyOverview {
  enabled: boolean;
  items: PluggyItemRow[];
  reviews: PluggyReviewRow[];
}

interface ItemDraft {
  label: string;
  itemId: string;
  entityKind: EntityKind;
}

const NONE = "";

/** Open Finance: saved Meu Pluggy item ids, account mapping, sync now, and the review queue. */
export function PluggyPage() {
  const t = useTranslations("settings.pluggy");
  const fmt = useFmt();
  const overview = useQuery({
    queryKey: keys.pluggy(),
    queryFn: () => apiGet<PluggyOverview>("/api/v2/pluggy"),
    refetchInterval: (query) => ((query.state.data?.items ?? []).some((item) => item.syncing) ? 1500 : false),
  });
  const accounts = useAccounts();
  const entities = useEntities();
  const categories = useCategories();
  const [label, setLabel] = useState("");
  const [itemId, setItemId] = useState("");
  const [entityKind, setEntityKind] = useState<EntityKind>("personal");
  const [drafts, setDrafts] = useState<Record<string, ItemDraft>>({});
  const [links, setLinks] = useState<Record<string, string>>({});
  const [classes, setClasses] = useState<Record<string, { incomeType: string; origin: string }>>({});
  const [removing, setRemoving] = useState<PluggyItemRow | null>(null);

  const refresh = { event: "settings.write" as const };
  const sync = useAppMutation({ ...refresh, mutationFn: () => apiPost("/api/v2/pluggy/sync", {}) });
  const add = useAppMutation({
    ...refresh,
    mutationFn: () => apiPost("/api/v2/pluggy/items", { label: label.trim(), itemId: itemId.trim(), entityKind }),
    onSuccess: () => {
      setLabel("");
      setItemId("");
    },
  });
  const saveItem = useAppMutation({
    ...refresh,
    mutationFn: ({ id, draft }: { id: string; draft: ItemDraft }) =>
      apiPatch(`/api/v2/pluggy/items/${id}`, { label: draft.label.trim(), itemId: draft.itemId.trim(), entityKind: draft.entityKind }),
    onSuccess: (_data, variables) => {
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[variables.id];
        return next;
      });
    },
  });
  const patchItem = useAppMutation({
    ...refresh,
    mutationFn: ({ id, body }: { id: string; body: { brokerageAccountId?: string | null; incomeCategoryId?: string | null; syncCutoff?: string | null } }) =>
      apiPatch(`/api/v2/pluggy/items/${id}`, body),
  });
  const mapAccount = useAppMutation({
    ...refresh,
    mutationFn: ({ id, capitalAccountId }: { id: string; capitalAccountId: string | null }) =>
      apiPatch(`/api/v2/pluggy/links/${id}`, { capitalAccountId }),
  });
  const remove = useAppMutation({
    ...refresh,
    mutationFn: (id: string) => apiDelete(`/api/v2/pluggy/items/${id}`),
    onSuccess: () => setRemoving(null),
  });
  const resolve = useAppMutation({
    ...refresh,
    mutationFn: ({ id, action, ledgerEntryId, incomeType, origin }: { id: string; action: "ignore" | "link" | "confirm"; ledgerEntryId?: string; incomeType?: string; origin?: string | null }) =>
      apiPost(`/api/v2/pluggy/reviews/${id}`, { action, ledgerEntryId: ledgerEntryId ?? null, incomeType, origin }),
    onSuccess: (_data, variables) => {
      setLinks((prev) => {
        const next = { ...prev };
        delete next[variables.id];
        return next;
      });
    },
  });

  const data = overview.data;
  const enabled = data?.enabled ?? false;
  const syncing = (data?.items ?? []).some((item) => item.syncing);
  const kindOf = (account: AccountRecord) => entities.data?.find((entity) => entity.id === account.entityId)?.kind ?? null;
  const accountOptions = (item: PluggyItemRow, link: PluggyAccountRow) => {
    const types = link.type === "CREDIT" ? ["credit_card"] : ["checking", "cash", "brokerage"];
    return [
      { value: NONE, label: t("none") },
      ...(accounts.data ?? [])
        .filter((account) => !account.archivedAt && account.type && types.includes(account.type) && kindOf(account) === item.entityKind)
        .map((account) => ({ value: account.id, label: account.name })),
    ];
  };
  const brokerOptions = (item: PluggyItemRow) => [
    { value: NONE, label: t("none") },
    ...(accounts.data ?? [])
      .filter((account) => !account.archivedAt && account.type === "brokerage" && kindOf(account) === item.entityKind)
      .map((account) => ({ value: account.id, label: account.name })),
  ];
  const incomeOptions = [
    { value: NONE, label: t("none") },
    ...(categories.data ?? []).filter((category) => !category.isArchived && category.type === "income").map((category) => ({ value: category.id, label: category.name })),
  ];

  return (
    <div className="flex max-w-[760px] flex-col gap-4">
      {data && !enabled ? <Callout tone="warning">{t("disabled")}</Callout> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Btn primary disabled={!enabled || sync.isPending || syncing || !data} onClick={() => sync.mutate()}>
          {sync.isPending || syncing ? t("syncing") : t("sync")}
        </Btn>
      </div>

      <form
        className="grid grid-cols-1 gap-2.5 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!label.trim() || !itemId.trim() || add.isPending) return;
          add.mutate();
        }}
      >
        <Field label={t("label")} htmlFor="pluggy-label">
          <TextInput id="pluggy-label" value={label} onChange={setLabel} autoComplete="off" className="w-full" />
        </Field>
        <Field label={t("itemId")} htmlFor="pluggy-item">
          <TextInput id="pluggy-item" value={itemId} onChange={setItemId} mono autoComplete="off" placeholder="00000000-0000-0000-0000-000000000000" className="w-full" />
        </Field>
        <Field label={t("entity")}>
          <Select
            aria-label={t("entity")}
            className="w-full"
            value={entityKind}
            onChange={(value) => setEntityKind(value as EntityKind)}
            options={[
              { value: "personal", label: t("personal") },
              { value: "business", label: t("business") },
            ]}
          />
        </Field>
        <div className="flex items-end">
          <Btn primary type="submit" disabled={!label.trim() || !itemId.trim() || add.isPending}>
            {t("add")}
          </Btn>
        </div>
      </form>

      {overview.isSuccess && data && data.items.length === 0 ? <p className="text-body-sm text-fg-3">{t("empty")}</p> : null}

      {data?.items.map((item) => {
        const draft = drafts[item.id] ?? { label: item.label, itemId: item.itemId, entityKind: item.entityKind };
        const dirty = draft.label !== item.label || draft.itemId !== item.itemId || draft.entityKind !== item.entityKind;
        return (
          <section key={item.id} className="flex flex-col gap-3 rounded-[8px] border border-stroke-2 p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-body font-medium">{item.label}</h2>
              <span className="text-body-sm text-fg-3">{t(`status.${item.status}`)}</span>
            </div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <Field label={t("label")}>
                <TextInput
                  aria-label={`${t("label")} ${item.label}`}
                  className="w-full"
                  value={draft.label}
                  onChange={(value) => setDrafts((prev) => ({ ...prev, [item.id]: { ...draft, label: value } }))}
                />
              </Field>
              <Field label={t("itemId")}>
                <TextInput
                  aria-label={`${t("itemId")} ${item.label}`}
                  className="w-full"
                  value={draft.itemId}
                  mono
                  onChange={(value) => setDrafts((prev) => ({ ...prev, [item.id]: { ...draft, itemId: value } }))}
                />
              </Field>
              <Field label={t("entity")}>
                <Select
                  aria-label={`${t("entity")} ${item.label}`}
                  className="w-full"
                  value={draft.entityKind}
                  onChange={(value) => setDrafts((prev) => ({ ...prev, [item.id]: { ...draft, entityKind: value as EntityKind } }))}
                  options={[
                    { value: "personal", label: t("personal") },
                    { value: "business", label: t("business") },
                  ]}
                />
              </Field>
              <Field label={t("cutoff")}>
                <TextInput
                  aria-label={`${t("cutoff")} ${item.label}`}
                  className="w-full"
                  type="date"
                  value={item.syncCutoff ?? ""}
                  disabled={patchItem.isPending}
                  onChange={(value) => patchItem.mutate({ id: item.id, body: { syncCutoff: value || null } })}
                />
              </Field>
              <Field label={t("brokerage")}>
                <Select
                  aria-label={`${t("brokerage")} ${item.label}`}
                  className="w-full"
                  value={item.brokerageAccountId ?? NONE}
                  disabled={patchItem.isPending}
                  onChange={(value) => patchItem.mutate({ id: item.id, body: { brokerageAccountId: value || null } })}
                  options={brokerOptions(item)}
                />
              </Field>
              {item.entityKind === "business" ? (
                <Field label={t("incomeCategory")} className="sm:col-span-2">
                  <Select
                    aria-label={`${t("incomeCategory")} ${item.label}`}
                    className="w-full"
                    value={item.incomeCategoryId ?? NONE}
                    disabled={patchItem.isPending}
                    onChange={(value) => patchItem.mutate({ id: item.id, body: { incomeCategoryId: value || null } })}
                    options={incomeOptions}
                  />
                </Field>
              ) : null}
            </div>
            <p className="text-body-sm text-fg-3">
              {t("lastSync", { when: item.lastSyncAt ? fmt.dateTime(item.lastSyncAt) : t("never") })}
              {" · "}
              {item.consentExpiresAt ? t("consent", { when: fmt.dateFull(item.consentExpiresAt) }) : t("noConsent")}
            </p>
            {item.lastError ? <Callout tone="danger">{item.lastError}</Callout> : null}
            {item.status === "expiring" || item.status === "expired" ? <Callout tone="warning">{t("renew")}</Callout> : null}
            <div className="flex flex-col gap-2">
              <span className="text-body-sm font-medium">{t("accounts")}</span>
              {item.accounts.length === 0 ? <span className="text-body-sm text-fg-3">{t("noAccounts")}</span> : null}
              {item.accounts.map((link) => (
                <div key={link.id} className="grid grid-cols-1 items-center gap-1.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <span className="truncate text-body-sm">{link.name}</span>
                  <Select
                    aria-label={link.name}
                    className="w-full"
                    value={link.capitalAccountId ?? NONE}
                    disabled={mapAccount.isPending}
                    onChange={(value) => mapAccount.mutate({ id: link.id, capitalAccountId: value || null })}
                    options={accountOptions(item, link)}
                  />
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Btn disabled={!dirty || saveItem.isPending} onClick={() => saveItem.mutate({ id: item.id, draft })}>
                {t("save")}
              </Btn>
              <Btn danger ghost onClick={() => setRemoving(item)}>
                {t("remove")}
              </Btn>
            </div>
          </section>
        );
      })}

      <section className="flex flex-col gap-2">
        <h2 className="text-body font-medium">{t("reviews")}</h2>
        {overview.isSuccess && (data?.reviews.length ?? 0) === 0 ? <p className="text-body-sm text-fg-3">{t("emptyReviews")}</p> : null}
        {data?.reviews.map((review) => {
          const draft = review.draft ?? {};
          const summary = reviewText(draft);
          const entryId = links[review.id] ?? "";
          return (
            <div key={review.id} className="flex flex-col gap-2 rounded-[8px] border border-stroke-2 p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-body-sm font-medium">{review.kind === "conflict" || review.kind === "low_confidence" || review.kind === "position" ? t(`reviewKind.${review.kind}`) : review.kind}</span>
                <span className="text-caption text-fg-3">{fmt.dateTime(review.createdAt)}</span>
              </div>
              {summary ? <p className="text-body-sm text-fg-2">{summary}</p> : null}
              {review.kind === "low_confidence" && draft.event === "income" ? (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Field label={t("incomeType")}>
                    <Select
                      aria-label={t("incomeType")}
                      className="w-full"
                      value={classes[review.id]?.incomeType ?? (typeof draft.incomeType === "string" ? draft.incomeType : "fixed_income_interest")}
                      onChange={(value) =>
                        setClasses((prev) => ({
                          ...prev,
                          [review.id]: { incomeType: value, origin: prev[review.id]?.origin ?? (typeof draft.origin === "string" ? draft.origin : "BR") },
                        }))
                      }
                      options={["dividend", "jcp", "fii_income", "fixed_income_interest"].map((value) => ({ value, label: t(`incomeTypes.${value}`) }))}
                    />
                  </Field>
                  {(classes[review.id]?.incomeType ?? draft.incomeType) === "dividend" ? (
                    <Field label={t("origin")}>
                      <Select
                        aria-label={t("origin")}
                        className="w-full"
                        value={classes[review.id]?.origin ?? (typeof draft.origin === "string" ? draft.origin : "BR")}
                        onChange={(value) =>
                          setClasses((prev) => ({
                            ...prev,
                            [review.id]: {
                              incomeType: prev[review.id]?.incomeType ?? (typeof draft.incomeType === "string" ? draft.incomeType : "dividend"),
                              origin: value,
                            },
                          }))
                        }
                        options={["BR", "BDR", "EXTERIOR"].map((value) => ({ value, label: t(`origins.${value}`) }))}
                      />
                    </Field>
                  ) : null}
                </div>
              ) : null}
              {review.kind === "conflict" ? (
                <Field label={t("entryId")}>
                  <TextInput
                    aria-label={t("entryId")}
                    className="w-full"
                    value={entryId}
                    mono
                    onChange={(value) => setLinks((prev) => ({ ...prev, [review.id]: value }))}
                  />
                </Field>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Btn ghost disabled={resolve.isPending} onClick={() => resolve.mutate({ id: review.id, action: "ignore" })}>
                  {t("ignore")}
                </Btn>
                {review.kind === "low_confidence" && draft.event === "income" ? (
                  <Btn
                    disabled={resolve.isPending}
                    onClick={() =>
                      resolve.mutate({
                        id: review.id,
                        action: "confirm",
                        incomeType: classes[review.id]?.incomeType ?? (typeof draft.incomeType === "string" ? draft.incomeType : "fixed_income_interest"),
                        origin: (classes[review.id]?.incomeType ?? draft.incomeType) === "dividend" ? classes[review.id]?.origin ?? (typeof draft.origin === "string" ? draft.origin : "BR") : null,
                      })
                    }
                  >
                    {t("confirm")}
                  </Btn>
                ) : null}
                {review.kind === "conflict" ? (
                  <Btn primary disabled={resolve.isPending || !entryId.trim()} onClick={() => resolve.mutate({ id: review.id, action: "link", ledgerEntryId: entryId.trim() })}>
                    {t("link")}
                  </Btn>
                ) : null}
              </div>
            </div>
          );
        })}
      </section>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={t("removeTitle", { label: removing?.label ?? "" })}
        desc={t("removeDesc")}
        confirmLabel={t("remove")}
        danger
        pending={remove.isPending}
        onConfirm={() => {
          if (removing) remove.mutate(removing.id);
        }}
      />
    </div>
  );
}

function reviewText(draft: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of ["description", "ticker", "incomeType", "reason"] as const) {
    const value = draft[key];
    if (typeof value === "string" && value) parts.push(value);
  }
  if (typeof draft.amount === "number") parts.push(String(draft.amount));
  if (typeof draft.confidence === "number") parts.push(String(draft.confidence));
  return parts.join(" · ");
}
