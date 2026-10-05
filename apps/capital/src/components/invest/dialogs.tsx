"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, apiPost, apiPut } from "@/lib/api/client";
import type { Names } from "@/lib/api/catalog";
import { ASSET_CLASS_LABEL, money, parseAmount, todayIso } from "@/lib/money";
import { Btn, Field, Modal, Segmented, SelectInput, TextInput } from "@/components/shell/chrome";
import { ASSET_CLASSES, OP_LABEL, type Holding } from "./types";

function invalidatePortfolio(queryClient: ReturnType<typeof useQueryClient>) {
  return Promise.all(
    ["portfolio", "holdings", "operations", "ledger", "accounts", "contributions"].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
  );
}

export function OperationDialog({ names, holdings, initialHoldingId, onClose }: { names: Names; holdings: Holding[]; initialHoldingId?: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const brokers = names.accounts.filter((a) => a.type === "brokerage" && !a.archivedAt);
  const cashAccounts = names.accounts.filter((a) => a.type !== "brokerage" && a.type !== "credit_card" && !a.archivedAt);
  const active = holdings.filter((h) => h.isActive);
  const [mode, setMode] = useState<"existing" | "new">(active.length && initialHoldingId !== "new" ? "existing" : "new");
  const [holdingId, setHoldingId] = useState(initialHoldingId && initialHoldingId !== "new" ? initialHoldingId : active[0]?.id ?? "");
  const [brokerId, setBrokerId] = useState(brokers[0]?.id ?? "");
  const [assetClass, setAssetClass] = useState<string>("stocks");
  const [ticker, setTicker] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<"buy" | "sell" | "dividend" | "yield_payment">("buy");
  const [date, setDate] = useState(todayIso());
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [total, setTotal] = useState("");
  const [fees, setFees] = useState("");
  const [fundFrom, setFundFrom] = useState("");
  const qty = parseAmount(quantity);
  const unit = parseAmount(price);
  const computed = Number.isFinite(qty) && Number.isFinite(unit) ? qty * unit : Number.NaN;
  const totalValue = total ? parseAmount(total) : computed;
  const holding = holdings.find((h) => h.id === holdingId);
  const isIncome = type === "dividend" || type === "yield_payment";

  const save = useMutation({
    mutationFn: async () => {
      if (!Number.isFinite(totalValue) || totalValue <= 0) throw new Error("Informe quantidade e preço, ou o total");
      let id = holdingId;
      if (mode === "new") {
        if (!brokerId) throw new Error("Cadastre uma corretora em Ajustes › Contas");
        if (!name.trim()) throw new Error("Dê um nome ao ativo");
        const created = await apiPost<Holding>("/api/v2/holdings", { accountId: brokerId, assetClass, ticker: ticker.trim() || null, name: name.trim(), currentPrice: unit > 0 ? unit : null });
        id = created.id;
      }
      if (!id) throw new Error("Escolha o ativo");
      return apiPost("/api/v2/investment-operations", {
        holdingId: id,
        type,
        date,
        quantity: isIncome ? null : qty,
        pricePerUnit: isIncome ? null : unit,
        totalAmount: totalValue,
        fees: fees ? parseAmount(fees) : undefined,
        fundFromAccountId: type === "buy" && fundFrom ? fundFrom : null,
      });
    },
    onSuccess: async () => {
      await invalidatePortfolio(queryClient);
      toast.success("Operação registrada");
      onClose();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Modal
      title="Nova operação"
      description="Compra, venda ou provento. O caixa da corretora é atualizado junto."
      onClose={onClose}
      footer={
        <>
          <Btn ghost onClick={onClose}>Cancelar</Btn>
          <Btn primary disabled={save.isPending} onClick={() => save.mutate()}>Registrar</Btn>
        </>
      }
    >
      <Segmented value={mode} options={[{ v: "existing", l: "Ativo da carteira" }, { v: "new", l: "Novo ativo" }]} onChange={setMode} />
      {mode === "existing" ? (
        <Field label="Ativo">
          <SelectInput
            value={holdingId}
            onChange={setHoldingId}
            options={active.map((h) => ({ value: h.id, label: `${h.ticker ? `${h.ticker} · ` : ""}${h.name} · ${h.accountName}` }))}
          />
        </Field>
      ) : (
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Corretora">
            <SelectInput value={brokerId} onChange={setBrokerId} placeholder={brokers.length ? undefined : "Nenhuma corretora"} options={brokers.map((b) => ({ value: b.id, label: `${b.name} · ${names.entity.get(b.entityId) ?? ""}` }))} />
          </Field>
          <Field label="Classe">
            <SelectInput value={assetClass} onChange={setAssetClass} options={ASSET_CLASSES.map((c) => ({ value: c, label: ASSET_CLASS_LABEL[c] }))} />
          </Field>
          <Field label="Ticker (opcional)"><TextInput value={ticker} onChange={setTicker} placeholder="PETR4, BTC…" /></Field>
          <Field label="Nome"><TextInput value={name} onChange={setName} placeholder="Petrobras PN" /></Field>
        </div>
      )}
      <Segmented
        value={type}
        options={[{ v: "buy", l: "Compra" }, { v: "sell", l: "Venda" }, { v: "dividend", l: "Dividendo" }, { v: "yield_payment", l: "Rendimento" }]}
        onChange={setType}
      />
      <div className="grid grid-cols-3 gap-2.5">
        <Field label="Data"><TextInput type="date" value={date} onChange={setDate} /></Field>
        {!isIncome ? <Field label="Quantidade"><TextInput value={quantity} onChange={setQuantity} mono placeholder="10" /></Field> : null}
        {!isIncome ? <Field label="Preço unitário"><TextInput value={price} onChange={setPrice} mono placeholder={holding?.currentPrice ? String(holding.currentPrice) : "0,00"} /></Field> : null}
        <Field label="Total" hint={!isIncome && !total && Number.isFinite(computed) ? `= ${money(computed, holding?.currency ?? names.currency)}` : undefined}>
          <TextInput value={total} onChange={setTotal} mono placeholder={Number.isFinite(computed) ? computed.toFixed(2) : "0,00"} />
        </Field>
        {!isIncome ? <Field label="Taxas"><TextInput value={fees} onChange={setFees} mono placeholder="0,00" /></Field> : null}
      </div>
      {type === "buy" ? (
        <Field label="Pagar com (opcional)" hint="Transfere o valor da conta para a corretora antes da compra">
          <SelectInput value={fundFrom} onChange={setFundFrom} placeholder="Caixa da corretora" options={cashAccounts.map((a) => ({ value: a.id, label: `${a.name} · ${names.entity.get(a.entityId) ?? ""}` }))} />
        </Field>
      ) : null}
    </Modal>
  );
}

export function TargetsDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const targets = useQuery({ queryKey: ["targets"], queryFn: async () => (await api<{ targets: { assetClass: string; targetPercent: number }[] }>("/api/v2/portfolio/targets")).targets });
  const [values, setValues] = useState<Record<string, string> | null>(null);
  const current = values ?? Object.fromEntries((targets.data ?? []).map((t) => [t.assetClass, String(Math.round(t.targetPercent * 1000) / 10)]));
  const sum = ASSET_CLASSES.reduce((s, c) => s + (Number((current[c] ?? "").replace(",", ".")) || 0), 0);
  const save = useMutation({
    mutationFn: () =>
      apiPut("/api/v2/portfolio/targets", {
        targets: ASSET_CLASSES.map((c) => ({ assetClass: c, targetPercent: Number((current[c] ?? "").replace(",", ".")) || 0 })).filter((t) => t.targetPercent > 0),
      }),
    onSuccess: async () => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["targets"] }), queryClient.invalidateQueries({ queryKey: ["portfolio"] })]);
      toast.success("Alvos salvos");
      onClose();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <Modal
      title="Alocação alvo"
      description="Percentual de cada classe na carteira. Precisa somar 100%."
      onClose={onClose}
      width={420}
      footer={
        <>
          <span className={`mr-auto font-mono text-[12px] tabular-nums ${Math.abs(sum - 100) < 0.01 ? "text-pos" : "text-warn"}`}>Soma {sum.toLocaleString("pt-BR")}%</span>
          <Btn ghost onClick={onClose}>Cancelar</Btn>
          <Btn primary disabled={Math.abs(sum - 100) >= 0.01 || save.isPending} onClick={() => save.mutate()}>Salvar</Btn>
        </>
      }
    >
      {ASSET_CLASSES.map((c) => (
        <div key={c} className="flex items-center gap-2 text-[12.5px]">
          <span className="flex-1">{ASSET_CLASS_LABEL[c]}</span>
          <TextInput value={current[c] ?? ""} onChange={(v) => setValues({ ...current, [c]: v })} mono className="w-20 text-right" placeholder="0" />
          <span className="text-fg-3">%</span>
        </div>
      ))}
    </Modal>
  );
}

