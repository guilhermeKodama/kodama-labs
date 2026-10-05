"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface AccountRecord {
  id: string;
  name: string;
  type: "checking" | "credit_card" | "brokerage" | "cash";
  entityId: string;
  currency: string;
  institution: string | null;
  archivedAt: string | null;
}

export interface CategoryRecord {
  id: string;
  name: string;
  type: "income" | "expense" | "investment";
  color: string | null;
  isArchived: boolean;
}

export function useAccounts() {
  return useQuery({
    queryKey: ["accounts"],
    queryFn: () => api<AccountRecord[]>("/api/v2/accounts"),
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
