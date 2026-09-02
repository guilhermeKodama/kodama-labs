import { useSettingsStore } from "@/lib/store/settings-store";
import { useBusinessStore } from "@/lib/store/business-store";
import { useTransactionStore } from "@/lib/store/transaction-store";
import { useTransferStore } from "@/lib/store/transfer-store";
import { useRecurringTransactionStore } from "@/lib/store/recurring-store";
import { useRecurringTransferStore } from "@/lib/store/recurring-transfer-store";
import { useBudgetStore } from "@/lib/store/budget-store";
import { useCreditCardStore } from "@/lib/store/credit-card-store";
import { useInvestmentStore } from "@/lib/store/investment-store";
import { useFireStore } from "@/lib/store/fire-store";
import { useAttachmentStore } from "@/lib/store/attachment-store";
import { useAssistantStore } from "@/lib/store/assistant-store";

// Navigation/resume revalidations skip the network while data is younger
// than this; pull-to-refresh bypasses it with { force: true }.
const REFRESH_STALE_MS = 30_000;

let lastRefreshedAt = 0;
let inFlight: Promise<void> | null = null;

// Everything the app can render, in one parallel round. The old
// fetch-userData-first sequencing predated session-based auth (the backend
// now derives userId from the cookie), so nothing here depends on anything
// else. Store actions catch their own errors internally — this never rejects.
async function fetchEverything(): Promise<void> {
  const settings = useSettingsStore.getState();
  const creditCards = useCreditCardStore.getState();
  const investments = useInvestmentStore.getState();
  const attachments = useAttachmentStore.getState();

  await Promise.all([
    settings.fetchUserData(),
    useBusinessStore.getState().fetchBusinesses(),
    useTransactionStore.getState().fetchTransactions(),
    useTransferStore.getState().fetchTransfers(),
    useRecurringTransactionStore.getState().fetchRecurringTransactions(),
    useRecurringTransferStore.getState().fetchRecurringTransfers(),
    useBudgetStore.getState().fetchBudgets(),
    creditCards.fetchCreditCards(),
    creditCards.fetchBills(),
    creditCards.fetchInstallments(),
    investments.fetchAccounts(),
    investments.fetchHoldings(),
    investments.fetchTransactions(),
    investments.fetchPortfolioSummary(),
    useFireStore.getState().fetchSummary(),
    attachments.fetchByOwnerType("transaction"),
    attachments.fetchByOwnerType("transfer"),
    attachments.fetchByOwnerType("recurringTransaction"),
    attachments.fetchByOwnerType("recurringTransfer"),
    // Conversation LIST only. Per-conversation messages are deliberately not
    // refreshed here: the loadedConversations guard in the thread page exists
    // to stop a GET clobbering an in-flight stream with a pre-turn snapshot.
    useAssistantStore.getState().fetchConversations(),
  ]);
}

/**
 * Central stale-while-revalidate entry point: data already on screen stays
 * put while stores refetch and swap silently. Deduped (concurrent callers
 * share the in-flight round) and staleness-gated unless forced.
 */
export function refreshAllData({ force = false } = {}): Promise<void> {
  if (inFlight) return inFlight;
  if (!force && Date.now() - lastRefreshedAt < REFRESH_STALE_MS) {
    return Promise.resolve();
  }
  inFlight = fetchEverything().finally(() => {
    lastRefreshedAt = Date.now();
    inFlight = null;
  });
  return inFlight;
}
