"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { parseAsString, useQueryState } from "nuqs";
import { toast } from "sonner";
import { useLocale } from "next-intl";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { api, apiDelete, apiPatch, apiPost } from "@/lib/api/client";
import { useNames, type AccountRecord, type Names } from "@/lib/api/catalog";
import { ACCOUNT_TYPE_LABEL, money, parseAmount } from "@/lib/money";
import { useSession } from "@/lib/api/session";
import { useLastAppUrl } from "@/lib/shell/use-last-app-url";
import { cn } from "@/lib/utils";
import { Badge, Btn, EmptyRow, Field, Segmented, SelectInput, TextInput } from "@/components/shell/chrome";
import { ImportsPage } from "./imports";

const NAV: { section: string; items: { k: string; l: string; desc: string }[] }[] = [
  { section: "Conta", items: [{ k: "prefs", l: "Perfil e preferências", desc: "Nome, moeda base, fuso, formatos e idioma." }] },
  {
    section: "Finanças",
    items: [
      { k: "ent", l: "Negócios e PF", desc: "Entidades: sua PF e cada empresa, com moeda padrão e alíquota." },
      { k: "bank", l: "Contas bancárias", desc: "Contas correntes e dinheiro de cada entidade." },
      { k: "card", l: "Cartões de crédito", desc: "Limite, fechamento, vencimento e conta que paga a fatura." },
      { k: "broker", l: "Corretoras", desc: "Contas de investimento. São as únicas que aparecem como destino de aporte." },
      { k: "cat", l: "Categorias", desc: "Categorias de despesa e receita, cores e regras automáticas." },
      { k: "rules", l: "Regras de categorização", desc: "Descrições que viram categoria automaticamente." },
      { k: "fx", l: "Moedas e câmbio", desc: "Moeda base e taxas usadas para converter as outras moedas." },
    ],
  },
  {
    section: "Dados",
    items: [
      { k: "imports", l: "Importações", desc: "Importe extratos e faturas; cada importação pode ser desfeita." },
      { k: "trash", l: "Lixeira", desc: "Lançamentos excluídos ficam aqui por 30 dias." },
      { k: "api", l: "Integrações e API", desc: "Servidor MCP e documentação da API." },
    ],
  },
];

