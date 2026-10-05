"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, apiPatch, apiPost } from "@/lib/api";
import { money } from "@/lib/money";
import { useAccounts, useCategories } from "@/lib/catalog";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";

interface ImportRow {
  fitId: string;
  date: string;
  description: string;
  amount: number;
  type: "income" | "expense";
  isDuplicate: boolean;
}

interface AnalyzeResult {
  bankName: string | null;
  currency: string;
  transactions: ImportRow[];
  summary: { newCount: number; duplicateCount: number };
}

export function SettingsScreen() {
  const t = useTranslations("app");
  const session = useSession();
  const accounts = useAccounts();
  const categories = useCategories(true);
  const queryClient = useQueryClient();
  const [page, setPage] = useState<"accounts" | "categories" | "rules" | "currencies" | "trash" | "imports">("accounts");
  const trash = useQuery({
    queryKey: ["trash"],
    enabled: page === "trash",
    queryFn: () => api<{ rows: { id: string; description: string; amountBase: number }[] }>("/api/v2/trash"),
  });
  const imports = useQuery({
    queryKey: ["imports"],
    enabled: page === "imports",
    queryFn: async () => (await api<{ imports: { id: string; fileName: string | null; createdAt: string }[] }>("/api/v2/imports")).imports,
  });

  return (
    <div className="grid min-h-full md:grid-cols-[14rem_1fr]">
      <nav className="border-r p-3 text-sm">
        {(["accounts", "categories", "rules", "currencies", "trash", "imports"] as const).map((item) => (
          <button key={item} type="button" className={`block w-full rounded-md px-2 py-2 text-left ${page === item ? "bg-muted" : ""}`} onClick={() => setPage(item)}>
            {t(item)}
          </button>
        ))}
      </nav>
      <div className="space-y-4 p-6">
        <h1 className="text-xl font-semibold">{t("settings")}</h1>
        {page === "accounts" ? (
          <ul className="divide-y text-sm">
            {(session.data?.entities ?? []).map((entity) => (
              <li key={entity.id} className="py-3">
                <p className="font-medium">{entity.name}</p>
                <ul className="mt-1 text-muted-foreground">
                  {(accounts.data ?? []).filter((account) => account.entityId === entity.id).map((account) => (
                    <li key={account.id}>{account.name} · {account.type}{account.archivedAt ? ` · ${t("archived")}` : ""}</li>
                  ))}
                </ul>
              </li>
            ))}
            <EntityForm />
            <AccountForm />
          </ul>
        ) : null}
        {page === "categories" ? (
          <ul className="divide-y text-sm">
            {(categories.data ?? []).map((category) => (
              <li key={category.id} className="flex items-center justify-between py-2">
                <span className={category.isArchived ? "text-muted-foreground line-through" : ""}>{category.name}</span>
                {!category.isArchived ? (
                  <Button size="sm" variant="ghost" onClick={() => void apiPatch(`/api/v2/categories/${category.id}`, { isArchived: true }).then(() => queryClient.invalidateQueries({ queryKey: ["categories"] }))}>{t("archive")}</Button>
                ) : null}
              </li>
            ))}
            <CategoryForm />
          </ul>
        ) : null}
        {page === "rules" ? <RulesPanel /> : null}
        {page === "currencies" ? <CurrenciesPanel /> : null}
        {page === "trash" ? (
          <ul className="text-sm">
            {(trash.data?.rows ?? []).map((row) => (
              <li key={row.id} className="flex items-center justify-between border-b py-2">
                <span>{row.description}</span>
                <span className="flex items-center gap-3">
                  <span className="font-mono tabular-nums">{money(row.amountBase)}</span>
                  <Button size="sm" variant="outline" onClick={() => void apiPost("/api/v2/trash/restore", { ids: [row.id] }).then(() => queryClient.invalidateQueries({ queryKey: ["trash"] }))}>{t("restore")}</Button>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {page === "imports" ? <ImportPanel history={imports.data ?? []} /> : null}
      </div>
    </div>
  );
}

function EntityForm() {
  const t = useTranslations("app");
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  return (
    <form className="flex gap-2 pt-4" onSubmit={(event) => {
      event.preventDefault();
      void apiPost("/api/v2/entities", { name }).then(async () => {
        setName("");
        await queryClient.invalidateQueries({ queryKey: ["me"] });
        toast.success(t("saved"));
      }).catch((error: Error) => toast.error(error.message));
    }}>
      <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={t("entity")} required />
      <Button type="submit">{t("save")}</Button>
    </form>
  );
}

function RulesPanel() {
  const t = useTranslations("app");
  const categories = useCategories();
  const queryClient = useQueryClient();
  const rules = useQuery({
    queryKey: ["rules"],
    queryFn: () => api<{ id: string; pattern: string; matchType: string; category: { name: string } | null }[]>("/api/v2/rules"),
  });
  const [pattern, setPattern] = useState("");
  const [categoryId, setCategoryId] = useState("");
  return (
    <div className="space-y-3 text-sm">
      <ul>
        {(rules.data ?? []).map((rule) => (
          <li key={rule.id} className="flex justify-between border-b py-2">
            <span>{rule.matchType} · {rule.pattern} → {rule.category?.name}</span>
            <Button size="sm" variant="ghost" onClick={() => void fetch(`/api/v2/rules/${rule.id}`, { method: "DELETE", credentials: "include" }).then(() => queryClient.invalidateQueries({ queryKey: ["rules"] }))}>{t("delete")}</Button>
          </li>
        ))}
      </ul>
      <form className="flex flex-wrap gap-2" onSubmit={(event) => {
        event.preventDefault();
        void apiPost("/api/v2/rules", { matchType: "contains", pattern, categoryId }).then(async () => {
          setPattern("");
          await queryClient.invalidateQueries({ queryKey: ["rules"] });
        }).catch((error: Error) => toast.error(error.message));
      }}>
        <Input value={pattern} onChange={(event) => setPattern(event.target.value)} placeholder={t("description")} required />
        <select className="h-9 rounded-md border bg-transparent px-2" value={categoryId} onChange={(event) => setCategoryId(event.target.value)} required>
          <option value="">{t("category")}</option>
          {(categories.data ?? []).filter((item) => !item.isArchived).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <Button type="submit">{t("save")}</Button>
      </form>
    </div>
  );
}

function CurrenciesPanel() {
  const t = useTranslations("app");
  const queryClient = useQueryClient();
  const currencies = useQuery({
    queryKey: ["currencies"],
    queryFn: () => api<{ currencies: { code: string; name: string; symbol: string; manualRate: number }[] }>("/api/v2/currencies"),
  });
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [rate, setRate] = useState("");
  return (
    <div className="space-y-3 text-sm">
      <ul>
        {(currencies.data?.currencies ?? []).map((currency) => (
          <li key={currency.code} className="flex justify-between border-b py-2">
            <span>{currency.code} · {currency.name}</span>
            <span className="font-mono tabular-nums">{currency.manualRate}</span>
          </li>
        ))}
      </ul>
      <form className="flex flex-wrap gap-2" onSubmit={(event) => {
        event.preventDefault();
        void apiPost("/api/v2/currencies", { code, name, symbol, manualRate: Number(rate) }).then(async () => {
          setCode(""); setName(""); setSymbol(""); setRate("");
          await queryClient.invalidateQueries({ queryKey: ["currencies"] });
        }).catch((error: Error) => toast.error(error.message));
      }}>
        <Input className="w-20" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="USD" maxLength={3} required />
        <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={t("name")} required />
        <Input className="w-16" value={symbol} onChange={(event) => setSymbol(event.target.value)} placeholder="$" required />
        <Input className="w-24" value={rate} onChange={(event) => setRate(event.target.value)} placeholder="1" required />
        <Button type="submit">{t("save")}</Button>
      </form>
    </div>
  );
}

function AccountForm() {
  const t = useTranslations("app");
  const session = useSession();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [entityId, setEntityId] = useState("");
  const [type, setType] = useState("checking");
  return (
    <form className="flex flex-wrap gap-2 pt-4" onSubmit={(event) => {
      event.preventDefault();
      void apiPost("/api/v2/accounts", {
        name,
        entityId,
        type,
        ...(type === "credit_card" ? { closingDay: 1, dueDay: 10, creditLimit: 1000 } : {}),
      }).then(async () => {
        setName("");
        await queryClient.invalidateQueries({ queryKey: ["accounts"] });
        toast.success(t("saved"));
      }).catch((error: Error) => toast.error(error.message));
    }}>
      <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={t("name")} required />
      <select className="h-9 rounded-md border bg-transparent px-2 text-sm" value={entityId} onChange={(event) => setEntityId(event.target.value)} required>
        <option value="">{t("entity")}</option>
        {(session.data?.entities ?? []).map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}
      </select>
      <select className="h-9 rounded-md border bg-transparent px-2 text-sm" value={type} onChange={(event) => setType(event.target.value)}>
        <option value="checking">checking</option>
        <option value="credit_card">credit_card</option>
        <option value="brokerage">brokerage</option>
        <option value="cash">cash</option>
      </select>
      <Button type="submit">{t("save")}</Button>
    </form>
  );
}

function CategoryForm() {
  const t = useTranslations("app");
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [type, setType] = useState("expense");
  return (
    <form className="flex gap-2 pt-4" onSubmit={(event) => {
      event.preventDefault();
      void apiPost("/api/v2/categories", { name, type }).then(async () => {
        setName("");
        await queryClient.invalidateQueries({ queryKey: ["categories"] });
      });
    }}>
      <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={t("name")} required />
      <select className="h-9 rounded-md border bg-transparent px-2 text-sm" value={type} onChange={(event) => setType(event.target.value)}>
        <option value="expense">expense</option>
        <option value="income">income</option>
        <option value="investment">investment</option>
      </select>
      <Button type="submit">{t("save")}</Button>
    </form>
  );
}

function ImportPanel({ history }: { history: { id: string; fileName: string | null; createdAt: string }[] }) {
  const t = useTranslations("app");
  const session = useSession();
  const queryClient = useQueryClient();
  const [entityId, setEntityId] = useState("");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [currency, setCurrency] = useState("BRL");
  const [bankName, setBankName] = useState("");

  async function onFile(file: File) {
    const content = await file.text();
    const analyzed = await apiPost<AnalyzeResult>("/api/v2/imports/analyze", { files: [{ name: file.name, content }] });
    setRows(analyzed.transactions);
    setPicked(analyzed.transactions.filter((row) => !row.isDuplicate).map((row) => row.fitId));
    setCurrency(analyzed.currency || "BRL");
    setBankName(analyzed.bankName ?? "");
  }

  const commit = useMutation({
    mutationFn: () => {
      const entity = session.data?.entities.find((item) => item.id === entityId);
      const chosen = rows.filter((row) => picked.includes(row.fitId) && !row.isDuplicate);
      return apiPost("/api/v2/imports", {
        entityType: entity?.kind === "business" ? "business" : "personal",
        entityId,
        currency,
        bankName,
        transactions: chosen.map((row) => ({ externalId: row.fitId, date: row.date, description: row.description, amount: Math.abs(row.amount), type: row.type })),
        duplicateDecisions: rows.filter((row) => row.isDuplicate).map((row) => ({ externalId: row.fitId, resolution: "skip_duplicate" })),
      });
    },
    onSuccess: async () => {
      toast.success(t("saved"));
      setRows([]);
      await queryClient.invalidateQueries({ queryKey: ["imports"] });
      await queryClient.invalidateQueries({ queryKey: ["ledger"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select className="h-9 rounded-md border bg-transparent px-2 text-sm" value={entityId} onChange={(event) => setEntityId(event.target.value)}>
          <option value="">{t("entity")}</option>
          {(session.data?.entities ?? []).map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}
        </select>
        <Input type="file" accept=".ofx,.qfx" className="max-w-xs" onChange={(event) => { const file = event.target.files?.[0]; if (file) void onFile(file); }} />
        <Button disabled={!entityId || picked.length === 0 || commit.isPending} onClick={() => commit.mutate()}>{t("importRows")}</Button>
      </div>
      <ul className="text-sm">
        {rows.map((row) => (
          <li key={row.fitId} className="flex items-center gap-2 border-b py-1">
            <Checkbox checked={picked.includes(row.fitId)} disabled={row.isDuplicate} onCheckedChange={(checked) => setPicked(checked ? [...picked, row.fitId] : picked.filter((id) => id !== row.fitId))} />
            <span className="w-24 font-mono text-xs">{row.date}</span>
            <span className="flex-1 truncate">{row.description}</span>
            <span className="font-mono tabular-nums">{money(row.amount)}</span>
            {row.isDuplicate ? <span className="text-xs text-muted-foreground">{t("duplicate")}</span> : null}
          </li>
        ))}
      </ul>
      <h2 className="text-sm font-medium">{t("history")}</h2>
      <ul className="text-sm text-muted-foreground">
        {history.map((item) => (
          <li key={item.id} className="flex justify-between border-b py-1">
            <span>{item.fileName ?? item.id}</span>
            <Button size="sm" variant="ghost" onClick={() => void apiPost(`/api/v2/imports/${item.id}/revert`, {}).then(() => queryClient.invalidateQueries({ queryKey: ["ledger"] }))}>{t("undo")}</Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
