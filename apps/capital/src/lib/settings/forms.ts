import { parseDay } from "./card";

/**
 * Master-data forms of Ajustes (Negócios e PF, contas, cartões, corretoras):
 * the text the fields start with, and the request body a save sends, with
 * only what changed on an edit. Amounts are typed in the user's number
 * format, so a `parse` function (fmt.parseNumber) comes in; it returns NaN
 * for text that is not a number.
 */
export type ParseNumber = (text: string) => number;
export type FormatNumber = (value: number) => string;

export interface EntityRecordLike {
  name: string;
  kind: "personal" | "business";
  description: string | null;
  defaultCurrency: string;
  taxRate: number;
  color: string | null;
}

export interface EntityForm {
  name: string;
  defaultCurrency: string;
  description: string;
  /** Percent, as typed ("6" for 6%). */
  taxRate: string;
  /** The main account's initial balance. */
  initialBalance: string;
  color: string | null;
}

export function entityForm(entity: EntityRecordLike | null, initialBalance: number, defaults: { currency: string }, format: FormatNumber): EntityForm {
  return {
    name: entity?.name ?? "",
    defaultCurrency: entity?.defaultCurrency ?? defaults.currency,
    description: entity?.description ?? "",
    taxRate: entity ? format(Math.round(entity.taxRate * 10_000) / 100) : format(0),
    initialBalance: format(initialBalance),
    color: entity?.color ?? null,
  };
}

export interface FormResult<T> {
  body: T;
  /** Fields whose text cannot be saved. */
  invalid: string[];
}

const blankToNull = (text: string) => (text.trim() ? text.trim() : null);

/** Body of POST /v2/entities (no `entity`) or PATCH /v2/entities/{id} (changed fields only; the PF name never). */
export function entityBody(form: EntityForm, entity: EntityRecordLike | null, initialBalance: number, parse: ParseNumber): FormResult<Record<string, unknown>> {
  const invalid: string[] = [];
  const percent = parse(form.taxRate || "0");
  if (!(percent >= 0 && percent <= 100)) invalid.push("taxRate");
  const balance = parse(form.initialBalance || "0");
  if (!Number.isFinite(balance)) invalid.push("initialBalance");
  if (!form.name.trim()) invalid.push("name");
  const next = {
    name: form.name.trim(),
    description: blankToNull(form.description),
    defaultCurrency: form.defaultCurrency,
    taxRate: Math.round(percent * 100) / 10_000,
    color: form.color,
    initialBalance: balance,
  };
  if (!entity) return { body: next, invalid };
  const body: Record<string, unknown> = {};
  if (entity.kind !== "personal" && next.name !== entity.name) body.name = next.name;
  if (next.description !== (entity.description ?? null)) body.description = next.description;
  if (next.defaultCurrency !== entity.defaultCurrency) body.defaultCurrency = next.defaultCurrency;
  if (Math.abs(next.taxRate - entity.taxRate) > 1e-9) body.taxRate = next.taxRate;
  if (next.color !== entity.color) body.color = next.color;
  if (Math.abs(next.initialBalance - initialBalance) > 1e-9) body.initialBalance = next.initialBalance;
  return { body, invalid: invalid.filter((f) => f !== "name" || entity.kind !== "personal") };
}

export type AccountKind = "checking" | "cash" | "credit_card" | "brokerage";

export interface AccountRecordLike {
  name: string;
  type: AccountKind;
  entityId: string;
  currency: string;
  institution: string | null;
  externalId: string | null;
  initialBalance?: number | null;
  balance: number | null;
  creditLimit: number | null;
  closingDay: number | null;
  dueDay: number | null;
  payFromAccountId: string | null;
}

export interface AccountForm {
  name: string;
  institution: string;
  entityId: string;
  currency: string;
  externalId: string;
  /** Bank accounts: the initial balance. */
  initialBalance: string;
  /** Brokers: the cash held now (Caixa disponível), set through set-balance. */
  cash: string;
  creditLimit: string;
  closingDay: string;
  dueDay: string;
  /** "" = the entity's main account pays the bill. */
  payFromAccountId: string;
}

export function accountForm(account: AccountRecordLike | null, defaults: { entityId: string; currency: string }, format: FormatNumber): AccountForm {
  return {
    name: account?.name ?? "",
    institution: account?.institution ?? "",
    entityId: account?.entityId ?? defaults.entityId,
    currency: account?.currency ?? defaults.currency,
    externalId: account?.externalId ?? "",
    initialBalance: format(account?.initialBalance ?? 0),
    cash: format(account?.balance ?? 0),
    creditLimit: account?.creditLimit != null ? format(account.creditLimit) : "",
    closingDay: account?.closingDay != null ? String(account.closingDay) : "",
    dueDay: account?.dueDay != null ? String(account.dueDay) : "",
    payFromAccountId: account?.payFromAccountId ?? "",
  };
}

export interface AccountSave {
  /** POST /v2/accounts body (create) or PATCH body (changed fields only; may be empty). */
  body: Record<string, unknown>;
  /** Brokers: the cash to set through POST /v2/accounts/{id}/set-balance, when it changed. */
  cash: number | null;
  invalid: string[];
}

export function accountSave(form: AccountForm, account: AccountRecordLike | null, type: AccountKind, parse: ParseNumber): AccountSave {
  const invalid: string[] = [];
  if (!form.name.trim()) invalid.push("name");
  const isCard = type === "credit_card";
  const isBroker = type === "brokerage";
  const fields: Record<string, unknown> = {
    name: form.name.trim(),
    institution: blankToNull(form.institution),
    entityId: form.entityId,
    currency: form.currency,
    externalId: blankToNull(form.externalId),
  };
  if (isCard) {
    const limit = parse(form.creditLimit);
    if (!(limit > 0)) invalid.push("creditLimit");
    const closingDay = parseDay(form.closingDay);
    if (closingDay === null) invalid.push("closingDay");
    const dueDay = parseDay(form.dueDay);
    if (dueDay === null) invalid.push("dueDay");
    Object.assign(fields, { creditLimit: limit, closingDay, dueDay, payFromAccountId: form.payFromAccountId || null });
  } else if (!isBroker) {
    const initial = parse(form.initialBalance || "0");
    if (!Number.isFinite(initial)) invalid.push("initialBalance");
    fields.initialBalance = initial;
  }
  let cash: number | null = null;
  if (isBroker) {
    const value = parse(form.cash || "0");
    if (!Number.isFinite(value)) invalid.push("cash");
    else if (!account || Math.abs(value - (account.balance ?? 0)) > 1e-9) cash = value;
  }
  if (!account) {
    const body = { ...fields, type };
    // A new broker starts with its cash as the initial balance.
    if (isBroker && cash !== null) Object.assign(body, { initialBalance: cash });
    return { body, cash: null, invalid };
  }
  const original: Record<string, unknown> = {
    name: account.name,
    institution: account.institution,
    entityId: account.entityId,
    currency: account.currency,
    externalId: account.externalId,
    initialBalance: account.initialBalance ?? 0,
    creditLimit: account.creditLimit,
    closingDay: account.closingDay,
    dueDay: account.dueDay,
    payFromAccountId: account.payFromAccountId,
  };
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    const before = original[key] ?? null;
    const same = typeof value === "number" && typeof before === "number" ? Math.abs(value - before) < 1e-9 : value === before;
    if (!same) body[key] = value;
  }
  return { body, cash, invalid };
}
