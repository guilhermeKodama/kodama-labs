"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api/client";
import { keys } from "@/lib/api/keys";

/** GET /v2/rules rows (most applied first). */
export interface RuleRow {
  id: string;
  matchType: "contains" | "equals" | "regex";
  pattern: string;
  categoryId: string;
  entityId: string | null;
  source: "manual" | "ai" | "bulk";
  hitCount: number;
  lastHitAt: string | null;
  category: { name: string } | null;
}

export function useRules() {
  return useQuery({ queryKey: keys.rules(), queryFn: () => apiGet<RuleRow[]>("/api/v2/rules") });
}
