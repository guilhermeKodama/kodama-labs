"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { LedgerRow } from "@capital/server/modules/ledger/contracts";
import type { DeleteOptions } from "@capital/server/modules/ledger/services/scope-delete";
import { Btn, Callout, Check, Choice, Dialog, DialogFooter, DialogHead, type ChoiceOption } from "@/components/cap";
import { apiGet, apiPost } from "@/lib/api/client";
import { useNames } from "@/lib/api/catalog";
import { keys } from "@/lib/api/keys";
import { useAppMutation } from "@/lib/api/use-app-mutation";
import { useFmt } from "@/lib/format/provider";
import { deletedToast, scopesOf, yearSpan, type DeleteScope } from "@/lib/ledger/delete-scope";

export interface DeleteScopeDialogProps {
  /** The entry to delete; the dialog is open while this is set. */
  entryId: string | null;
  /** Its description, for the title ("Excluir “Aluguel”"). */
  description?: string;
  onOpenChange: (open: boolean) => void;
  /** After the delete; `batchId` is already on the undo stack with its toast. */
  onDeleted?: (batchId: string | null) => void;
}

/**
 * Asks how much of a repeating entry to delete (mockup DeleteFlow
 * 5350-5396, 480px): GET /v2/ledger/entries/{id}/delete-options says
 * whether it is a recurring occurrence, an installment or linked to an
 * investment operation, and how many rows and how much money each scope
 * takes; Excluir sends POST /v2/ledger/entries/{id}/delete {scope,
 * withLinkedOperation} as one undoable batch. An entry the server calls
 * simple is deleted at once, without the question.
 */
export function DeleteScopeDialog({ entryId, description, onOpenChange, onDeleted }: DeleteScopeDialogProps) {
  if (!entryId) return null;
  return <ScopeQuestion key={entryId} entryId={entryId} description={description} onOpenChange={onOpenChange} onDeleted={onDeleted} />;
}

interface DeleteResult {
  batchId: string | null;
}

