"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Btn, Choice, Dialog, DialogFooter, DialogHead, Field, TextInput } from "@/components/cap";
import { apiPut } from "@/lib/api/client";
import { useAppMutation } from "@/lib/api/use-app-mutation";
import { useFmt } from "@/lib/format/provider";
import type { MilestoneDef } from "@/lib/fire";
import { useShortcut } from "@/lib/shortcuts/provider";

/** The milestones a person adds by hand: an amount, a monthly income, or a multiple of a year of expenses. */
const MILESTONE_KINDS = ["net_worth_absolute", "passive_income_absolute", "net_worth_x_expenses"] as const;
type Kind = (typeof MILESTONE_KINDS)[number];

/**
 * "+ Marco": name, kind and value of a new milestone, appended to the
 * plan's. PUT /v1/fire/goal takes only `milestones` and keeps every other
 * field; the write is undoable.
 */
export function MilestoneDialog({ milestones, currency, onClose }: { milestones: MilestoneDef[]; currency: string; onClose: () => void }) {
  const t = useTranslations("invest.rings.milestoneDialog");
  const tc = useTranslations("common");
  const fmt = useFmt();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Kind>("net_worth_absolute");
  const [value, setValue] = useState("");
  const amount = fmt.parseNumber(value);
  const valid = name.trim().length > 0 && amount > 0;
  const save = useAppMutation({
    event: "investments.write",
    mutationFn: () => apiPut("/api/v1/fire/goal", { milestones: [...milestones, { id: crypto.randomUUID(), name: name.trim(), type: kind, value: amount }] }),
    undo: t("saved", { name: name.trim() }),
    onSuccess: onClose,
  });
  const submit = () => {
    if (valid && !save.isPending) save.mutate();
  };
  useShortcut("mod+enter", submit, { allowInInputs: true });
  const symbol = fmt.currencySymbol(currency);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} width={460}>
      <form
        className="flex flex-col gap-3.5"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <DialogHead title={t("title")} desc={t("desc")} />
        <Field label={t("name")} htmlFor="milestone-name">
          <TextInput id="milestone-name" value={name} onChange={setName} placeholder={t("namePlaceholder")} autoFocus />
        </Field>
        <Field label={t("type")}>
          <Choice
            aria-label={t("type")}
            value={kind}
            onChange={setKind}
            options={MILESTONE_KINDS.map((v) => ({ v, l: t(`types.${v}`), d: t(`valueHint.${v}`, { currency: symbol }) }))}
          />
        </Field>
        <Field label={t("value")} htmlFor="milestone-value">
          <TextInput id="milestone-value" value={value} onChange={setValue} mono inputMode="decimal" />
        </Field>
        <DialogFooter>
          <Btn ghost onClick={onClose}>
            {tc("cancel")}
          </Btn>
          <Btn primary type="submit" disabled={!valid || save.isPending}>
            {t("save")}
          </Btn>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