export function SettingsScreen() {
  const router = useRouter();
  const [page, setPage] = useQueryState("page", parseAsString.withDefault("prefs"));
  const item = NAV.flatMap((s) => s.items).find((i) => i.k === page) ?? NAV[0].items[0];
  const names = useNames();
  const backHref = useLastAppUrl();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("[data-modal]")) router.push(backHref);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [router, backHref]);

  return (
    <div className="grid h-dvh grid-cols-[220px_minmax(0,1fr)] bg-editor text-fg-1">
      <nav className="flex flex-col gap-0.5 overflow-y-auto border-r border-stroke-3 bg-chrome p-2.5">
        <Link href={backHref} className="flex h-[30px] items-center gap-1.5 px-2 text-[12.5px] text-fg-3 hover:text-fg-strong">
          ← Voltar ao app <kbd className="ml-auto rounded border border-stroke-3 px-1 font-mono text-[10px]">Esc</kbd>
        </Link>
        <span className="px-2 pt-1.5 pb-1 text-[14px] font-semibold">Ajustes</span>
        {NAV.map((s) => (
          <div key={s.section} className="flex flex-col gap-0.5">
            <span className="px-2 pt-3 pb-1 text-[11px] text-fg-3">{s.section}</span>
            {s.items.map((i) => (
              <button
                key={i.k}
                type="button"
                onClick={() => void setPage(i.k)}
                className={cn("flex h-7 items-center rounded-[6px] px-2 text-left text-[12.5px]", i.k === item.k ? "bg-fill-2/80 font-medium" : "text-fg-2 hover:bg-fill-3")}
              >
                {i.l}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="flex min-w-0 flex-col gap-3.5 overflow-y-auto px-6 py-5">
        <div className="flex flex-col gap-1">
          <span className="text-[17px] font-semibold">{item.l}</span>
          <span className="text-[12.5px] text-fg-3">{item.desc}</span>
        </div>
        {item.k === "prefs" ? <PrefsPage /> : null}
        {item.k === "ent" ? <EntitiesPage names={names} /> : null}
        {item.k === "bank" ? <AccountsPage names={names} types={["checking", "cash"]} /> : null}
        {item.k === "card" ? <AccountsPage names={names} types={["credit_card"]} /> : null}
        {item.k === "broker" ? <AccountsPage names={names} types={["brokerage"]} /> : null}
        {item.k === "cat" ? <CategoriesPage names={names} /> : null}
        {item.k === "rules" ? <RulesPage names={names} /> : null}
        {item.k === "fx" ? <CurrencyPage /> : null}
        {item.k === "imports" ? <ImportsPage names={names} /> : null}
        {item.k === "trash" ? <TrashPage names={names} /> : null}
        {item.k === "api" ? <ApiPage /> : null}
      </div>
    </div>
  );
}

function ListDetail({ list, detail }: { list: ReactNode; detail: ReactNode }) {
  return (
    <div className="grid max-w-[920px] items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="flex flex-col gap-0.5">{list}</div>
      <div className="flex flex-col gap-3 rounded-[10px] border border-stroke-3 p-3.5">{detail}</div>
    </div>
  );
}

function ListItem({ on, onClick, left, right, faded }: { on: boolean; onClick: () => void; left: ReactNode; right?: ReactNode; faded?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={cn("flex h-[34px] items-center gap-2 rounded-[6px] px-2.5 text-left text-[12.5px]", on ? "bg-fill-3" : "hover:bg-fill-4", faded && "opacity-50")}>
      <span className="flex min-w-0 flex-1 items-center gap-2">{left}</span>
      {right}
    </button>
  );
}

function PrefsPage() {
  const session = useSession();
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale();
  const me = session.data;
  const [name, setName] = useState(me?.name ?? "");
  const [timezone, setTimezone] = useState(me?.timezone ?? "America/Sao_Paulo");
  const [baseCurrency, setBaseCurrency] = useState(me?.baseCurrency ?? "BRL");
  const [dateFormat, setDateFormat] = useState(me?.dateFormat ?? "dd/MM/yyyy");
  const [numberFormat, setNumberFormat] = useState(me?.numberFormat ?? "1.234,56");
  const currencies = useQuery({ queryKey: ["currencies"], queryFn: () => api<{ currencies: { code: string; name: string }[] }>("/api/v2/currencies") });
  const zones = useMemo(() => (typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["America/Sao_Paulo", "UTC"]), []);
  const save = useMutation({
    mutationFn: () => apiPatch("/api/v2/me", { name, timezone, baseCurrency, dateFormat, numberFormat }),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      toast.success("Preferências salvas");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  if (!me) return null;
  return (
    <div className="grid max-w-[560px] grid-cols-2 gap-3">
      <Field label="Nome"><TextInput value={name} onChange={setName} /></Field>
      <Field label="E-mail"><TextInput value={me.email} onChange={() => undefined} className="bg-fill-4 text-fg-muted" /></Field>
      <Field label="Moeda base" hint="Todos os totais e views são convertidos para ela. Com lançamentos já feitos, a troca é recusada.">
        <SelectInput value={baseCurrency} onChange={setBaseCurrency} options={(currencies.data?.currencies ?? [{ code: baseCurrency, name: "" }]).map((c) => ({ value: c.code, label: c.code }))} />
      </Field>
      <Field label="Fuso horário"><SelectInput value={timezone} onChange={setTimezone} options={zones.map((z) => ({ value: z, label: z }))} /></Field>
      <Field label="Formato de data"><SelectInput value={dateFormat} onChange={setDateFormat} options={["dd/MM/yyyy", "yyyy-MM-dd", "MM/dd/yyyy"].map((v) => ({ value: v, label: v }))} /></Field>
      <Field label="Formato de número"><SelectInput value={numberFormat} onChange={setNumberFormat} options={["1.234,56", "1,234.56"].map((v) => ({ value: v, label: v }))} /></Field>
      <Field label="Idioma">
        <Segmented value={locale} options={[{ v: "pt-BR", l: "Português" }, { v: "en", l: "English" }]} onChange={(next) => router.replace(`${pathname}?page=prefs`, { locale: next })} />
      </Field>
      <div className="col-span-2"><Btn primary disabled={save.isPending} onClick={() => save.mutate()}>Salvar</Btn></div>
    </div>
  );
}

interface EntityRecord {
  id: string;
  kind: "personal" | "business";
  name: string;
  description: string | null;
  defaultCurrency: string;
  taxRate: number;
  archivedAt: string | null;
}

function EntitiesPage({ names }: { names: Names }) {
  const queryClient = useQueryClient();
  const entities = useQuery({ queryKey: ["entities", "all"], queryFn: () => api<EntityRecord[]>("/api/v2/entities?includeArchived=true") });
  const [sel, setSel] = useState<string | "new" | null>(null);
  const list = entities.data ?? [];
  const current = sel === "new" ? null : list.find((e) => e.id === sel) ?? list[0];
  const [form, setForm] = useState<{ name: string; description: string; defaultCurrency: string; taxRate: string } | null>(null);
  const values = form ?? { name: current?.name ?? "", description: current?.description ?? "", defaultCurrency: current?.defaultCurrency ?? names.currency, taxRate: current ? String(Math.round(current.taxRate * 1000) / 10) : "0" };
  const select = (id: string | "new") => {
    setSel(id);
    setForm(id === "new" ? { name: "", description: "", defaultCurrency: names.currency, taxRate: "0" } : null);
  };
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ["entities"] }), queryClient.invalidateQueries({ queryKey: ["me"] })]);
  const save = useMutation({
    mutationFn: () => {
      const body = { name: values.name.trim(), description: values.description || null, defaultCurrency: values.defaultCurrency, taxRate: (Number(values.taxRate.replace(",", ".")) || 0) / 100 };
      return sel === "new" || !current ? apiPost<EntityRecord>("/api/v2/entities", body) : apiPatch<EntityRecord>(`/api/v2/entities/${current.id}`, body);
    },
    onSuccess: async (entity) => {
      await refresh();
      setSel(entity.id);
      setForm(null);
      toast.success("Salvo");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <ListDetail
      list={
        <>
          {list.map((e) => (
            <ListItem key={e.id} on={current?.id === e.id && sel !== "new"} onClick={() => select(e.id)} faded={!!e.archivedAt} left={<><span>{e.name}</span>{e.kind === "personal" ? <Badge>PF</Badge> : null}{e.archivedAt ? <Badge>arquivada</Badge> : null}</>} right={<span className="font-mono text-[11px] text-fg-3">{e.defaultCurrency}</span>} />
          ))}
          <button type="button" className={cn("h-[34px] rounded-[6px] px-2.5 text-left text-[12.5px] text-fg-3 hover:bg-fill-4", sel === "new" && "bg-fill-3 text-fg-ink")} onClick={() => select("new")}>+ Novo negócio</button>
        </>
      }
      detail={
        <>
          <Field label="Nome"><TextInput value={values.name} onChange={(name) => setForm({ ...values, name })} /></Field>
          <Field label="Descrição"><TextInput value={values.description} onChange={(description) => setForm({ ...values, description })} /></Field>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Moeda padrão"><TextInput value={values.defaultCurrency} onChange={(defaultCurrency) => setForm({ ...values, defaultCurrency: defaultCurrency.toUpperCase().slice(0, 3) })} /></Field>
            <Field label="Alíquota de imposto (%)"><TextInput value={values.taxRate} onChange={(taxRate) => setForm({ ...values, taxRate })} mono /></Field>
          </div>
          <div className="flex gap-1.5 border-t border-stroke-3 pt-2.5">
            <Btn primary disabled={!values.name.trim() || save.isPending} onClick={() => save.mutate()}>{sel === "new" ? "Criar" : "Salvar"}</Btn>
            {current && current.kind === "business" && sel !== "new" ? (
              <Btn
                onClick={() =>
                  void apiPatch(`/api/v2/entities/${current.id}`, { archived: !current.archivedAt })
                    .then(refresh)
                    .catch((error: Error) => toast.error(error.message))
                }
              >
                {current.archivedAt ? "Reativar" : "Arquivar"}
              </Btn>
            ) : null}
          </div>
        </>
      }
    />
  );
}

function AccountsPage({ names, types }: { names: Names; types: AccountRecord["type"][] }) {
  const queryClient = useQueryClient();
  const accounts = names.accounts.filter((a) => types.includes(a.type));
  const [sel, setSel] = useState<string | "new" | null>(null);
  const current = sel === "new" ? null : accounts.find((a) => a.id === sel) ?? accounts[0] ?? null;
  const isNew = sel === "new" || !current;
  const blank = () => ({ name: "", entityId: names.entities[0]?.id ?? "", type: types[0], institution: "", currency: names.currency, externalId: "", initialBalance: "", creditLimit: "", closingDay: "", dueDay: "", payFromAccountId: "" });
  const fromAccount = (a: AccountRecord) => ({
    name: a.name,
    entityId: a.entityId,
    type: a.type,
    institution: a.institution ?? "",
    currency: a.currency,
    externalId: a.externalId ?? "",
    initialBalance: "",
    creditLimit: a.creditLimit != null ? String(a.creditLimit) : "",
    closingDay: a.closingDay != null ? String(a.closingDay) : "",
    dueDay: a.dueDay != null ? String(a.dueDay) : "",
    payFromAccountId: a.payFromAccountId ?? "",
  });
  const [form, setForm] = useState<ReturnType<typeof blank> | null>(null);
  const values = form ?? (current && !isNew ? fromAccount(current) : blank());
  const set = (patch: Partial<typeof values>) => setForm({ ...values, ...patch });
  const isCard = values.type === "credit_card";
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["accounts"] });
  const save = useMutation({
    mutationFn: () => {
      const common = {
        name: values.name.trim(),
        institution: values.institution || null,
        externalId: values.externalId || null,
        ...(isCard ? { creditLimit: parseAmount(values.creditLimit), closingDay: Number(values.closingDay), dueDay: Number(values.dueDay), payFromAccountId: values.payFromAccountId || null } : {}),
      };
      if (isNew) {
        return apiPost<AccountRecord>("/api/v2/accounts", {
          ...common,
          entityId: values.entityId,
          type: values.type,
          currency: values.currency,
          ...(values.initialBalance ? { initialBalance: parseAmount(values.initialBalance) } : {}),
        });
      }
      return apiPatch<AccountRecord>(`/api/v2/accounts/${current!.id}`, common);
    },
    onSuccess: async (account) => {
      await refresh();
      setSel(account.id);
      setForm(null);
      toast.success("Salvo");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const payOptions = names.accounts.filter((a) => a.type === "checking" && !a.archivedAt);
  return (
    <ListDetail
      list={
        <>
          {names.entities.map((e) => {
            const items = accounts.filter((a) => a.entityId === e.id);
            if (!items.length) return null;
            return (
              <div key={e.id} className="flex flex-col gap-0.5">
                <span className="px-2.5 pt-2 pb-0.5 text-[11px] text-fg-3">{names.entity.get(e.id)}</span>
                {items.map((a) => (
                  <ListItem
                    key={a.id}
                    on={current?.id === a.id && sel !== "new"}
                    faded={!!a.archivedAt}
                    onClick={() => { setSel(a.id); setForm(null); }}
                    left={<><span className="truncate">{a.name}</span>{a.isDefault ? <Badge>principal</Badge> : null}{a.archivedAt ? <Badge>arquivada</Badge> : null}</>}
                    right={<span className="font-mono text-[11px] text-fg-3 tabular-nums">{a.type === "credit_card" ? `fecha ${a.closingDay} · vence ${a.dueDay}` : a.balance != null ? money(a.balance, a.currency) : a.currency}</span>}
                  />
                ))}
              </div>
            );
          })}
          {!accounts.length ? <span className="px-2.5 py-2 text-[12px] text-fg-3">Nenhuma conta deste tipo.</span> : null}
          <button type="button" className={cn("h-[34px] rounded-[6px] px-2.5 text-left text-[12.5px] text-fg-3 hover:bg-fill-4", sel === "new" && "bg-fill-3 text-fg-ink")} onClick={() => { setSel("new"); setForm(blank()); }}>
            + Nova {types[0] === "credit_card" ? "fatura de cartão" : types[0] === "brokerage" ? "corretora" : "conta"}
          </button>
        </>
      }
      detail={
        <>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Nome"><TextInput value={values.name} onChange={(name) => set({ name })} placeholder={isCard ? "Nubank · cartão" : "Nubank"} /></Field>
            <Field label="Instituição"><TextInput value={values.institution} onChange={(institution) => set({ institution })} /></Field>
            <Field label="Entidade">
              <SelectInput value={values.entityId} onChange={(entityId) => set({ entityId })} options={names.entities.map((e) => ({ value: e.id, label: names.entity.get(e.id) ?? e.name }))} />
            </Field>
            {types.length > 1 && isNew ? (
              <Field label="Tipo"><SelectInput value={values.type} onChange={(type) => set({ type: type as AccountRecord["type"] })} options={types.map((t) => ({ value: t, label: ACCOUNT_TYPE_LABEL[t] }))} /></Field>
            ) : (
              <Field label="Moeda"><TextInput value={values.currency} onChange={(currency) => set({ currency: currency.toUpperCase().slice(0, 3) })} /></Field>
            )}
            {types.length > 1 && isNew ? <Field label="Moeda"><TextInput value={values.currency} onChange={(currency) => set({ currency: currency.toUpperCase().slice(0, 3) })} /></Field> : null}
            <Field label={isCard ? "Final do cartão" : "Número da conta (opcional)"}><TextInput value={values.externalId} onChange={(externalId) => set({ externalId })} mono /></Field>
            {isNew && !isCard ? <Field label="Saldo inicial"><TextInput value={values.initialBalance} onChange={(initialBalance) => set({ initialBalance })} mono placeholder="0,00" /></Field> : null}
          </div>
          {isCard ? (
            <div className="grid grid-cols-3 gap-2.5">
              <Field label="Limite"><TextInput value={values.creditLimit} onChange={(creditLimit) => set({ creditLimit })} mono /></Field>
              <Field label="Dia de fechamento"><TextInput value={values.closingDay} onChange={(closingDay) => set({ closingDay })} mono /></Field>
              <Field label="Dia de vencimento"><TextInput value={values.dueDay} onChange={(dueDay) => set({ dueDay })} mono /></Field>
              <Field label="Conta que paga a fatura" className="col-span-3">
                <SelectInput value={values.payFromAccountId} onChange={(payFromAccountId) => set({ payFromAccountId })} placeholder="Conta principal da entidade" options={payOptions.map((a) => ({ value: a.id, label: `${a.name} · ${names.entity.get(a.entityId) ?? ""}` }))} />
              </Field>
            </div>
          ) : null}
          <div className="flex gap-1.5 border-t border-stroke-3 pt-2.5">
            <Btn primary disabled={!values.name.trim() || save.isPending} onClick={() => save.mutate()}>{isNew ? "Criar" : "Salvar"}</Btn>
            {!isNew && current && !current.isDefault ? (
              <Btn onClick={() => void apiPatch(`/api/v2/accounts/${current.id}`, { archived: !current.archivedAt }).then(refresh).catch((error: Error) => toast.error(error.message))}>
                {current.archivedAt ? "Reativar" : "Arquivar"}
              </Btn>
            ) : null}
            {!isNew && current?.archivedAt == null ? <span className="self-center text-[11.5px] text-fg-3">Arquivar tira dos seletores; o histórico continua.</span> : null}
          </div>
        </>
      }
    />
  );
}

// Stored on the category, so these stay hex (same hues as --cap-cat-*).
const COLORS = ["#737373", "#7c3aed", "#16a34a", "#ca8a04", "#0891b2", "#db2777", "#2563eb", "#ea580c", "#dc2626"];

interface Rule {
  id: string;
  matchType: "contains" | "equals" | "regex";
  pattern: string;
  categoryId: string;
  entityId: string | null;
  source: string;
  hitCount: number;
  lastHitAt: string | null;
  category: { name: string } | null;
}

function useRules() {
  return useQuery({ queryKey: ["rules"], queryFn: () => api<Rule[]>("/api/v2/rules") });
}

function CategoriesPage({ names }: { names: Names }) {
  const queryClient = useQueryClient();
  const rules = useRules();
  const [sel, setSel] = useState<string | "new" | null>(null);
  const cats = names.categories;
  const current = sel === "new" ? null : cats.find((c) => c.id === sel) ?? cats.find((c) => c.type === "expense") ?? null;
  const usage = useQuery({
    queryKey: ["category-usage", current?.id],
    enabled: !!current && sel !== "new",
    queryFn: () => api<{ entries: number; recurring: number; budgets: number; rules: number }>(`/api/v2/categories/${current!.id}/usage`),
  });
  const [form, setForm] = useState<{ name: string; type: "expense" | "income" | "investment"; color: string | null } | null>(null);
  const values = form ?? { name: current?.name ?? "", type: current?.type ?? "expense", color: current?.color ?? null };
  const [rulePattern, setRulePattern] = useState("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["categories"] });
  const save = useMutation({
    mutationFn: () =>
      sel === "new" || !current
        ? apiPost<{ id: string }>("/api/v2/categories", { name: values.name.trim(), type: values.type, color: values.color })
        : apiPatch<{ id: string }>(`/api/v2/categories/${current.id}`, { name: values.name.trim(), type: values.type, color: values.color }),
    onSuccess: async (c) => {
      await refresh();
      setSel(c.id);
      setForm(null);
      toast.success("Salvo");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const catRules = (rules.data ?? []).filter((r) => r.categoryId === current?.id);
  return (
    <ListDetail
      list={
        <>
          {(["expense", "income", "investment"] as const).map((type) => (
            <div key={type} className="flex flex-col gap-0.5">
              <span className="px-2.5 pt-2 pb-0.5 text-[11px] text-fg-3">{type === "expense" ? "Despesas" : type === "income" ? "Receitas" : "Investimentos"}</span>
              {cats
                .filter((c) => c.type === type)
                .sort((a, b) => Number(a.isArchived) - Number(b.isArchived) || a.name.localeCompare(b.name))
                .map((c) => (
                  <ListItem
                    key={c.id}
                    on={current?.id === c.id && sel !== "new"}
                    faded={c.isArchived}
                    onClick={() => { setSel(c.id); setForm(null); }}
                    left={<><span className="size-2 shrink-0 rounded-full" style={{ background: c.color ?? "var(--cap-text-4)" }} /><span className="truncate">{c.name}</span>{c.isArchived ? <Badge>arquivada</Badge> : null}</>}
                  />
                ))}
            </div>
          ))}
          <button type="button" className={cn("h-[34px] rounded-[6px] px-2.5 text-left text-[12.5px] text-fg-3 hover:bg-fill-4", sel === "new" && "bg-fill-3 text-fg-ink")} onClick={() => { setSel("new"); setForm({ name: "", type: "expense", color: null }); }}>
            + Nova categoria
          </button>
        </>
      }
      detail={
        <>
          <Field label="Nome"><TextInput value={values.name} onChange={(name) => setForm({ ...values, name })} /></Field>
          <Field label="Tipo">
            <Segmented value={values.type} options={[{ v: "expense", l: "Despesa" }, { v: "income", l: "Receita" }, { v: "investment", l: "Investimento" }]} onChange={(type) => setForm({ ...values, type })} />
          </Field>
          <Field label="Cor">
            <span className="flex gap-1.5">
              {COLORS.map((color) => (
                <button key={color} type="button" onClick={() => setForm({ ...values, color })} className="size-[18px] rounded-full" style={{ background: color, outline: values.color === color ? "2px solid var(--cap-text-ink)" : "none", outlineOffset: 2 }} />
              ))}
            </span>
          </Field>
          {current && sel !== "new" ? (
            <>
              <Field label="Regras automáticas" hint="Descrições que caem nesta categoria ao importar ou criar">
                <span className="flex flex-wrap items-center gap-1">
                  {catRules.map((r) => (
                    <span key={r.id} className="inline-flex h-[18px] items-center gap-1 rounded border border-stroke-3 px-1.5 font-mono text-[11px]">
                      {r.pattern}
                      <button type="button" className="text-fg-3 hover:text-neg" onClick={() => void apiDelete(`/api/v2/rules/${r.id}`).then(() => queryClient.invalidateQueries({ queryKey: ["rules"] }))}>✕</button>
                    </span>
                  ))}
                  <form className="inline-flex gap-1" onSubmit={(event) => { event.preventDefault(); if (!rulePattern.trim()) return; void apiPost("/api/v2/rules", { matchType: "contains", pattern: rulePattern.trim(), categoryId: current.id }).then(() => { setRulePattern(""); return queryClient.invalidateQueries({ queryKey: ["rules"] }); }).catch((error: Error) => toast.error(error.message)); }}>
                    <TextInput value={rulePattern} onChange={setRulePattern} placeholder="+ regra (contém…)" className="h-[22px] w-36 text-[11.5px]" />
                  </form>
                </span>
              </Field>
              <span className="text-[12px] text-fg-3">
                {usage.data ? `Usada em ${usage.data.entries} lançamentos, ${usage.data.budgets} orçamentos, ${usage.data.recurring} recorrências e ${usage.data.rules} regras.` : "…"}
              </span>
            </>
          ) : null}
          <div className="flex flex-wrap items-center gap-1.5 border-t border-stroke-3 pt-2.5">
            <Btn primary disabled={!values.name.trim() || save.isPending} onClick={() => save.mutate()}>{sel === "new" ? "Criar" : "Salvar"}</Btn>
            {current && sel !== "new" ? (
              <>
                <Btn onClick={() => void apiPatch(`/api/v2/categories/${current.id}`, { isArchived: !current.isArchived }).then(refresh).then(() => toast.success(current.isArchived ? `“${current.name}” reativada` : `“${current.name}” arquivada: some dos seletores, continua no histórico`)).catch((error: Error) => toast.error(error.message))}>
                  {current.isArchived ? "Reativar" : "Arquivar"}
                </Btn>
                <span className="text-[11.5px] text-fg-3">Some dos seletores; o histórico continua igual.</span>
              </>
            ) : null}
          </div>
        </>
      }
    />
  );
}

function RulesPage({ names }: { names: Names }) {
  const queryClient = useQueryClient();
  const rules = useRules();
  const [test, setTest] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [pattern, setPattern] = useState("");
  const [matchType, setMatchType] = useState("contains");
  const [categoryId, setCategoryId] = useState("");
  async function runTest() {
    if (!test.trim()) return setResult(null);
    const r = await apiPost<{ rule: { pattern: string } | null; category: { name: string } | null }>("/api/v2/rules/test", { description: test });
    setResult(r.category ? `→ ${r.category.name} (regra “${r.rule?.pattern}”)` : "nenhuma regra; a IA sugere ao importar");
  }
  const create = useMutation({
    mutationFn: () => apiPost("/api/v2/rules", { matchType, pattern: pattern.trim(), categoryId }),
    onSuccess: async () => {
      setPattern("");
      await queryClient.invalidateQueries({ queryKey: ["rules"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <div className="flex max-w-[920px] flex-col gap-3">
      <form className="flex items-center gap-2" onSubmit={(event) => { event.preventDefault(); void runTest(); }}>
        <span className="text-[12px] text-fg-3">Testar uma descrição</span>
        <TextInput value={test} onChange={setTest} placeholder="IFOOD *RESTAURANTE" className="w-[260px]" />
        <Btn type="submit">Testar</Btn>
        {result ? <span className="text-[12.5px]">{result}</span> : null}
      </form>
      <form className="flex flex-wrap items-center gap-1.5" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
        <SelectInput value={matchType} onChange={setMatchType} options={[{ value: "contains", label: "contém" }, { value: "equals", label: "é igual a" }, { value: "regex", label: "regex" }]} />
        <TextInput value={pattern} onChange={setPattern} placeholder="uber" required className="w-44" />
        <span className="text-fg-3">→</span>
        <SelectInput value={categoryId} onChange={setCategoryId} required placeholder="Categoria" options={names.categories.filter((c) => !c.isArchived).sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ value: c.id, label: c.name }))} />
        <Btn primary type="submit" disabled={!pattern.trim() || !categoryId}>+ Nova regra</Btn>
      </form>
      <div className="overflow-hidden rounded-lg border border-stroke-3">
        <div className="grid h-[34px] grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_110px_70px_80px_50px] items-center gap-3 px-3 text-[11.5px] text-fg-3">
          <span>Descrição</span><span>Categoria</span><span>Origem</span><span className="text-right">Aplicada</span><span>Última vez</span><span />
        </div>
        {(rules.data ?? []).map((r) => (
          <div key={r.id} className="grid h-[34px] grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_110px_70px_80px_50px] items-center gap-3 border-t border-stroke-3 px-3 text-[12.5px]">
            <span className="truncate font-mono text-[12px]"><span className="text-fg-3">{r.matchType === "contains" ? "contém " : r.matchType === "equals" ? "= " : "/ "}</span>{r.pattern}</span>
            <span className="truncate">{r.category?.name ?? "—"}</span>
            <span className="text-fg-muted">{r.source === "manual" ? "Você" : r.source === "ai" ? "IA" : r.source}</span>
            <span className="text-right font-mono tabular-nums">{r.hitCount}×</span>
            <span className="font-mono text-[11.5px] text-fg-3">{r.lastHitAt ? r.lastHitAt.slice(5, 10).split("-").reverse().join("/") : "—"}</span>
            <button type="button" className="text-right text-[11px] text-fg-3 hover:text-neg" onClick={() => void apiDelete(`/api/v2/rules/${r.id}`).then(() => queryClient.invalidateQueries({ queryKey: ["rules"] }))}>excluir</button>
          </div>
        ))}
        {!rules.data?.length ? <EmptyRow>Nenhuma regra ainda. Elas também nascem quando você cria uma regra a partir de um lançamento.</EmptyRow> : null}
      </div>
    </div>
  );
}

function CurrencyPage() {
  const queryClient = useQueryClient();
  const currencies = useQuery({ queryKey: ["currencies"], queryFn: () => api<{ baseCurrency: string; currencies: { code: string; name: string; symbol: string; manualRate: number; updatedAt: string }[] }>("/api/v2/currencies") });
  const [rates, setRates] = useState<Record<string, string>>({});
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [rate, setRate] = useState("");
  const base = currencies.data?.baseCurrency ?? "BRL";
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["currencies"] });
  return (
    <div className="flex max-w-[760px] flex-col gap-3">
      <span className="text-[12.5px]">Moeda base: <b>{base}</b> <span className="text-fg-3">· muda em Perfil e preferências</span></span>
      <div className="overflow-hidden rounded-lg border border-stroke-3">
        <div className="grid h-[34px] grid-cols-[minmax(0,1.4fr)_60px_200px_90px_60px] items-center gap-3 px-3 text-[11.5px] text-fg-3">
          <span>Moeda</span><span>Símbolo</span><span>Unidades por 1 {base}</span><span>Atualizada</span><span />
        </div>
        {(currencies.data?.currencies ?? []).map((c) => (
          <div key={c.code} className="grid h-[34px] grid-cols-[minmax(0,1.4fr)_60px_200px_90px_60px] items-center gap-3 border-t border-stroke-3 px-3 text-[12.5px]">
            <span>{c.name} ({c.code})</span>
            <span className="text-fg-muted">{c.symbol}</span>
            {c.code === base ? (
              <span className="font-mono text-fg-3">1 (base)</span>
            ) : (
              <form className="flex gap-1" onSubmit={(event) => { event.preventDefault(); const v = parseAmount(rates[c.code] ?? ""); if (v > 0) void apiPatch(`/api/v2/currencies/${c.code}`, { manualRate: v }).then(() => { setRates({ ...rates, [c.code]: "" }); return refresh(); }).catch((error: Error) => toast.error(error.message)); }}>
                <TextInput value={rates[c.code] ?? String(c.manualRate)} onChange={(v) => setRates({ ...rates, [c.code]: v })} mono className="w-24" />
                <Btn type="submit" disabled={!rates[c.code]}>OK</Btn>
              </form>
            )}
            <span className="font-mono text-[11.5px] text-fg-3">{c.updatedAt.slice(5, 10).split("-").reverse().join("/")}</span>
            {c.code !== base ? <button type="button" className="text-right text-[11px] text-fg-3 hover:text-neg" onClick={() => void apiDelete(`/api/v2/currencies/${c.code}`).then(refresh).catch((error: Error) => toast.error(error.message))}>remover</button> : <span />}
          </div>
        ))}
      </div>
      <form className="flex flex-wrap items-end gap-1.5" onSubmit={(event) => { event.preventDefault(); void apiPost("/api/v2/currencies", { code, name, symbol, manualRate: parseAmount(rate) }).then(() => { setCode(""); setName(""); setSymbol(""); setRate(""); return refresh(); }).catch((error: Error) => toast.error(error.message)); }}>
        <Field label="Código"><TextInput value={code} onChange={(v) => setCode(v.toUpperCase().slice(0, 3))} className="w-16" required /></Field>
        <Field label="Nome"><TextInput value={name} onChange={setName} required /></Field>
        <Field label="Símbolo"><TextInput value={symbol} onChange={setSymbol} className="w-16" required /></Field>
        <Field label={`Por 1 ${base}`}><TextInput value={rate} onChange={setRate} mono className="w-24" required /></Field>
        <Btn primary type="submit">Adicionar</Btn>
      </form>
      <p className="text-[11.5px] text-fg-3">Cada lançamento guarda a taxa usada no dia; mudar a taxa aqui só afeta lançamentos novos.</p>
    </div>
  );
}

function TrashPage({ names }: { names: Names }) {
  const queryClient = useQueryClient();
  const trash = useQuery({ queryKey: ["trash"], queryFn: () => api<{ rows: { id: string; date: string; description: string; amountBase: number; accountId: string; deletedAt: string | null }[] }>("/api/v2/trash") });
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ["trash"] }), queryClient.invalidateQueries({ queryKey: ["ledger"] })]);
  return (
    <div className="flex max-w-[860px] flex-col gap-3">
      <div className="flex gap-1.5">
        <Btn danger disabled={!trash.data?.rows.length} onClick={() => { if (window.confirm("Apagar de vez tudo o que está na lixeira?")) void apiDelete("/api/v2/trash").then(refresh); }}>Esvaziar lixeira</Btn>
      </div>
      <div className="overflow-hidden rounded-lg border border-stroke-3">
        {(trash.data?.rows ?? []).map((row) => (
          <div key={row.id} className="flex h-[34px] items-center gap-3 border-t border-stroke-3 px-3 text-[12.5px] first:border-t-0">
            <span className="w-12 font-mono text-[11.5px] text-fg-3">{row.date.slice(5).split("-").reverse().join("/")}</span>
            <span className="flex-1 truncate">{row.description}</span>
            <span className="text-fg-muted">{names.account.get(row.accountId)}</span>
            <span className="w-28 text-right font-mono tabular-nums">{money(row.amountBase, names.currency)}</span>
            <Btn ghost onClick={() => void apiPost("/api/v2/trash/restore", { ids: [row.id] }).then(refresh).catch((error: Error) => toast.error(error.message))}>Restaurar</Btn>
          </div>
        ))}
        {!trash.data?.rows.length ? <EmptyRow>A lixeira está vazia.</EmptyRow> : null}
      </div>
    </div>
  );
}

function ApiPage() {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return (
    <div className="grid max-w-[620px] grid-cols-2 gap-3">
      <Field label="Servidor MCP" hint="Use no Cursor, Claude e outros clientes MCP">
        <TextInput value={`${origin}/mcp`} onChange={() => undefined} mono />
      </Field>
      <Field label="Autenticação" hint="Bearer token definido no servidor (MCP_API_KEY)">
        <TextInput value="Authorization: Bearer …" onChange={() => undefined} mono />
      </Field>
      <div className="col-span-2 flex gap-1.5">
        <Btn onClick={() => void navigator.clipboard.writeText(`${origin}/mcp`).then(() => toast.success("Copiado"))}>Copiar URL</Btn>
        <a href="/api/reference" target="_blank" rel="noreferrer" className="inline-flex h-[26px] items-center rounded-[6px] px-2.5 text-[12px] font-medium text-fg-muted hover:bg-fill-3">Documentação da API ↗</a>
      </div>
    </div>
  );
}