function ScopeQuestion({ entryId, description, onOpenChange, onDeleted }: DeleteScopeDialogProps & { entryId: string }) {
  const t = useTranslations("entry.delete");
  const tToast = useTranslations("entry.toast");
  const fmt = useFmt();
  const names = useNames();
  const [scope, setScope] = useState<DeleteScope>("one");
  const [withLinked, setWithLinked] = useState(true);
  const options = useQuery({
    queryKey: keys.deleteOptions(entryId),
    queryFn: () => apiGet<DeleteOptions>(`/api/v2/ledger/entries/${encodeURIComponent(entryId)}/delete-options`),
    staleTime: 0,
  });
  const entry = useQuery({
    queryKey: keys.entry(entryId),
    queryFn: () => apiGet<LedgerRow>(`/api/v2/ledger/entries/${encodeURIComponent(entryId)}`),
  });
  const data = options.data;
  const title = description ?? data?.description ?? "";

  const remove = useAppMutation<DeleteResult, { scope: DeleteScope; withLinkedOperation: boolean }>({
    event: ["ledger.write", "investments.write", "recurring.write"],
    mutationFn: (body) => apiPost(`/api/v2/ledger/entries/${encodeURIComponent(entryId)}/delete`, body),
    undo: (_result, body) => {
      const which = deletedToast({ kind: data?.kind ?? "simple" }, body.scope, body.withLinkedOperation);
      if (which.key === "linked") return tToast("deletedLinked", { description: title });
      if (which.key === "scoped") return tToast("deletedScoped", { description: title, scope: body.scope });
      return tToast("deleted", { description: title });
    },
    onSuccess: (result) => {
      onDeleted?.(result.batchId);
      onOpenChange(false);
    },
    onError: () => {
      onOpenChange(false);
    },
  });

  // Nothing to ask (a plain row the table could not tell apart): delete it now.
  const started = useRef(false);
  const simple = data?.kind === "simple";
  useEffect(() => {
    if (!simple || started.current) return;
    started.current = true;
    remove.mutate({ scope: "one", withLinkedOperation: false });
  }, [simple, remove]);

  if (simple) return null;

  const base = names.currency;
  const money = (value: number) => fmt.money(value, base);
  const row = entry.data;
  const entityOf = (accountId: string | null) => names.entities.find((entity) => entity.id === names.accounts.find((account) => account.id === accountId)?.entityId)?.id;
  const entities = (() => {
    if (!row) return "";
    if (!row.transferGroupId) return names.entity.get(row.entityId) ?? "";
    const other = entityOf(row.counterpartAccountId);
    const [from, to] = row.amount < 0 ? [row.entityId, other] : [other, row.entityId];
    return from && to && from !== to ? `${names.entity.get(from) ?? ""} → ${names.entity.get(to) ?? ""}` : (names.entity.get(row.entityId) ?? "");
  })();

  const choices: ChoiceOption<DeleteScope>[] = [];
  if (data && (data.kind === "recurring" || data.kind === "installment")) {
    const { one, future, all } = data.scopes;
    const n = data.occurrence?.n ?? 1;
    const total = data.occurrence?.total ?? all?.count ?? 1;
    for (const option of scopesOf(data)) {
      if (data.kind === "recurring") {
        if (option === "one") choices.push({ v: "one", l: t("recurring.one"), d: t("recurring.oneDesc", { date: fmt.dateFull(data.date), amount: money(one.sum) }) });
        if (option === "future") choices.push({ v: "future", l: t("recurring.future"), d: t("recurring.futureDesc") });
        if (option === "all" && all) {
          const years = yearSpan(all.from, all.to);
          choices.push({
            v: "all",
            l: t("recurring.all"),
            d:
              years && years.from !== years.to
                ? t("recurring.allDescRange", { count: all.count, from: years.from, to: years.to, sum: money(all.sum) })
                : t("recurring.allDesc", { count: all.count, year: years?.from ?? "", sum: money(all.sum) }),
          });
        }
      } else {
        if (option === "one") choices.push({ v: "one", l: t("installment.one", { n, total }), d: money(one.sum) });
        if (option === "future" && future) choices.push({ v: "future", l: t("installment.future", { n, total }), d: t("installment.futureDesc", { count: future.count, sum: money(future.sum) }) });
        if (option === "all" && all) choices.push({ v: "all", l: t("installment.all", { total: data.installmentPlan?.totalInstallments ?? total }), d: t("installment.allDesc", { sum: money(all.sum) }) });
      }
    }
  }

  const linked = data?.kind === "linked" ? data.linkedOperation : null;
  const amount = data ? data.scopes.one.sum : 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onOpenChange(false)} width={480}>
      <DialogHead
        title={t("title", { description: title })}
        desc={data ? t("desc", { amount: money(amount), entity: entities, date: fmt.dateFull(data.date) }) : t("loading")}
      />
      {linked ? (
        <>
          <p className="text-[12.5px] text-fg-2">
            {t(linked.via === "funding" ? "linked.funding" : "linked.cash", {
              type: linked.type === "buy" || linked.type === "sell" ? linked.type : "other",
              quantity: fmt.number(linked.quantity ?? 0, { min: 0, max: 8 }),
              asset: linked.ticker ?? linked.name,
              broker: linked.brokerAccountName,
              date: fmt.date(linked.date),
            })}
          </p>
          <Check checked={withLinked} onChange={setWithLinked} label={t("linked.also")} />
          {!withLinked ? (
            <Callout tone="warning">
              {t(linked.via === "funding" ? "linked.warnFunding" : "linked.warnCash", { broker: linked.brokerAccountName, amount: money(Math.abs(amount)) })}
            </Callout>
          ) : null}
        </>
      ) : choices.length ? (
        <Choice options={choices} value={scope} onChange={setScope} aria-label={t("title", { description: title })} />
      ) : null}
      <DialogFooter>
        <Btn ghost onClick={() => onOpenChange(false)}>
          {t("cancel")}
        </Btn>
        <Btn primary disabled={!data || remove.isPending} onClick={() => remove.mutate({ scope, withLinkedOperation: withLinked })}>
          {t("confirm")}
        </Btn>
      </DialogFooter>
    </Dialog>
  );
}
