import { env } from "@/env";
import { PrismaClient } from "@/generated/prisma";
import { assertNonProductionDatabase } from "./db-guard";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// The chokepoint: every server path in the app goes through this client,
// so checking here catches routes, scripts, cron jobs and tests alike.
// Throws at import time rather than letting a wrong DATABASE_URL through.
assertNonProductionDatabase(env.DATABASE_URL, "prisma client");

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: {
      db: {
        url: env.DATABASE_URL,
      },
    },
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export type PrismaTransactionClient = Parameters<
  Parameters<PrismaClient["$transaction"]>[0]
>[0];

export type DbClient = PrismaClient | PrismaTransactionClient;
