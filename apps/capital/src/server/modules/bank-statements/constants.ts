export const OPENAPI_TAGS = {
  v1: {
    name: "Bank Statements",
    description: "Bank statement upload and import endpoints",
  },
} as const;

export const routeConfig = {
  v1: {
    defaultTags: [OPENAPI_TAGS.v1.name],
  },
} as const;
