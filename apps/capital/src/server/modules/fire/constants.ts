export const OPENAPI_TAGS = {
  v1Fire: {
    name: "FIRE",
    description: "Financial independence (Liberdade Financeira) planning endpoints",
  },
} as const;

export const routeConfig = {
  v1: {
    fireTags: [OPENAPI_TAGS.v1Fire.name],
  },
} as const;

/** Trailing window (months) used to average real expenses and suggest contributions. */
export const TRAILING_MONTHS = 6;
