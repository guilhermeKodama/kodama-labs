export const OPENAPI_TAGS = {
  v1: {
    name: "Transactions",
    description: "Transaction management endpoints",
  },
} as const;

export const routeConfig = {
  v1: {
    defaultTags: [OPENAPI_TAGS.v1.name],
  },
} as const;
