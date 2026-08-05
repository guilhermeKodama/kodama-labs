import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

// Empty strings in .env mean "not configured" — normalize to undefined so
// optional vars with format constraints don't fail validation when blank.
const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

export const env = createEnv({
  server: {
    DATABASE_URL: z
      .string()
      .url()
      .default("postgresql://root:root@localhost:5433/pipeline"),
    DIRECT_URL: optional(z.string().url()),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    CRON_SECRET: optional(z.string()),
    SYNC_SECRET: optional(z.string()),
    WEBHOOK_HMAC_SECRET: optional(z.string()),
    DASHBOARD_USER: optional(z.string()),
    DASHBOARD_PASSWORD: optional(z.string()),
    // Ads/GA4 credentials are optional: cron jobs skip with a clear JobRun
    // message until they exist, so the app deploys before any token is issued.
    META_SYSTEM_USER_TOKEN: optional(z.string()),
    GOOGLE_ADS_DEVELOPER_TOKEN: optional(z.string()),
    GOOGLE_ADS_CLIENT_ID: optional(z.string()),
    GOOGLE_ADS_CLIENT_SECRET: optional(z.string()),
    GOOGLE_ADS_REFRESH_TOKEN: optional(z.string()),
    GOOGLE_ADS_LOGIN_CUSTOMER_ID: optional(
      z.string().regex(/^\d{10}$/, "MCC id, digits only, no dashes"),
    ),
    GA4_SA_KEY_BASE64: optional(z.string()),
  },
  client: {
    NEXT_PUBLIC_APP_URL: z.string().url().optional(),
  },
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    DIRECT_URL: process.env.DIRECT_URL,
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    CRON_SECRET: process.env.CRON_SECRET,
    SYNC_SECRET: process.env.SYNC_SECRET,
    WEBHOOK_HMAC_SECRET: process.env.WEBHOOK_HMAC_SECRET,
    DASHBOARD_USER: process.env.DASHBOARD_USER,
    DASHBOARD_PASSWORD: process.env.DASHBOARD_PASSWORD,
    META_SYSTEM_USER_TOKEN: process.env.META_SYSTEM_USER_TOKEN,
    GOOGLE_ADS_DEVELOPER_TOKEN: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
    GOOGLE_ADS_CLIENT_ID: process.env.GOOGLE_ADS_CLIENT_ID,
    GOOGLE_ADS_CLIENT_SECRET: process.env.GOOGLE_ADS_CLIENT_SECRET,
    GOOGLE_ADS_REFRESH_TOKEN: process.env.GOOGLE_ADS_REFRESH_TOKEN,
    GOOGLE_ADS_LOGIN_CUSTOMER_ID: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
    GA4_SA_KEY_BASE64: process.env.GA4_SA_KEY_BASE64,
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
