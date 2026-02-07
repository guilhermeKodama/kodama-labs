export const OPENAPI_TAGS = {
  v1Accounts: {
    name: "Investment Accounts",
    description: "Investment account (broker/platform) management endpoints",
  },
  v1Holdings: {
    name: "Investment Holdings",
    description: "Investment holdings (positions) management endpoints",
  },
  v1Transactions: {
    name: "Investment Transactions",
    description: "Investment transaction (buy/sell/dividend) management endpoints",
  },
} as const;

export const routeConfig = {
  v1: {
    accountTags: [OPENAPI_TAGS.v1Accounts.name],
    holdingTags: [OPENAPI_TAGS.v1Holdings.name],
    transactionTags: [OPENAPI_TAGS.v1Transactions.name],
  },
} as const;
