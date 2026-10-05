import type { DbClient } from "@capital/server/lib/prisma";
import { formatDateOnly } from "@capital/server/lib/date-utils";
import { fetchReconciliationContext } from "@capital/server/modules/assistant/data/queries/fetch-reconciliation-context";
import { LedgerError } from "@capital/server/modules/ledger/lib/errors";
import { parseOfxContent } from "./parsers";
import { classifyTransactions, detectReconciliation, normalizeTransactions } from "./reconciliation";

/**
 * Parse OFX files (merged, deduplicated by FITID) and compare them with the
 * ledger: each row comes back new / duplicate / changed / fuzzy_match with
 * classification candidates. Nothing is written; the reviewed result
 * becomes an ImportPlanPayload for executeImport.
 */
export async function analyzeStatement(userId: string, files: { content: string }[], db: DbClient) {
  let bankName = "";
  let accountId = "";
  let currency = "BRL";
  let latestBalanceDate = new Date(0);
  let ledgerBalance = 0;
  const seen = new Set<string>();
  const raw: { fitId: string; date: Date; amount: number; memo: string; trnType: string }[] = [];

  for (const file of files) {
    let parsed: ReturnType<typeof parseOfxContent>;
    try {
      parsed = parseOfxContent(file.content);
    } catch (err) {
      throw new LedgerError(err instanceof Error ? err.message : "Invalid OFX file", 400);
    }
    bankName ||= parsed.bankName;
    accountId ||= parsed.account.accountId;
    if (parsed.currency) currency = parsed.currency;
    if (parsed.balanceDate > latestBalanceDate) {
      latestBalanceDate = parsed.balanceDate;
      ledgerBalance = parsed.ledgerBalance;
    }
    for (const t of parsed.transactions) {
      if (seen.has(t.fitId)) continue;
      seen.add(t.fitId);
      raw.push(t);
    }
  }

  const normalized = normalizeTransactions(raw);
  const context = await fetchReconciliationContext(userId, db);
  const reconciled = detectReconciliation(normalized, context.existingTransactions, context.knownTransferFitIds);
  // No importedEntityType: the entity is picked after analysis, so the
  // suggested direction is only a starting point re-derived from suggestedFlow.
  const classified = classifyTransactions(
    reconciled.filter((t) => t.status !== "duplicate"),
    context.entities,
    context.investmentAccounts,
    { bankName }
  );
  const byFitId = new Map(classified.map((c) => [c.fitId, c]));

  const transactions = reconciled.map((t) => {
    const c = byFitId.get(t.fitId);
    return {
      fitId: t.fitId,
      date: formatDateOnly(t.date),
      description: t.description,
      fullDescription: t.fullDescription,
      amount: t.amount,
      type: t.type,
      reconciliationStatus: t.status,
      existingTransactionId: t.existingTransactionId,
      diffs: t.diffs,
      fuzzyMatchedTransaction: t.fuzzyMatchedTransaction,
      candidates: c?.candidates ?? [{ type: "regular_transaction" as const, confidence: "high" as const }],
      resolvedClassification: c?.resolvedClassification,
      needsResolution: c?.needsResolution ?? false,
      isDuplicate: t.status === "duplicate",
    };
  });

  const summary = { totalIncome: 0, totalExpenses: 0, newCount: 0, duplicateCount: 0, changedCount: 0, fuzzyMatchCount: 0, needsResolutionCount: 0 };
  for (const t of transactions) {
    if (t.reconciliationStatus === "duplicate") summary.duplicateCount++;
    else if (t.reconciliationStatus === "changed") summary.changedCount++;
    else if (t.reconciliationStatus === "fuzzy_match") summary.fuzzyMatchCount++;
    else {
      summary.newCount++;
      if (t.type === "income") summary.totalIncome += t.amount;
      else summary.totalExpenses += t.amount;
    }
    if (t.needsResolution) summary.needsResolutionCount++;
  }
  summary.totalIncome = Math.round(summary.totalIncome * 100) / 100;
  summary.totalExpenses = Math.round(summary.totalExpenses * 100) / 100;

  return { bankName, accountId, currency, ledgerBalance: Math.round(ledgerBalance * 100) / 100, transactions, summary };
}
