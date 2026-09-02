import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  // .env.example ships the VAPID keys as "" rather than commented out —
  // without this, t3-env treats the empty string as a present-but-invalid
  // value instead of "unset", and .min(1).optional() fails on it even though
  // the field is genuinely optional (same footgun careers hit first).
  emptyStringAsUndefined: true,
  server: {
    // No default on purpose. This used to fall back to the PRODUCTION
    // database (capital), so any context that didn't load a .env - vitest
    // being the dangerous one - silently read and wrote prod. Failing
    // loudly on a missing DATABASE_URL is the only safe behaviour.
    DATABASE_URL: z.string().url(),
    DIRECT_URL: z.string().url().optional(),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    CRON_SECRET: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
    BRAPI_TOKEN: z.string().optional(),
    BLOB_READ_WRITE_TOKEN: z.string().optional(),
    CAPITAL_AGENT_MODEL: z.string().default("claude-opus-5"),
    ASSISTANT_MAX_TOOL_ITERATIONS: z.coerce.number().int().positive().default(12),
    ASSISTANT_MAX_TURN_COST_USD: z.coerce.number().positive().default(0.5),
    // Own keypair (do not reuse another app's) — generate with
    // `pnpm exec web-push generate-vapid-keys`. Absent = push sends no-op.
    VAPID_PRIVATE_KEY: z.string().min(1).optional(),
    VAPID_SUBJECT: z.string().default("mailto:guilherme.kodama@gmail.com"),
  },
  client: {
    NEXT_PUBLIC_APP_URL: z.string().url().optional(),
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  },
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    DIRECT_URL: process.env.DIRECT_URL,
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    CRON_SECRET: process.env.CRON_SECRET,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    BRAPI_TOKEN: process.env.BRAPI_TOKEN,
    BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
    CAPITAL_AGENT_MODEL: process.env.CAPITAL_AGENT_MODEL,
    ASSISTANT_MAX_TOOL_ITERATIONS: process.env.ASSISTANT_MAX_TOOL_ITERATIONS,
    ASSISTANT_MAX_TURN_COST_USD: process.env.ASSISTANT_MAX_TURN_COST_USD,
    VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: process.env.VAPID_SUBJECT,
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
