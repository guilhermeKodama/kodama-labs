import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z
      .string()
      .url()
      .default("postgresql://root:root@localhost:5433/capital"),
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
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    BRAPI_TOKEN: process.env.BRAPI_TOKEN,
    BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
    CAPITAL_AGENT_MODEL: process.env.CAPITAL_AGENT_MODEL,
    ASSISTANT_MAX_TOOL_ITERATIONS: process.env.ASSISTANT_MAX_TOOL_ITERATIONS,
    ASSISTANT_MAX_TURN_COST_USD: process.env.ASSISTANT_MAX_TURN_COST_USD,
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
