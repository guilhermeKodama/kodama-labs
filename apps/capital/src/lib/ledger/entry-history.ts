import type { HistoryEvent, HistoryField } from "@capital/server/modules/ledger/services/history";

/**
 * The "Histórico" of the edit sheet (mockup 5106-5113): each event of
 * GET /v2/ledger/entries/{id}/history becomes one line, e.g.
 * "Importada do OFX Nubank · 23/09 09:12", "Categoria definida pela regra
 * “ifood” · 23/09", "Valor editado por você · agora". This module picks
 * the message and its values; the sheet translates and formats them.
 */

/** Who made a change, from the batch source. */
export type HistoryActor = "user" | "import" | "assistant" | "mcp" | "system";

/** How the line's time is written: date and time, date only, or relative ("agora", "ontem"). */
export type HistoryTimeStyle = "dateTime" | "date" | "relative";

export type HistoryLine =
  | { key: "imported"; label: string; at: string; time: HistoryTimeStyle }
  | { key: "fromRecurrence"; description: string; at: string; time: HistoryTimeStyle }
  | { key: "installment"; n: number; total: number; at: string; time: HistoryTimeStyle }
  | { key: "duplicated"; at: string; time: HistoryTimeStyle }
  | { key: "created"; actor: HistoryActor; at: string; time: HistoryTimeStyle }
  | { key: "categorizedByRule"; pattern: string; at: string | null; time: HistoryTimeStyle }
  | { key: "categorizedAuto"; at: string | null; time: HistoryTimeStyle }
  | { key: "updated"; fields: HistoryField[]; actor: HistoryActor; at: string; time: HistoryTimeStyle }
  | { key: "deleted" | "restored"; actor: HistoryActor; at: string; time: HistoryTimeStyle };

const ACTORS: readonly HistoryActor[] = ["user", "import", "assistant", "mcp", "system"];
const actorOf = (source: string | null): HistoryActor => (ACTORS as readonly string[]).includes(source ?? "") ? (source as HistoryActor) : "user";

/** Fields a line names, in the order people read them; base amounts follow from these and are not repeated. */
const FIELD_ORDER: readonly HistoryField[] = [
  "amount",
  "description",
  "date",
  "kind",
  "categoryId",
  "accountId",
  "counterpartAccountId",
  "entityId",
  "direction",
  "currency",
  "exchangeRate",
  "isTaxDeductible",
  "notes",
];

export function historyLines(events: readonly HistoryEvent[]): HistoryLine[] {
  const lines: HistoryLine[] = [];
  for (const event of events) {
    switch (event.type) {
      case "created": {
        if (event.import) {
          const label = [event.import.fileType, event.import.bankName ?? event.import.fileName].filter(Boolean).join(" ");
          lines.push({ key: "imported", label, at: event.at, time: "dateTime" });
        } else if (event.recurringRule) {
          lines.push({ key: "fromRecurrence", description: event.recurringRule.description, at: event.at, time: "dateTime" });
        } else if (event.installment) {
          lines.push({ key: "installment", n: event.installment.n, total: event.installment.total, at: event.at, time: "dateTime" });
        } else if (event.duplicatedFrom) {
          lines.push({ key: "duplicated", at: event.at, time: "dateTime" });
        } else {
          lines.push({ key: "created", actor: actorOf(event.source), at: event.at, time: "dateTime" });
        }
        break;
      }
      case "categorized":
        lines.push(
          event.by === "rule" && event.rule
            ? { key: "categorizedByRule", pattern: event.rule.pattern, at: event.at, time: "date" }
            : { key: "categorizedAuto", at: event.at, time: "date" },
        );
        break;
      case "updated": {
        const fields = FIELD_ORDER.filter((field) => event.changes.some((change) => change.field === field));
        if (fields.length) lines.push({ key: "updated", fields, actor: actorOf(event.source), at: event.at, time: "relative" });
        break;
      }
      case "deleted":
      case "restored":
        lines.push({ key: event.type, actor: actorOf(event.source), at: event.at, time: "relative" });
        break;
    }
  }
  return lines;
}

/** pt-BR nouns that take the feminine ("Categoria editada"); the messages pick the participle by this. */
const FEMININE: ReadonlySet<HistoryField> = new Set(["description", "date", "categoryId", "accountId", "counterpartAccountId", "entityId", "currency"]);

/** Grammatical gender of a field's noun: feminine, feminine plural ("Notas editadas") or masculine. */
export function fieldGender(field: HistoryField): "f" | "fp" | "m" {
  if (field === "notes") return "fp";
  return FEMININE.has(field) ? "f" : "m";
}