export function HoldingSheet({ holding, names, onClose, onOperation }: { holding: Holding; names: Names; onClose: () => void; onOperation: () => void }) {
  const queryClient = useQueryClient();
  const [price, setPrice] = useState(holding.currentPrice != null ? String(holding.currentPrice) : "");
  const [qty, setQty] = useState(String(holding.currentQuantity));
  const [avg, setAvg] = useState(String(holding.averageCost));
  const ops = useQuery({
    queryKey: ["operations", "holding", holding.id],
    queryFn: async () => (await api<{ operations: { id: string; type: string; date: string; quantity: number | null; totalAmount: number }[] }>(`/api/v2/investment-operations?holdingId=${holding.id}`)).operations,
  });
  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/api/v2/holdings/${holding.id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: async () => {
      await invalidatePortfolio(queryClient);
      toast.success("Ativo atualizado");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const adjust = useMutation({
    mutationFn: () => apiPost(`/api/v2/holdings/${holding.id}/adjust`, { currentQuantity: parseAmount(qty), averageCost: parseAmount(avg), notes: "Ajuste manual" }),
    onSuccess: async () => {
      await invalidatePortfolio(queryClient);
      toast.success("Posição ajustada");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <aside className="absolute top-0 right-0 bottom-0 z-30 flex w-[340px] flex-col gap-3.5 overflow-y-auto border-l border-stroke-1 bg-editor p-4 shadow-[-8px_0_24px_-12px_rgba(0,0,0,0.12)]">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[13px] font-semibold">{holding.ticker ?? "—"}</span>
        <span className="truncate text-[13px]">{holding.name}</span>
        <button type="button" className="ml-auto text-fg-3 hover:text-fg-strong" onClick={onClose}>✕</button>
      </div>
      <span className="font-mono text-[22px] font-medium tabular-nums">{money(holding.marketValue, holding.currency)}</span>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 text-[12.5px]">
        {[
          ["Classe", ASSET_CLASS_LABEL[holding.assetClass] ?? holding.assetClass],
          ["Corretora", holding.accountName],
          ["Entidade", names.entity.get(holding.entityId) ?? "—"],
          ["Quantidade", holding.currentQuantity.toLocaleString("pt-BR")],
          ["Preço médio", money(holding.averageCost, holding.currency)],
          ["Investido", money(holding.totalInvested, holding.currency)],
          ["Resultado", `${money(holding.unrealizedGain, holding.currency)}${holding.unrealizedGainPercent != null ? ` · ${(holding.unrealizedGainPercent * 100).toFixed(1)}%` : ""}`],
          ["Cotação em", holding.lastPriceUpdate ? holding.lastPriceUpdate.slice(0, 10).split("-").reverse().join("/") : "—"],
        ].map(([k, v]) => (
          <div key={k} className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[11px] text-fg-3">{k}</span>
            <span className="truncate">{v}</span>
          </div>
        ))}
      </div>
      <form className="flex items-end gap-1.5 border-t border-stroke-3 pt-3" onSubmit={(event) => { event.preventDefault(); patch.mutate({ currentPrice: parseAmount(price) }); }}>
        <Field label="Cotação atual" className="flex-1"><TextInput value={price} onChange={setPrice} mono /></Field>
        <Btn type="submit">Atualizar</Btn>
      </form>
      <form className="flex items-end gap-1.5" onSubmit={(event) => { event.preventDefault(); adjust.mutate(); }}>
        <Field label="Quantidade" className="flex-1"><TextInput value={qty} onChange={setQty} mono /></Field>
        <Field label="Preço médio" className="flex-1"><TextInput value={avg} onChange={setAvg} mono /></Field>
        <Btn type="submit">Ajustar</Btn>
      </form>
      <div className="flex flex-col border-t border-stroke-3 pt-3">
        <span className="pb-1 text-[11px] text-fg-3">Operações</span>
        {(ops.data ?? []).slice(0, 12).map((op) => (
          <span key={op.id} className="flex h-7 items-center gap-2 text-[12.5px]">
            <span className="w-12 font-mono text-[11px] text-fg-3">{op.date.slice(5).split("-").reverse().join("/")}</span>
            <span className="flex-1">{OP_LABEL[op.type as keyof typeof OP_LABEL] ?? op.type}{op.quantity ? ` · ${op.quantity}` : ""}</span>
            <span className="font-mono tabular-nums">{money(op.totalAmount, holding.currency)}</span>
          </span>
        ))}
        {ops.data && !ops.data.length ? <span className="text-[12px] text-fg-3">Nenhuma operação.</span> : null}
      </div>
      <div className="mt-auto flex flex-wrap gap-1.5 border-t border-stroke-3 pt-3">
        <Btn primary onClick={onOperation}>+ Operação</Btn>
        <Btn ghost danger onClick={() => { if (window.confirm("Desativar este ativo? Ele sai da carteira, o histórico fica.")) patch.mutate({ isActive: false }, { onSuccess: onClose }); }}>Desativar</Btn>
      </div>
    </aside>
  );
}
