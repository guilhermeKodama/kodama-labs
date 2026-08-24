import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z
      .string()
      .url()
      .default("postgresql://root:root@localhost:5433/attention"),
    DIRECT_URL: z.string().url().optional(),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    VAPID_PRIVATE_KEY: z.string().min(1),
    VAPID_SUBJECT: z.string().default("mailto:guilherme.kodama@gmail.com"),
    WHATSAPP_HASH_SALT: z.string().default("dev-salt-change-me"),
    // Absolute by default and outside the repo — the session must not depend on which
    // checkout/worktree the code happens to run from.
    WHATSAPP_AUTH_DIR: z
      .string()
      .default("/home/kodama/.local/share/attention/baileys-auth"),
    RETENTION_DAYS: z.coerce.number().int().positive().default(7),
    // Local whisper-rocm instance already running on this machine (OpenAI-compatible API).
    WHISPER_API_URL: z.string().url().default("http://localhost:8083"),
    // Local Ollama instance (native, not the empty Docker one on 11435) — GPU-accelerated triage/drafts.
    OLLAMA_API_URL: z.string().url().default("http://localhost:11434"),
    TRIAGE_MODEL: z.string().default("gemma4:12b"),
    DRAFT_MODEL: z.string().default("gemma4:12b"),
    LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
    DIGEST_WINDOWS: z.string().default("08:00,13:00,18:00,21:00"),
    AGORA_MAX_PER_DAY: z.coerce.number().int().positive().default(5),
  },
  client: {
    NEXT_PUBLIC_APP_URL: z.string().url().optional(),
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().min(1),
  },
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    DIRECT_URL: process.env.DIRECT_URL,
    NODE_ENV: process.env.NODE_ENV,
    VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: process.env.VAPID_SUBJECT,
    WHATSAPP_HASH_SALT: process.env.WHATSAPP_HASH_SALT,
    WHATSAPP_AUTH_DIR: process.env.WHATSAPP_AUTH_DIR,
    RETENTION_DAYS: process.env.RETENTION_DAYS,
    WHISPER_API_URL: process.env.WHISPER_API_URL,
    OLLAMA_API_URL: process.env.OLLAMA_API_URL,
    TRIAGE_MODEL: process.env.TRIAGE_MODEL,
    DRAFT_MODEL: process.env.DRAFT_MODEL,
    LLM_TIMEOUT_MS: process.env.LLM_TIMEOUT_MS,
    DIGEST_WINDOWS: process.env.DIGEST_WINDOWS,
    AGORA_MAX_PER_DAY: process.env.AGORA_MAX_PER_DAY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
