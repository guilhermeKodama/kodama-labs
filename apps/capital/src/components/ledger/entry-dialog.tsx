"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiPost } from "@/lib/api";
import { todayIso } from "@/lib/money";
import { useAccounts, useCategories } from "@/lib/catalog";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface QuickDraft {
  description: string;
  amount: number;
  date: string;
}

const KINDS = ["expense", "income", "transfer"] as const;

export function EntryDialog({
  open,
  onOpenChange,
  draft,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft?: QuickDraft | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open ? <EntryForm key={`${draft?.description ?? ""}-${draft?.amount ?? ""}-${draft?.date ?? ""}`} draft={draft} onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function EntryForm({ draft, onClose }: { draft?: QuickDraft | null; onClose: () => void }) {
  const t = useTranslations("app");
  const accounts = useAccounts();
  const categories = useCategories();
  const session = useSession();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<(typeof KINDS)[number]>("expense");
  const [description, setDescription] = useState(draft?.description ?? "");
  const [amount, setAmount] = useState(draft ? String(draft.amount) : "");
  const [date, setDate] = useState(draft?.date ?? todayIso());
  const [accountId, setAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [installments, setInstallments] = useState("");
  const [recurring, setRecurring] = useState(false);
  const [quick, setQuick] = useState("");
  const liveAccounts = (accounts.data ?? []).filter((account) => !account.archivedAt);
  const chosenAccount = accountId || liveAccounts[0]?.id || "";

  function applyQuick(value: string) {
    setQuick(value);
    const match = value.trim().match(/^(.*?)(-?\d+(?:[.,]\d{1,2})?)\s*$/);
    if (!match) return;
    setDescription(match[1].replace(/\b(hoje|ontem)\b/gi, "").trim());
    setAmount(match[2].replace(",", "."));
  }

  const save = useMutation({
    mutationFn: async () => {
      const value = Number(amount);
      if (recurring) {
        return apiPost("/api/v2/recurring", {
          kind: kind === "transfer" ? "transfer" : kind,
          accountId: chosenAccount,
          toAccountId: kind === "transfer" ? toAccountId : undefined,
          amount: Math.abs(value),
          description,
          categoryId: categoryId || null,
          frequency: "monthly",
          startDate: date,
        });
      }
      if (kind === "transfer") {
        return apiPost("/api/v2/ledger/entries", {
          kind: "transfer",
          fromAccountId: chosenAccount,
          toAccountId,
          amount: Math.abs(value),
          description,
          date,
        });
      }
      return apiPost("/api/v2/ledger/entries", {
        kind,
        accountId: chosenAccount,
        amount: Math.abs(value),
        description,
        date,
        categoryId: categoryId || null,
        installments: installments ? Number(installments) : undefined,
      });
    },
    onSuccess: async () => {
      toast.success(t("saved"));
      await queryClient.invalidateQueries({ queryKey: ["ledger"] });
      onClose();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const cats = (categories.data ?? []).filter((category) => !category.isArchived && (kind === "income" ? category.type === "income" : category.type !== "income"));

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("newEntry")}</DialogTitle>
      </DialogHeader>
      <Input value={quick} onChange={(event) => applyQuick(event.target.value)} placeholder={t("quickPlaceholder")} />
      <div className="grid grid-cols-3 gap-2">
        {KINDS.map((item) => (
          <Button key={item} type="button" variant={kind === item ? "default" : "outline"} onClick={() => setKind(item)}>
            {t(item)}
          </Button>
        ))}
      </div>
      <Label>{t("description")}</Label>
      <Input value={description} onChange={(event) => setDescription(event.target.value)} />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>{t("amount")}</Label>
          <Input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
        </div>
        <div>
          <Label>{t("date")}</Label>
          <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </div>
      </div>
      <Label>{kind === "transfer" ? t("fromAccount") : t("account")}</Label>
      <AccountSelect accounts={liveAccounts} entities={session.data?.entities ?? []} value={chosenAccount} onChange={setAccountId} />
      {kind === "transfer" ? (
        <>
          <Label>{t("toAccount")}</Label>
          <AccountSelect accounts={liveAccounts} entities={session.data?.entities ?? []} value={toAccountId} onChange={setToAccountId} />
        </>
      ) : (
        <>
          <Label>{t("category")}</Label>
          <Select value={categoryId || "none"} onValueChange={(value) => setCategoryId(value === "none" ? "" : value)}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("none")}</SelectItem>
              {cats.map((category) => (
                <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {kind === "expense" ? (
            <div>
              <Label>{t("installments")}</Label>
              <Input value={installments} onChange={(event) => setInstallments(event.target.value)} placeholder="2–72" />
            </div>
          ) : null}
        </>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={recurring} onChange={(event) => setRecurring(event.target.checked)} />
        {t("recurringMonthly")}
      </label>
      <Button disabled={save.isPending || !description || !amount || !chosenAccount} onClick={() => save.mutate()}>
        {t("save")}
      </Button>
    </>
  );
}
function AccountSelect({
  accounts,
  entities,
  value,
  onChange,
}: {
  accounts: { id: string; name: string; entityId: string }[];
  entities: { id: string; name: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  const name = new Map(entities.map((entity) => [entity.id, entity.name]));
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        {accounts.map((account) => (
          <SelectItem key={account.id} value={account.id}>
            {name.get(account.entityId) ?? ""} · {account.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
