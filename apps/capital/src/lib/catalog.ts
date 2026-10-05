"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";

export interface AccountRecord {
  id: string;
  name: string;
  type: "checking" | "credit_card" | "brokerage" | "cash";
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
  type: "income" | "expense" | "investment";
  color: string | null;
  isArchived: boolean;
}

export function useAccounts(includeArchived = false) {
  return useQuery({
    queryKey: ["accounts", includeArchived],
    queryFn: () => api<AccountRecord[]>(`/api/v2/accounts${includeArchived ? "?includeArchived=true" : ""}`),
  });
}

export function useCategories(includeArchived = false) {
  return useQuery({
    queryKey: ["categories", includeArchived],
    queryFn: async () => {
      const data = await api<{ categories: CategoryRecord[] }>(`/api/v2/categories${includeArchived ? "?includeArchived=true" : ""}`);
      return data.categories;
    },
  });
}

/** Short label per entity ("PF" for the personal one), used in badges. */
export function entityLabel(entity: { kind: string; name: string }): string {
  return entity.kind === "personal" ? "PF" : entity.name;
}

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
