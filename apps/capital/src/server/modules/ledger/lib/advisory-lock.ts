import type { DbClient } from "@capital/server/lib/prisma";

/**
 * Serializes work that shares `key` until the surrounding transaction ends.
 * Call it inside `inTransaction`, before the duplicate check: a second
 * transaction blocks here and then sees the first one's rows.
 */
export async function advisoryLock(db: DbClient, key: string): Promise<void> {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0::bigint))`;
}
