export const OPENAPI_TAGS = {
  v1: {
    name: "Reports",
    description: "Financial reports and summaries",
  },
} as const;

export const routeConfig = {
  v1: {
    defaultTags: [OPENAPI_TAGS.v1.name],
  },
} as const;
