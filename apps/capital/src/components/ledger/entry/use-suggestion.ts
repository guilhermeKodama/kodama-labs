"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CategorySuggestion } from "@capital/server/modules/ledger/services/rules";
import { apiPost } from "@/lib/api/client";
import { keys } from "@/lib/api/keys";

/** `value` once it stopped changing for `ms`. */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/**
 * The category to suggest while the description is typed ("Sugerido:
 * Restaurantes · Regra “ifood” → Restaurantes · usada 23×"): a rule, else
 * the history of that description; `ai` (after the field loses focus)
 * also asks the model. Only while no category is picked.
 */
export function useCategorySuggestion({
  description,
  entityId,
  kind,
  enabled,
  ai,
}: {
  description: string;
  entityId: string | null;
  kind: "income" | "expense";
  enabled: boolean;
  ai: boolean;
}) {
  const text = useDebounced(description.trim(), 350);
  const input = { description: text, entityId: entityId || null, kind, ai };
  const query = useQuery({
    queryKey: keys.ruleSuggest(input),
    queryFn: () => apiPost<CategorySuggestion>("/api/v2/rules/suggest", input),
    enabled: enabled && text.length >= 2,
    staleTime: 60_000,
  });
  const data = enabled && text.length >= 2 ? query.data : undefined;
  return data?.source ? data : null;
}
