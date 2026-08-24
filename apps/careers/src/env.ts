import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  // .env.example ships several optional keys as "" rather than commented
  // out (VAPID/ANTHROPIC keys, mainly) — without this, t3-env treats the
  // empty string as a present-but-invalid value instead of "unset", and
  // .min(1).optional() fails on it even though the field is genuinely
  // optional.
  emptyStringAsUndefined: true,
  server: {
    DATABASE_URL: z
      .string()
      .url()
      .default("postgresql://root:root@localhost:5433/careers"),
    DIRECT_URL: z.string().url().optional(),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),

    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    SCORE_MODEL: z.string().default("claude-haiku-4-5"),
    SUGGEST_MODEL: z.string().default("claude-opus-5"),
    LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
    LLM_DAILY_BUDGET_USD: z.coerce.number().positive().default(5),

    VAPID_PRIVATE_KEY: z.string().min(1).optional(),
    VAPID_SUBJECT: z.string().default("mailto:guilherme.kodama@gmail.com"),

    // Absolute by default and outside the repo — must not depend on which
    // checkout/worktree the code happens to run from (same lesson attention
    // learned with WHATSAPP_AUTH_DIR).
    CAREERS_BLOB_DIR: z
      .string()
      .default("/home/kodama/.local/share/careers/blob"),
    BLOB_READ_WRITE_TOKEN: z.string().optional(),

    VAULT_VAGAS_DIR: z
      .string()
      .default("/mnt/nas-shared/obsidian/kodama-vault/vagas"),

    MAX_JOBS_PER_DAY: z.coerce.number().int().positive().default(10),
  },
  client: {
    NEXT_PUBLIC_APP_URL: z.string().url().optional(),
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  },
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    DIRECT_URL: process.env.DIRECT_URL,
    NODE_ENV: process.env.NODE_ENV,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    SCORE_MODEL: process.env.SCORE_MODEL,
    SUGGEST_MODEL: process.env.SUGGEST_MODEL,
    LLM_TIMEOUT_MS: process.env.LLM_TIMEOUT_MS,
    LLM_DAILY_BUDGET_USD: process.env.LLM_DAILY_BUDGET_USD,
    VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: process.env.VAPID_SUBJECT,
    CAREERS_BLOB_DIR: process.env.CAREERS_BLOB_DIR,
    BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
    VAULT_VAGAS_DIR: process.env.VAULT_VAGAS_DIR,
    MAX_JOBS_PER_DAY: process.env.MAX_JOBS_PER_DAY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
