/**
 * React Query keys for every API domain. The first element of each key is
 * its root, and writes invalidate by root (invalidation.ts), so a new key
 * must start with one of QUERY_ROOTS. Parameter objects go last; React
 * Query hashes them with sorted keys and drops undefined values, so
 * `{ includeArchived: undefined }` and `{}` are the same key.
 */

export const QUERY_ROOTS = [
  "me",
  "entities",
  "accounts",
  "statements",
  "categories",
  "currencies",
  "rules",
  "views",
  "ledger",
  "attachments",
  "mutations",
  "trash",
  "budgets",
  "recurring",
  "holdings",
  "operations",
  "portfolio",
  "targets",
  "rebalance",
  "contributions",
  "fire",
  "quotes",
  "assets",
  "imports",
  "notifications",
  "tokens",
  "assistant",
] as const;

export type QueryRoot = (typeof QUERY_ROOTS)[number];

/** Entity scope used by budgets and investments: everything, PF, PJ (all businesses) or one entity id. */
export type EntityScope = "all" | "pf" | "pj" | (string & {});

type Params = Record<string, unknown>;

export const keys = {
  me: () => ["me"] as const,

  // Catalog
  entities: (params: { includeArchived?: boolean } = {}) => ["entities", params] as const,
  accounts: (params: { includeArchived?: boolean; entityId?: string; type?: string } = {}) => ["accounts", params] as const,
  /** Card statements of one account (closing/due dates and totals). */
  statements: (accountId: string) => ["statements", accountId] as const,
  categories: (params: { includeArchived?: boolean; type?: string; withCounts?: boolean } = {}) => ["categories", params] as const,
  categoryUsage: (id: string) => ["categories", "usage", id] as const,
  currencies: () => ["currencies"] as const,
  rules: () => ["rules"] as const,
  ruleTest: (description: string, entityId?: string | null) => ["rules", "test", { description, entityId: entityId ?? null }] as const,
  /** POST /v2/rules/suggest: the category to suggest while typing a description. */
  ruleSuggest: (input: { description: string; entityId?: string | null; kind?: string; ai?: boolean }) => ["rules", "suggest", input] as const,

  // Views and the ledger
  views: (dataset = "ledger") => ["views", dataset] as const,
  /** POST /v2/ledger/query with this body (a LedgerQueryInput). */
  ledgerQuery: (input: object) => ["ledger", "query", input] as const,
  entry: (id: string) => ["ledger", "entry", id] as const,
  entryHistory: (id: string) => ["ledger", "entry", id, "history"] as const,
  deleteOptions: (id: string) => ["ledger", "entry", id, "delete-options"] as const,
  attachments: (ownerType: string, ownerId: string) => ["attachments", ownerType, ownerId] as const,
  /** Undo history; `{ undoable: true, limit: 1 }` is the ⌘Z fallback. */
  mutations: (params: { undoable?: boolean; limit?: number } = {}) => ["mutations", params] as const,
  trash: (params: { cursor?: string; limit?: number } = {}) => ["trash", params] as const,
  /** POST /v2/ledger/bulk with dryRun: what a bulk edit would change. */
  bulkPreview: (input: object) => ["ledger", "bulk-preview", input] as const,

  // Budgets and recurring
  /** GET /v2/budgets/overview (mode, month or year, scope). */
  budgets: (params: Params) => ["budgets", "overview", params] as const,
  budgetsList: (params: Params = {}) => ["budgets", "list", params] as const,
  recurring: (params: Params = {}) => ["recurring", params] as const,

  // Investments
  holdings: (scope: EntityScope = "all") => ["holdings", scope] as const,
  operations: (params: Params = {}) => ["operations", params] as const,
  portfolioSummary: (scope: EntityScope = "all") => ["portfolio", "summary", scope] as const,
  portfolioHistory: (params: { months?: number; scope?: EntityScope } = {}) => ["portfolio", "history", params] as const,
  targets: () => ["targets"] as const,
  rebalance: (params: Params = {}) => ["rebalance", params] as const,
  contributions: (params: Params = {}) => ["contributions", params] as const,
  fire: (params: Params = {}) => ["fire", params] as const,
  /** Live quotes; tickers are sorted so the order of a selection does not split the cache. */
  quotes: (tickers: readonly string[]) => ["quotes", [...tickers].sort()] as const,
  assetSearch: (query: string) => ["assets", "search", query] as const,

  // Imports
  imports: () => ["imports", "list"] as const,
  /** Analysis of picked files; `fingerprint` identifies the selection (names, sizes, account). */
  importAnalyze: (fingerprint: string) => ["imports", "analyze", fingerprint] as const,

  // Settings and platform
  notificationsSettings: () => ["notifications", "settings"] as const,
  devices: (endpoint: string | null = null) => ["notifications", "devices", endpoint] as const,
  apiTokens: () => ["tokens", "list"] as const,
  apiClients: () => ["tokens", "clients"] as const,
  assistantConversations: () => ["assistant", "conversations"] as const,
  assistantConversation: (id: string) => ["assistant", "conversation", id] as const,
};
