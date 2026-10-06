import type { AccountInput, AccountType } from "@/lib/api/catalog";

/** The "+ Criar conta…" mini form, as typed. */
export interface AccountFormState {
  name: string;
  type: AccountType;
  entityId: string | null;
  currency: string;
  /** Card only: statement closing and due days, typed as text. */
  closingDay: string;
  dueDay: string;
}

export type AccountFormField = "name" | "entityId" | "currency" | "closingDay" | "dueDay";

/** "5" → 5; anything that is not a whole day 1–31 → null. */
export function parseDayOfMonth(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,2}$/.test(trimmed)) return null;
  const day = Number(trimmed);
  return day >= 1 && day <= 31 ? day : null;
}

/** Fields to mark invalid. A card needs both days, since its statements are built from them. */
export function accountFormErrors(form: AccountFormState): Set<AccountFormField> {
  const errors = new Set<AccountFormField>();
  if (!form.name.trim()) errors.add("name");
  if (!form.entityId) errors.add("entityId");
  if (!/^[A-Z]{3}$/.test(form.currency)) errors.add("currency");
  if (form.type === "credit_card") {
    if (parseDayOfMonth(form.closingDay) === null) errors.add("closingDay");
    if (parseDayOfMonth(form.dueDay) === null) errors.add("dueDay");
  }
  return errors;
}

/** POST /v2/accounts body, or null while the form has errors. */
export function toAccountInput(form: AccountFormState): AccountInput | null {
  if (accountFormErrors(form).size || !form.entityId) return null;
  const card = form.type === "credit_card";
  return {
    entityId: form.entityId,
    type: form.type,
    name: form.name.trim(),
    currency: form.currency,
    ...(card && { closingDay: parseDayOfMonth(form.closingDay), dueDay: parseDayOfMonth(form.dueDay) }),
  };
}
