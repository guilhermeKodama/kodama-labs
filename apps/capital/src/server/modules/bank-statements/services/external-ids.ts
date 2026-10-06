import type { DbClient } from "@capital/server/lib/prisma";

/**
 * An account holds each external id (a bank's FITID) once, trashed rows
 * included (unique accountId + externalId). A row booked again on purpose
 * ("import anyway" on an exact duplicate) or while a trashed row it cannot
 * reuse holds the id gets `<externalId>~dup<n>`; its transfer group, when
 * it has one, keeps the plain id for duplicate detection.
 */
export const DUPLICATE_EXTERNAL_ID_SEPARATOR = "~dup";

/** The row of the account holding this external id, live or trashed. */
export function externalIdHolder(accountId: string, externalId: string, tx: DbClient) {
  return tx.ledgerEntry.findFirst({ where: { accountId, externalId } });
}

/** First `<externalId>~dup<n>` no row of the account holds. */
export async function freeExternalId(accountId: string, externalId: string, tx: DbClient): Promise<string> {
  const prefix = `${externalId}${DUPLICATE_EXTERNAL_ID_SEPARATOR}`;
  const taken = new Set((await tx.ledgerEntry.findMany({ where: { accountId, externalId: { startsWith: prefix } }, select: { externalId: true } })).map((e) => e.externalId));
  let n = 1;
  while (taken.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

/** The external id to book under on this account: the file's own when free, else a ~dup one. */
export async function bookableExternalId(accountId: string, externalId: string, tx: DbClient): Promise<string> {
  return (await externalIdHolder(accountId, externalId, tx)) ? freeExternalId(accountId, externalId, tx) : externalId;
}
