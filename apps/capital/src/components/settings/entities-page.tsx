"use client";

import { useState } from "react";
import { parseAsString, useQueryState } from "nuqs";
import { useTranslations } from "next-intl";
import { Badge, Btn, Field, Select, TextInput } from "@/components/cap";
import { useAccounts, useCurrencies, useEntities, type AccountRecord, type EntityRecord } from "@/lib/api/catalog";
import { apiPatch, apiPost } from "@/lib/api/client";
import { invalidFields } from "@/lib/api/errors";
import { useSession } from "@/lib/api/session";
import { useAppMutation } from "@/lib/api/use-app-mutation";
import { useFmt } from "@/lib/format/provider";
import { entityKindLabel } from "@/lib/settings/entity-kind";
import { entityBody, entityForm, type EntityForm } from "@/lib/settings/forms";
import { swatchColor } from "@/lib/settings/palette";
import { useShortcut } from "@/lib/shortcuts/provider";
import { AddRow, DetailFooter, Dot, ListDetail, ListItem, Swatches } from "./master";

/** GET /v2/entities?includeArchived=true rows. */
export type EntityRow = EntityRecord & { description: string | null; taxRate: number; accountsCount: number; archivedAt: string | null };
type AccountRow = AccountRecord & { initialBalance?: number };

const NEW = "new";

/** Negócios e PF: the PF and each business, with currency, tax rate, opening balance and color. */
export function EntitiesPage() {
  const t = useTranslations("settings.ent");
  const entities = useEntities(true);
  const accounts = useAccounts(true);
  const [selected, setSelected] = useQueryState("id", parseAsString);
  const list = (entities.data ?? []) as EntityRow[];
  const current = selected === NEW ? null : list.find((e) => e.id === selected) ?? list[0] ?? null;
  const isNew = selected === NEW || (!current && entities.isSuccess);
  const mainAccount = current ? ((accounts.data ?? []) as AccountRow[]).find((a) => a.entityId === current.id && a.isDefault) : undefined;

  const kindLabel = (entity: EntityRow) => {
    const kind = entityKindLabel(entity);
    return kind.key === "business" ? t("kind.business", { currency: kind.currency }) : t(`kind.${kind.key}`);
  };

  return (
    <ListDetail
      list={
        <>
          {list.map((entity) => (
            <ListItem
              key={entity.id}
              on={!isNew && current?.id === entity.id}
              faded={!!entity.archivedAt}
              onClick={() => void setSelected(entity.id)}
              left={
                <>
                  <Dot color={swatchColor(entity.color)} />
                  <span className="truncate">{entity.name}</span>
                  {entity.archivedAt ? <Badge>{t("archivedBadge")}</Badge> : null}
                </>
              }
              right={<span className="shrink-0 text-[11px] text-fg-3">{kindLabel(entity)}</span>}
            />
          ))}
          <AddRow on={isNew} onClick={() => void setSelected(NEW)}>
            {t("new")}
          </AddRow>
        </>
      }
      detail={
        entities.isSuccess && accounts.isSuccess ? (
          <EntityDetail
            key={isNew ? NEW : current?.id}
            entity={isNew ? null : current}
            initialBalance={mainAccount?.initialBalance ?? 0}
            onCreated={(id) => void setSelected(id)}
          />
        ) : null
      }
    />
  );
}

function EntityDetail({ entity, initialBalance, onCreated }: { entity: EntityRow | null; initialBalance: number; onCreated: (id: string) => void }) {
  const t = useTranslations("settings.ent");
  const ts = useTranslations("settings");
  const fmt = useFmt();
  const me = useSession().data;
  const currencies = useCurrencies();
  const format = (n: number) => fmt.number(n, 2);
  const [form, setForm] = useState<EntityForm>(() => entityForm(entity, initialBalance, { currency: me?.baseCurrency ?? "BRL" }, format));
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const set = (patch: Partial<EntityForm>) => setForm((f) => ({ ...f, ...patch }));
  const isPersonal = entity?.kind === "personal";

  const save = useAppMutation({
    event: "catalog.write",
    mutationFn: (body: Record<string, unknown>) => (entity ? apiPatch<EntityRow>(`/api/v2/entities/${entity.id}`, body) : apiPost<EntityRow>("/api/v2/entities", body)),
    undo: (saved) => (entity ? t("toastSaved", { name: saved.name }) : t("toastCreated", { name: saved.name })),
    onSuccess: (saved) => {
      if (!entity) onCreated(saved.id);
    },
    onError: (error) => {
      const fields = invalidFields(error);
      if (fields.size) {
        setInvalid(fields);
        return true;
      }
    },
  });
  const archive = useAppMutation({
    event: "catalog.write",
    mutationFn: (archived: boolean) => apiPatch<EntityRow>(`/api/v2/entities/${entity!.id}`, { archived }),
    undo: (saved, archived) => t(archived ? "toastArchived" : "toastUnarchived", { name: saved.name }),
  });

  const submit = () => {
    const { body, invalid: bad } = entityBody(form, entity, initialBalance, fmt.parseNumber);
    setInvalid(new Set(bad));
    if (bad.length || (entity && !Object.keys(body).length)) return;
    save.mutate(body);
  };
  useShortcut("mod+enter", () => submit(), { allowInInputs: true });
  const currencyCodes = currencies.data?.currencies.map((c) => c.code) ?? [];
  const currencyOptions = (currencyCodes.includes(form.defaultCurrency) ? currencyCodes : [form.defaultCurrency, ...currencyCodes]).map((code) => ({ value: code, label: code }));

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="grid grid-cols-2 gap-2.5">
        <Field label={t("name")} htmlFor="ent-name">
          <TextInput id="ent-name" value={form.name} onChange={(name) => set({ name })} disabled={isPersonal} invalid={invalid.has("name")} />
        </Field>
        <Field label={t("currency")}>
          <Select aria-label={t("currency")} value={form.defaultCurrency} onChange={(defaultCurrency) => set({ defaultCurrency })} options={currencyOptions} />
        </Field>
        <Field label={t("description")} htmlFor="ent-description" span={2}>
          <TextInput id="ent-description" value={form.description} onChange={(description) => set({ description })} />
        </Field>
        <Field label={t("taxRate")} htmlFor="ent-tax" hint={entity?.kind !== "personal" && form.defaultCurrency === "BRL" ? t("taxRateHint") : undefined}>
          <TextInput id="ent-tax" value={form.taxRate} onChange={(taxRate) => set({ taxRate })} mono invalid={invalid.has("taxRate")} />
        </Field>
        <Field label={t("initialBalance")} htmlFor="ent-balance">
          <TextInput id="ent-balance" value={form.initialBalance} onChange={(initialBalance) => set({ initialBalance })} mono invalid={invalid.has("initialBalance")} />
        </Field>
        <Field label={t("color")} span={2}>
          <Swatches value={form.color} onChange={(color) => set({ color })} />
        </Field>
      </div>
      {entity ? <span className="text-[12px] text-fg-3">{t("linked", { count: entity.accountsCount })}</span> : null}
      <DetailFooter
        end={
          entity && entity.kind !== "personal" ? (
            <Btn ghost disabled={archive.isPending} onClick={() => archive.mutate(!entity.archivedAt)}>
              {entity.archivedAt ? t("unarchive") : t("archive")}
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
