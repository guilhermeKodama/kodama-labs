"use client";

import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiPost } from "@/lib/api";
import type { CategoryRecord } from "@/lib/catalog";
import { cn } from "@/lib/utils";

const NEW = "__new";

/** Category picker with "+ Criar categoria…" (master data can be created from the form). */
export function CategorySelect({
  value,
  onChange,
  categories,
  kind,
  className,
}: {
  value: string;
  onChange: (id: string) => void;
  categories: CategoryRecord[];
  kind: "income" | "expense" | "investment";
  className?: string;
}) {
  const queryClient = useQueryClient();
  const options = categories
    .filter((c) => (!c.isArchived || c.id === value) && (kind === "income" ? c.type === "income" : kind === "investment" ? c.type === "investment" : c.type === "expense"))
    .sort((a, b) => a.name.localeCompare(b.name));

  async function create() {
    const name = window.prompt("Nome da nova categoria")?.trim();
    if (!name) return;
    try {
      const created = await apiPost<{ id: string }>("/api/v2/categories", { name, type: kind === "income" ? "income" : kind === "investment" ? "investment" : "expense" });
      await queryClient.invalidateQueries({ queryKey: ["categories"] });
      onChange(created.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível criar a categoria");
    }
  }

  return (
    <select
      value={value}
      onChange={(event) => (event.target.value === NEW ? void create() : onChange(event.target.value))}
      className={cn("h-[26px] min-w-0 rounded-[6px] border border-neutral-300 bg-white px-1.5 text-[12.5px] outline-none", className)}
    >
      <option value="">Sem categoria (regras decidem)</option>
      {options.map((c) => (
        <option key={c.id} value={c.id}>{c.name}</option>
      ))}
      <option value={NEW}>+ Criar categoria…</option>
    </select>
  );
}
