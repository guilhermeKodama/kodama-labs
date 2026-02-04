export const OPENAPI_TAGS = {
  v1: {
    name: "Currencies",
    description: "Currency management endpoints",
  },
} as const;

export const routeConfig = {
  v1: {
    defaultTags: [OPENAPI_TAGS.v1.name],
  },
} as const;
