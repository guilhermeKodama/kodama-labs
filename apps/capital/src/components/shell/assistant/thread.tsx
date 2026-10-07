"use client";

import { useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTranslations } from "next-intl";
import { Badge, Btn } from "@/components/cap";
import { Link } from "@/i18n/navigation";
import { undoBatch } from "@/lib/api/undo";
import { allPairsDecided, DUPLICATE_DECISIONS, importRowsHref, planResultView, planSummaryView, type DuplicateDecision } from "@/lib/assistant/cards";
import { toolLabelKey } from "@/lib/assistant/tools";
import { useFmt } from "@/lib/format/provider";
import { cn } from "@/lib/utils";
import type { ChatMessage, DuplicateReviewCard, ImportPlan, MessageAttachment, MessageBlock, PlanStatus } from "@/types/assistant";
import type { AssistantController } from "./use-assistant";

/** The messages of the open conversation: user bubbles on the right, the assistant's blocks in reading order. */
export function Thread({ controller, onNavigate }: { controller: AssistantController; onNavigate: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      {controller.state.messages.map((message) => (
        <Message key={message.id} message={message} controller={controller} onNavigate={onNavigate} />
      ))}
    </div>
  );
}

function Message({ message, controller, onNavigate }: { message: ChatMessage; controller: AssistantController; onNavigate: () => void }) {
  if (message.role === "user") {
    return (
      <div className={cn("flex flex-col items-end gap-1", message.status === "sending" && "opacity-60")}>
        {message.blocks.map((block, index) => (
          <UserBlock key={index} block={block} />
        ))}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      {message.blocks.map((block, index) => (
        <AssistantBlock key={index} block={block} controller={controller} onNavigate={onNavigate} />
      ))}
    </div>
  );
}

function UserBlock({ block }: { block: MessageBlock }) {
  if (block.kind === "attachments") return <Attachments files={block.files} />;
  if (block.kind === "text" || block.kind === "card_response") {
    return <div className="max-w-[85%] rounded-[8px] bg-fill-3 px-2.5 py-1.5 text-body whitespace-pre-wrap text-fg-1">{block.text}</div>;
  }
  return null;
}

function Attachments({ files }: { files: MessageAttachment[] }) {
  return (
    <div className="flex max-w-[85%] flex-wrap justify-end gap-1">
      {files.map((file) => (
        <Badge key={file.fileId} mono>
          {file.originalName}
        </Badge>
      ))}
    </div>
  );
}

function AssistantBlock({ block, controller, onNavigate }: { block: MessageBlock; controller: AssistantController; onNavigate: () => void }) {
  switch (block.kind) {
    case "text":
      return <Markdown text={block.text} />;
    case "tool":
      return <ToolLine tool={block.tool} label={block.label} status={block.status} />;
    case "plan":
      return <PlanCard block={block} controller={controller} />;
    case "plan_result":
      return <ResultCard result={block.result} onNavigate={onNavigate} />;
    case "card":
      return <DuplicateCard card={block.card} controller={controller} />;
    case "attachments":
      return <Attachments files={block.files} />;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

const MARKDOWN: Components = {
  p: ({ children }) => <p className="leading-[1.55]">{children}</p>,
  ul: ({ children }) => <ul className="flex list-disc flex-col gap-0.5 pl-4">{children}</ul>,
  ol: ({ children }) => <ol className="flex list-decimal flex-col gap-0.5 pl-4">{children}</ol>,
  li: ({ children }) => <li className="leading-[1.5]">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2">
      {children}
    </a>
  ),
  code: ({ children }) => <code className="rounded-[4px] bg-fill-3 px-1 font-mono text-label">{children}</code>,
  pre: ({ children }) => <pre className="overflow-x-auto rounded-[6px] bg-fill-4 p-2 font-mono text-label">{children}</pre>,
  h1: ({ children }) => <p className="text-body-lg font-semibold">{children}</p>,
  h2: ({ children }) => <p className="text-body-lg font-semibold">{children}</p>,
  h3: ({ children }) => <p className="font-semibold">{children}</p>,
  blockquote: ({ children }) => <blockquote className="border-l-2 border-stroke-2 pl-2 text-fg-2">{children}</blockquote>,
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-body-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b border-stroke-2 px-1.5 py-1 text-left font-medium text-fg-3">{children}</th>,
  td: ({ children }) => <td className="border-b border-stroke-3 px-1.5 py-1 tabular-nums">{children}</td>,
  hr: () => <hr className="border-stroke-3" />,
};

function Markdown({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-2 text-body text-fg-1">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tool status line
// ---------------------------------------------------------------------------

function ToolLine({ tool, label, status }: { tool: string; label?: string; status: "running" | "success" | "error" }) {
  const t = useTranslations("assistant");
  const key = toolLabelKey(tool);
  const text = key ? t(`tools.${key}`) : (label ?? tool);
  return (
    <div className="flex items-center gap-1.5 text-label text-fg-3" aria-live="polite">
      <span aria-hidden className={cn("w-3 shrink-0 text-center", status === "error" && "text-neg", status === "running" && "animate-pulse")}>
        {status === "running" ? "·" : status === "success" ? "✓" : "✕"}
      </span>
      <span className="truncate">
        {text}
        {status === "running" ? "…" : ""}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

function CardBox({ title, aside, children }: { title: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-[8px] border border-stroke-2 p-2.5 text-body-sm">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-body font-semibold">{title}</span>
        {aside}
      </div>
      {children}
    </div>
  );
}

function Counts({ items }: { items: string[] }) {
  return <div className="text-fg-2">{items.join(" · ")}</div>;
}

type PlanBlock = Extract<MessageBlock, { kind: "plan" }>;

function PlanCard({ block, controller }: { block: PlanBlock; controller: AssistantController }) {
  const t = useTranslations("assistant");
  const fmt = useFmt();
  const [pending, setPending] = useState<"confirm" | "reject" | null>(null);
  const view = planSummaryView(block.planKind, block.summary as ImportPlan["summary"]);
  const open = block.status === "proposed";
  const act = async (which: "confirm" | "reject") => {
    setPending(which);
    try {
      if (which === "confirm") await controller.confirmPlan(block.planId, block.payloadHash);
      else await controller.rejectPlan(block.planId);
    } finally {
      setPending(null);
    }
  };
  return (
    <CardBox title={t(`plan.title.${block.planKind}`)} aside={open ? null : <PlanStatusBadge status={block.status} />}>
      <Counts items={view.counts.map((item) => t(`plan.counts.${item.key}`, { count: item.count }))} />
      {view.money.length ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {view.money.map((item) => (
            <span key={item.key} className="flex items-baseline gap-1.5">
              <span className="text-fg-3">{t(`plan.money.${item.key}`)}</span>
              <span className="font-mono tabular-nums">{fmt.money(item.amount, view.currency)}</span>
            </span>
          ))}
        </div>
      ) : null}
      {view.balanceMatches ? <div className="text-pos-ink">✓ {t("plan.balanceMatches")}</div> : null}
      {block.warnings.length ? (
        <ul className="flex list-disc flex-col gap-0.5 pl-4 text-warn-ink">
          {block.warnings.map((warning, index) => (
            <li key={index}>{warning}</li>
          ))}
        </ul>
      ) : null}
      {open ? (
        <div className="flex justify-end gap-1.5">
          <Btn ghost disabled={pending !== null || controller.busy} onClick={() => void act("reject")}>
            {t("plan.reject")}
          </Btn>
          <Btn primary disabled={pending !== null || controller.busy} onClick={() => void act("confirm")}>
            {t(`plan.confirm.${block.planKind}`)}
          </Btn>
        </div>
      ) : null}
    </CardBox>
  );
}

function PlanStatusBadge({ status }: { status: PlanStatus }) {
  const t = useTranslations("assistant");
  return <Badge tone={status === "rejected" ? "neg" : undefined}>{t(`plan.status.${status}`)}</Badge>;
}

function ResultCard({ result, onNavigate }: { result: Record<string, unknown>; onNavigate: () => void }) {
  const t = useTranslations("assistant");
  const view = planResultView(result);
  const [undo, setUndo] = useState<"idle" | "pending" | "done">("idle");
  const runUndo = async () => {
    if (!view.batchId) return;
    setUndo("pending");
    setUndo((await undoBatch(view.batchId, { announce: true })) ? "done" : "idle");
  };
  return (
    <CardBox title={t(`result.title.${view.kind}`)} aside={undo === "done" ? <Badge>{t("result.undone")}</Badge> : null}>
      <Counts items={view.counts.map((item) => t(`result.counts.${item.key}`, { count: item.count }))} />
      {view.importId || (view.batchId && undo !== "done") ? (
        <div className="flex justify-end gap-1.5">
          {view.batchId && undo !== "done" ? (
            <Btn ghost disabled={undo === "pending"} onClick={() => void runUndo()}>
              {t("result.undo")}
            </Btn>
          ) : null}
          {view.importId && undo !== "done" ? (
            <BtnLink href={importRowsHref(view.importId)} onNavigate={onNavigate}>
              {t("result.open")}
            </BtnLink>
          ) : null}
        </div>
      ) : null}
    </CardBox>
  );
}

function DuplicateCard({ card, controller }: { card: DuplicateReviewCard; controller: AssistantController }) {
  const t = useTranslations("assistant");
  const fmt = useFmt();
  const answered = card.status === "answered";
  const [decisions, setDecisions] = useState<Partial<Record<string, DuplicateDecision>>>(card.decisions ?? {});
  const pairIds = card.pairs.map((pair) => pair.pairId);
  const ready = allPairsDecided(pairIds, decisions);
  return (
    <CardBox title={t("card.title")} aside={answered ? <Badge>{t("card.answered")}</Badge> : null}>
      <span className="text-fg-3">{t("card.description", { count: card.pairs.length })}</span>
      <div className="flex flex-col gap-2">
        {card.pairs.map((pair) => {
          const chosen = answered ? card.decisions?.[pair.pairId] : decisions[pair.pairId];
          return (
            <div key={pair.pairId} className="flex flex-col gap-1.5 rounded-[6px] bg-fill-4 p-2">
              <div className="grid grid-cols-[auto_1fr_auto_auto] items-baseline gap-x-2 gap-y-0.5">
                <PairRow label={t("card.fromStatement")} date={fmt.date(pair.incoming.date)} description={pair.incoming.description} amount={fmt.money(pair.incoming.type === "expense" ? -Math.abs(pair.incoming.amount) : Math.abs(pair.incoming.amount))} />
                <PairRow label={t("card.existing")} date={fmt.date(pair.existing.date)} description={pair.existing.description} amount={fmt.money(pair.existing.type === "expense" ? -Math.abs(pair.existing.amount) : Math.abs(pair.existing.amount))} />
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-auto text-caption text-fg-3">
                  {t(`card.confidence.${pair.confidence}`)}
                  {pair.reason ? ` · ${pair.reason}` : ""}
                </span>
                {DUPLICATE_DECISIONS.map((decision) => (
                  <button
                    key={decision}
                    type="button"
                    disabled={answered || controller.busy}
                    aria-pressed={chosen === decision}
                    onClick={() => setDecisions((current) => ({ ...current, [pair.pairId]: decision }))}
                    className={cn(
                      "h-[22px] rounded-[5px] border px-2 text-label outline-none focus-visible:ring-2 focus-visible:ring-fg-3/40 disabled:cursor-not-allowed",
                      chosen === decision ? "border-fg-1 bg-fg-1 text-editor" : "border-stroke-1 text-fg-1 hover:bg-fill-3 disabled:opacity-50",
                    )}
                  >
                    {t(`card.decisions.${decision}`)}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {answered ? null : (
        <div className="flex justify-end">
          <Btn
            primary
            disabled={!ready || controller.busy}
            onClick={() => controller.answerCard(card.cardId, decisions as Record<string, DuplicateDecision>)}
          >
            {t("card.submit")}
          </Btn>
        </div>
      )}
    </CardBox>
  );
}

function PairRow({ label, date, description, amount }: { label: string; date: string; description: string; amount: string }) {
  return (
    <>
      <span className="text-caption text-fg-3">{label}</span>
      <span className="truncate">{description}</span>
      <span className="font-mono text-label text-fg-3 tabular-nums">{date}</span>
      <span className="text-right font-mono tabular-nums">{amount}</span>
    </>
  );
}

/** Btn look on a Link (closes the palette as it navigates). */
function BtnLink({ href, onNavigate, children }: { href: string; onNavigate: () => void; children: ReactNode }) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className="inline-flex h-(--cap-control-h) shrink-0 items-center justify-center rounded-[6px] border border-stroke-1 px-2.5 text-button font-medium whitespace-nowrap text-fg-1 outline-none hover:bg-fill-4 focus-visible:ring-2 focus-visible:ring-fg-3/40"
    >
      {children}
    </Link>
  );
}
