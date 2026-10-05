"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { LedgerRow } from "@capital/server/modules/ledger/contracts";
import { api, apiDelete, apiPatch, apiPost, apiUpload } from "@/lib/api";
import type { Names } from "@/lib/catalog";
import { money, parseAmount } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Btn, Check, Field, SelectInput, TextInput } from "@/components/shell/chrome";
import { CategorySelect } from "./categories";
import { KIND_LABEL } from "./fields";
import type { DisplayRow } from "./rows";

interface Attachment {
  id: string;
  originalName: string;
  blobUrl: string;
}

export function EntrySheet({ row, names, onClose, onDelete }: { row: DisplayRow; names: Names; onClose: () => void; onDelete: (row: DisplayRow) => void }) {
  const queryClient = useQueryClient();
  const isTransfer = row.transferGroupId !== null;
  const display = Math.abs(row.amount);
  const [description, setDescription] = useState(row.description);
  const [amount, setAmount] = useState(display.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const [date, setDate] = useState(row.date);
  const [accountId, setAccountId] = useState(row.accountId);
  const [categoryId, setCategoryId] = useState(row.categoryId ?? "");
  const [deductible, setDeductible] = useState(row.isTaxDeductible);
  const [notes, setNotes] = useState(row.notes ?? "");
  const ownerType = isTransfer ? "transfer" : "entry";
  const ownerId = isTransfer ? row.transferGroupId! : row.id;
  const attachments = useQuery({
    queryKey: ["attachments", ownerType, ownerId],
    queryFn: async () => (await api<{ attachments: Attachment[] }>(`/api/v2/attachments?ownerType=${ownerType}&ownerId=${ownerId}`)).attachments,
  });

  const save = useMutation({
    mutationFn: () => {
      const patch: Record<string, unknown> = {};
      const value = parseAmount(amount);
      if (description.trim() && description.trim() !== row.description) patch.description = description.trim();
      if (Number.isFinite(value) && Math.abs(value - display) > 0.004) patch.amount = value;
      if (date !== row.date) patch.date = date;
      if (!isTransfer) {
        if (accountId !== row.accountId) patch.accountId = accountId;
        if ((categoryId || null) !== row.categoryId) patch.categoryId = categoryId || null;
        if (deductible !== row.isTaxDeductible) patch.isTaxDeductible = deductible;
      }
      if ((notes || null) !== row.notes) patch.notes = notes || null;
      if (!Object.keys(patch).length) return Promise.resolve(null);
      return apiPatch<{ batchId: string | null; entry: LedgerRow }>(`/api/v2/ledger/entries/${row.id}`, patch);
    },
    onSuccess: async (result) => {
      if (!result) return onClose();
      await queryClient.invalidateQueries({ queryKey: ["ledger"] });
      toast("Alterações salvas", {
        action: result.batchId
          ? { label: "Desfazer", onClick: () => void apiPost(`/api/v2/mutations/${result.batchId}/undo`, {}).then(() => queryClient.invalidateQueries({ queryKey: ["ledger"] })) }
          : undefined,
      });
      onClose();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const createRule = useMutation({
    mutationFn: () => apiPost("/api/v2/rules", { matchType: "contains", pattern: row.description, categoryId, entityId: null }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["rules"] });
      toast.success(`Regra criada: “${row.description}” → ${names.category.get(categoryId) ?? ""}`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  async function upload(file: File) {
    const form = new FormData();
    form.set("file", file);
    form.set("kind", isTransfer ? "TRANSFER_RECEIPT" : "RECEIPT");
    form.set("ownerType", ownerType);
    form.set("ownerId", ownerId);
    try {
      await apiUpload("/api/v2/attachments", form);
      await queryClient.invalidateQueries({ queryKey: ["attachments", ownerType, ownerId] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha no upload");
    }
  }

  const liveAccounts = names.accounts.filter((a) => (!a.archivedAt || a.id === row.accountId) && a.type !== "brokerage");
  const counterpart = row.toAccountId ?? row.counterpartAccountId;

  return (
    <aside className="absolute top-0 right-0 bottom-0 z-30 flex w-[340px] flex-col gap-3.5 overflow-y-auto border-l border-stroke-1 bg-editor p-4 shadow-[-8px_0_24px_-12px_rgba(0,0,0,0.12)]">
      <div className="flex items-center gap-2">
        <span className="truncate text-[14px] font-semibold">{row.description}</span>
        <button type="button" className="ml-auto text-fg-3 hover:text-fg-strong" onClick={onClose}>✕</button>
      </div>
      <span className={cn("font-mono text-[22px] font-medium tabular-nums", row.neutral ? "text-fg-muted" : row.amountBase > 0 && "text-pos")}>
        {row.neutral ? `⇄ ${money(Math.abs(row.amountBase), names.currency)}` : money(row.amountBase, names.currency)}
      </span>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 text-[12.5px]">
        <Info k="Tipo" v={isTransfer ? "Transferência" : KIND_LABEL[row.kind]} />
        <Info k="Entidade" v={names.entity.get(row.entityId) ?? "—"} />
        {isTransfer ? <Info k="De → Para" v={`${names.account.get(row.accountId) ?? ""} → ${counterpart ? names.account.get(counterpart) ?? "" : "—"}`} /> : null}
        {row.currency !== names.currency ? <Info k="Moeda original" v={`${money(row.amount, row.currency)} · câmbio ${row.exchangeRate}`} /> : null}
        {row.effectiveDate !== row.date ? <Info k="Conta na fatura de" v={row.effectiveDate.split("-").reverse().join("/")} /> : null}
        {row.installmentNumber ? <Info k="Parcela" v={String(row.installmentNumber)} /> : null}
        {row.isRecurring ? <Info k="Recorrente" v="Sim" /> : null}
        {row.importId ? <Info k="Origem" v="Importação" /> : null}
      </div>
      <div className="flex flex-col gap-2.5 border-t border-stroke-3 pt-3">
        <Field label="Descrição"><TextInput value={description} onChange={setDescription} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={`Valor (${row.currency})`}><TextInput value={amount} onChange={setAmount} mono /></Field>
          <Field label="Data"><TextInput type="date" value={date} onChange={setDate} /></Field>
        </div>
        {!isTransfer ? (
          <>
            <Field label="Conta">
              <SelectInput value={accountId} onChange={setAccountId} options={liveAccounts.map((a) => ({ value: a.id, label: `${a.name} · ${names.entity.get(a.entityId) ?? ""}` }))} />
            </Field>
            <Field label="Categoria">
              <CategorySelect value={categoryId} onChange={setCategoryId} categories={names.categories} kind={row.kind === "income" ? "income" : row.kind === "investment" ? "investment" : "expense"} className="w-full" />
            </Field>
            <Check checked={deductible} onChange={setDeductible} label="Dedutível no IR" />
          </>
        ) : null}
        <Field label="Notas">
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} className="rounded-[6px] border border-stroke-1 px-2 py-1 text-[12.5px] outline-none focus:border-fg-muted" />
        </Field>
      </div>
      <div className="flex flex-col gap-1.5 border-t border-stroke-3 pt-3">
        <span className="text-[11px] text-fg-3">Anexos</span>
        {(attachments.data ?? []).map((a) => (
          <span key={a.id} className="flex items-center gap-2 text-[12.5px]">
            <a href={a.blobUrl} target="_blank" rel="noreferrer" className="truncate underline">{a.originalName}</a>
            <button type="button" className="ml-auto text-[11px] text-fg-3 hover:text-neg" onClick={() => void apiDelete(`/api/v2/attachments/${a.id}`).then(() => queryClient.invalidateQueries({ queryKey: ["attachments", ownerType, ownerId] }))}>remover</button>
          </span>
        ))}
        <label className="flex h-9 cursor-pointer items-center justify-center rounded-lg border border-dashed border-stroke-1 text-[12px] text-fg-3 hover:border-fg-3">
          Anexar comprovante
          <input type="file" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ""; }} />
        </label>
      </div>
      <div className="mt-auto flex flex-wrap gap-1.5 border-t border-stroke-3 pt-3">
        <Btn primary disabled={save.isPending} onClick={() => save.mutate()}>Salvar</Btn>
        {!isTransfer ? <Btn disabled={!categoryId || createRule.isPending} onClick={() => createRule.mutate()}>Criar regra de categoria</Btn> : null}
        <Btn ghost danger onClick={() => onDelete(row)}>Excluir</Btn>
      </div>
    </aside>
  );
}

function Info({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[11px] text-fg-3">{k}</span>
      <span className="truncate">{v}</span>
    </div>
  );
}
