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
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
