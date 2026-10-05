"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { entityLabel } from "@/lib/pickers/options";
import { api, apiGet, apiPost } from "./client";
import { keys } from "./keys";
import { useSession, type SessionEntity } from "./session";
import { useAppMutation } from "./use-app-mutation";

export const ACCOUNT_TYPES = ["checking", "credit_card", "brokerage", "cash"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const CATEGORY_TYPES = ["expense", "income", "investment"] as const;
export type CategoryType = (typeof CATEGORY_TYPES)[number];

export interface AccountRecord {
  id: string;
  name: string;
  type: AccountType;
  entityId: string;
  currency: string;
  institution: string | null;
  externalId: string | null;
  balance: number | null;
  isDefault: boolean;
  creditLimit: number | null;
  closingDay: number | null;
  dueDay: number | null;
  payFromAccountId: string | null;
  archivedAt: string | null;
}

export interface CategoryRecord {
  id: string;
  name: string;
  type: CategoryType;
  color: string | null;
  isArchived: boolean;
}

export interface EntityRecord extends SessionEntity {
  archivedAt?: string | null;
}

export interface CurrencyRecord {
  code: string;
  name: string;
  symbol: string;
  manualRate: number;
  updatedAt: string;
}

// includeArchived is only sent when true: the route coerces any string, "false" included, to true.
const archivedParam = (includeArchived: boolean) => (includeArchived ? { includeArchived: true } : {});

export function useAccounts(includeArchived = false) {
  return useQuery({
    queryKey: keys.accounts(archivedParam(includeArchived)),
    queryFn: () => apiGet<AccountRecord[]>("/api/v2/accounts", archivedParam(includeArchived)),
  });
}

export function useCategories(includeArchived = false) {
  return useQuery({
    queryKey: keys.categories(archivedParam(includeArchived)),
    queryFn: async () => (await apiGet<{ categories: CategoryRecord[] }>("/api/v2/categories", archivedParam(includeArchived))).categories,
  });
}

export function useEntities(includeArchived = false) {
  return useQuery({
    queryKey: keys.entities(archivedParam(includeArchived)),
    queryFn: () => apiGet<EntityRecord[]>("/api/v2/entities", archivedParam(includeArchived)),
  });
}

export function useCurrencies() {
  return useQuery({
    queryKey: keys.currencies(),
    queryFn: () => api<{ baseCurrency: string; currencies: CurrencyRecord[] }>("/api/v2/currencies"),
  });
}

export { entityLabel };

/** Id → label maps for entities, accounts and categories (archived included, for old rows). */
export function useNames() {
  const session = useSession();
  const accounts = useAccounts(true);
  const categories = useCategories(true);
  return useMemo(() => {
    const entities = session.data?.entities ?? [];
    return {
      entities,
      accounts: accounts.data ?? [],
      categories: categories.data ?? [],
      entity: new Map(entities.map((item) => [item.id, entityLabel(item)])),
      account: new Map((accounts.data ?? []).map((item) => [item.id, item.name])),
      category: new Map((categories.data ?? []).map((item) => [item.id, item.name])),
      currency: session.data?.baseCurrency ?? "BRL",
    };
  }, [session.data, accounts.data, categories.data]);
}

export type Names = ReturnType<typeof useNames>;

export interface CategoryInput {
  name: string;
  type: CategoryType;
  color?: string | null;
}

export function useCreateCategory() {
  return useAppMutation({
    event: "catalog.write",
    mutationFn: (input: CategoryInput) => apiPost<CategoryRecord>("/api/v2/categories", input),
  });
}

export interface AccountInput {
  entityId: string;
  type: AccountType;
  name: string;
  currency?: string;
  institution?: string | null;
  closingDay?: number | null;
  dueDay?: number | null;
  creditLimit?: number | null;
  payFromAccountId?: string | null;
}

export function useCreateAccount() {
  return useAppMutation({
    event: "catalog.write",
    mutationFn: (input: AccountInput) => apiPost<AccountRecord>("/api/v2/accounts", input),
  });
}
