import type { AnyAgentToolDef } from "./registry";
import { getContextSnapshot } from "./read/get-context-snapshot";
import { listStatementFiles } from "./read/list-statement-files";
import { getParsedRows } from "./read/get-parsed-rows";
import { reconcileStatement } from "./read/reconcile-statement";
import { searchTransactions } from "./read/search-transactions";
import { searchTransfers } from "./read/search-transfers";
import { queryInvestmentHoldings } from "./read/query-investment-holdings";
import { listImportBatches } from "./read/list-import-batches";
import { listCreditCardBills } from "./read/list-credit-card-bills";
import { searchBillTransactions } from "./read/search-bill-transactions";
import { proposeImportPlan } from "./write/propose-import-plan";
import { updateImportPlan } from "./write/update-import-plan";
import { proposeRevertPlan } from "./write/propose-revert-plan";
import { commitPlan } from "./write/commit-plan";
import { recordMerchantCategory } from "./write/record-merchant-category";
import { updateTransactions } from "./write/update-transactions";
import { manageInvestmentAccount } from "./write/manage-investment-account";
import { manageInvestmentHolding } from "./write/manage-investment-holding";
import { recordInvestmentTransaction } from "./write/record-investment-transaction";
import { fundInvestmentAccountTool } from "./write/fund-investment-account";
import { manageCreditCard } from "./write/manage-credit-card";
import { updateBillTransactions } from "./write/update-bill-transactions";
import { linkBillToTransactionTool } from "./write/link-bill-to-transaction";
import { updateBillTool } from "./write/update-bill";
import { presentCard } from "./ui/present-card";
import { readAttachment } from "./read/read-attachment";

/**
 * The complete allowlist. Order is deliberate and stable (reads first,
 * then the propose/confirm/commit write path, then the UI tool) - this
 * is what gets sent to Claude on every turn, so keeping the order fixed
 * keeps the tool-array prefix of the request identical across turns,
 * which matters for prompt caching.
 */
export const AGENT_TOOLS: AnyAgentToolDef[] = [
  getContextSnapshot,
  listStatementFiles,
  getParsedRows,
  reconcileStatement,
  searchTransactions,
  searchTransfers,
  queryInvestmentHoldings,
  listImportBatches,
  listCreditCardBills,
  searchBillTransactions,
  proposeImportPlan,
  updateImportPlan,
  proposeRevertPlan,
  commitPlan,
  recordMerchantCategory,
  updateTransactions,
  manageInvestmentAccount,
  manageInvestmentHolding,
  recordInvestmentTransaction,
  fundInvestmentAccountTool,
  manageCreditCard,
  updateBillTransactions,
  linkBillToTransactionTool,
  updateBillTool,
  presentCard,
  // Appended rather than grouped with the other reads on purpose: the
  // array order is the request's tool-array prefix, and inserting in the
  // middle would invalidate the prompt cache for every existing
  // conversation.
  readAttachment,
];
