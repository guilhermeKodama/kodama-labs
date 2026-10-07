"use client";

import { useRef, useState, type DragEvent } from "react";
import { useTranslations } from "next-intl";
import { Callout, Check, Field } from "@/components/cap";
import { AccountCombobox, EntitySelect } from "@/components/pickers";
import { useFmt } from "@/lib/format/provider";
import { fileBadge, fileSize } from "@/lib/import/files";
import { accountHint, accountTypesFor, isCardKind, statementMonthParts, type ImportAnalysis } from "@/lib/import/review";
import { cn } from "@/lib/utils";

const ACCEPT = ".ofx,.qfx,.csv,.txt,.pdf,image/*";

/**
 * Arquivo (mockup 5678-5713): the dashed dropzone with the file, what the
 * analysis read (Banco, Tipo, Período, Lançamentos), the account it goes
 * to with the entity, and for a card bill the statement it fills.
 */
export function FileStep({
  files,
  analysis,
  reading,
  viaAssistant,
  accountId,
  entityId,
  linkBill,
  onPick,
  onAccountChange,
  onEntityChange,
  onLinkBillChange,
}: {
  files: File[];
  analysis: ImportAnalysis | null;
  reading: boolean;
  viaAssistant: boolean;
  accountId: string | null;
  entityId: string | null;
  linkBill: boolean;
  onPick: (files: File[]) => void;
  onAccountChange: (accountId: string) => void;
  onEntityChange: (entityId: string) => void;
  onLinkBillChange: (link: boolean) => void;
}) {
  const t = useTranslations("import");
  const fmt = useFmt();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const choose = () => input.current?.click();
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length) onPick([...event.dataTransfer.files]);
  };

  const first = files[0];
  const size = fileSize(files.reduce((sum, file) => sum + file.size, 0));
  const sizeLabel = t(size.unit === "KB" ? "file.sizeKB" : "file.sizeMB", { size: fmt.number(size.value, { min: 0, max: 1 }) });
  const kind = analysis?.kind;
  const card = kind ? isCardKind(kind) : false;
  const hint = analysis && !viaAssistant ? accountHint(analysis.kind, analysis.accountMatch, accountId) : null;

  const statement = analysis?.card ?? null;
  const parts = statement ? statementMonthParts(statement.month) : null;
  const month = parts ? t("monthShort", { abbr: fmt.monthAbbr(parts.month), yy: parts.yy }) : "";

  return (
    <>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        onChange={(event) => {
          if (event.target.files?.length) onPick([...event.target.files]);
          event.target.value = "";
        }}
      />
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn("flex flex-col gap-2.5 rounded-[10px] border border-dashed p-3.5", dragging ? "border-fg-3 bg-fill-4" : "border-stroke-1")}
      >
        {first ? (
          <div className="flex items-center gap-2.5">
            <span className="rounded-[6px] bg-fill-2 px-2 py-1.5 font-mono text-[11px]">{fileBadge(first.name, first.type)}</span>
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-[13px] font-medium">{files.length > 1 ? t("file.many", { first: first.name, count: files.length - 1 }) : first.name}</span>
              <span className="text-[11.5px] text-fg-3">
                {sizeLabel} ·{" "}
                {reading ? (
                  t("file.reading")
                ) : (
                  <button type="button" onClick={choose} className="hover:text-fg-1 hover:underline">
                    {t("file.change")}
                  </button>
                )}
              </span>
            </div>
          </div>
        ) : (
          <span className="text-[13px]">
            {t("file.drop")}{" "}
            <button type="button" onClick={choose} className="font-medium underline">
              {t("file.choose")}
            </button>
          </span>
        )}
        <span className="text-[11.5px] text-fg-3">{t("file.help")}</span>
      </div>

      {viaAssistant ? <Callout tone="info">{t("file.assistantNote")}</Callout> : null}

      {analysis && kind && !viaAssistant ? (
        <>
          <div className="grid grid-cols-4 gap-2.5">
            {(
              [
                ["bank", analysis.bank ?? "—"],
                ["kind", t(`meta.kinds.${kind}`)],
                ["period", analysis.period ? t("meta.range", { from: fmt.date(analysis.period.from), to: fmt.date(analysis.period.to) }) : "—"],
                ["count", fmt.number(analysis.count, 0)],
              ] as const
            ).map(([key, value]) => (
              <div key={key} className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[11px] text-fg-3">{t(`meta.${key}`)}</span>
                <span className="truncate text-[12.5px]">{value}</span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label={t("fields.account")} hint={hint ? t(`fields.hints.${hint}`) : undefined}>
              <AccountCombobox
                value={accountId}
                onChange={onAccountChange}
                entityId={entityId}
                types={accountTypesFor(kind)}
                allowCreate
                invalid={!accountId}
                disabled={reading}
                aria-label={t("fields.account")}
                className="w-full"
              />
            </Field>
            <Field label={t("fields.entity")}>
              <EntitySelect value={entityId} onChange={onEntityChange} disabled={reading} aria-label={t("fields.entity")} className="w-full" />
            </Field>
          </div>
          {kind === "card_csv" ? <p className="text-[11.5px] text-fg-3">{t("file.ofxHint")}</p> : null}
          {card && statement && !statement.coversCycle && statement.existingCount > 0 ? (
            <p className="text-[11.5px] text-fg-3">{t("file.partial", { month })}</p>
          ) : null}
          {card && statement ? (
            <Check
              checked={linkBill}
              onChange={onLinkBillChange}
              label={statement.dueDate ? t("linkBill", { month, due: fmt.date(statement.dueDate) }) : t("linkBillNoDue", { month })}
            />
          ) : null}
        </>
      ) : null}
    </>
  );
}
