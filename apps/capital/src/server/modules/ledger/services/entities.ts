import type { DbClient } from "@capital/server/lib/prisma";
import type { Entity, EntityType } from "@/generated/prisma";
import { LedgerError, notFound } from "../lib/errors";
import { inTransaction, recordMutation, snapshot, type MutationRecordInput } from "./mutations";

export interface EntityInput {
  kind?: EntityType;
  name: string;
  description?: string | null;
  defaultCurrency?: string;
  taxRate?: number;
  color?: string | null;
  initialBalance?: number;
}

export async function listEntities(userId: string, db: DbClient, opts: { includeArchived?: boolean } = {}) {
  return db.entity.findMany({
    where: { userId, ...(opts.includeArchived ? {} : { archivedAt: null }) },
    orderBy: [{ kind: "desc" }, { createdAt: "asc" }],
  });
}

/** Entities with the number of accounts and cards linked to each (archived accounts left out), for the Negócios e PF list. */
export async function listEntitiesWithAccountCounts(userId: string, db: DbClient, opts: { includeArchived?: boolean } = {}) {
  const [entities, counts] = await Promise.all([
    listEntities(userId, db, opts),
    db.account.groupBy({ by: ["entityId"], where: { userId, archivedAt: null }, _count: { _all: true } }),
  ]);
  const byEntity = new Map(counts.map((c) => [c.entityId, c._count._all]));
  return entities.map((e) => ({ ...e, accountsCount: byEntity.get(e.id) ?? 0 }));
}

export async function getOwnedEntity(userId: string, entityId: string, db: DbClient): Promise<Entity> {
  const entity = await db.entity.findFirst({ where: { id: entityId, userId } });
  if (!entity) throw notFound("Entity", "entity.not_found");
  return entity;
}

/** The entity's main checking account; created on demand for entities that predate it. */
export async function getDefaultAccount(entity: Pick<Entity, "id" | "userId" | "defaultCurrency">, db: DbClient) {
  const existing = await db.account.findFirst({ where: { entityId: entity.id, isDefault: true } });
  if (existing) return existing;
  return db.account.create({
    data: {
      userId: entity.userId,
      entityId: entity.id,
      type: "checking",
      name: "Conta principal",
      currency: entity.defaultCurrency,
      isDefault: true,
    },
  });
}

/** The user's PF entity (exactly one per user), created with its default account if missing. */
export async function getPersonalEntity(userId: string, db: DbClient): Promise<Entity> {
  const existing = await db.entity.findFirst({ where: { userId, kind: "personal" }, orderBy: { createdAt: "asc" } });
  if (existing) return existing;
  const user = await db.user.findUnique({ where: { id: userId }, select: { baseCurrency: true } });
  if (!user) throw notFound("User", "user.not_found");
  const entity = await db.entity.create({
    data: { userId, kind: "personal", name: "PF", defaultCurrency: user.baseCurrency },
  });
  await getDefaultAccount(entity, db);
  return entity;
}

/** Options of the entity writes: `collect` adds their records to the caller's batch instead of recording one. */
export interface EntityWriteOptions {
  collect?: MutationRecordInput[];
}

/** Records `records` as one batch, or hands them to the caller's (`collect`); null when there is nothing to record. */
async function finishBatch(tx: DbClient, userId: string, op: string, summary: string, records: MutationRecordInput[], opts: EntityWriteOptions) {
  if (opts.collect) {
    opts.collect.push(...records);
    return null;
  }
  return records.length ? recordMutation(tx, userId, op, summary, records) : null;
}

/** Creates a business (or the PF) with its "Conta principal", in one undoable batch: undo removes both while unused. */
export async function createEntity(userId: string, input: EntityInput, db: DbClient, opts: EntityWriteOptions = {}): Promise<Entity & { batchId: string | null }> {
  return inTransaction(db, async (tx) => {
    const kind = input.kind ?? "business";
    if (kind === "personal") {
      const pf = await tx.entity.findFirst({ where: { userId, kind: "personal" } });
      if (pf) throw new LedgerError("The user already has a personal entity", 409, { code: "entity.personal_exists" });
    }
    const user = await tx.user.findUnique({ where: { id: userId }, select: { baseCurrency: true } });
    if (!user) throw notFound("User", "user.not_found");
    const entity = await tx.entity.create({
      data: {
        userId,
        kind,
        name: input.name,
        description: input.description ?? null,
        defaultCurrency: input.defaultCurrency ?? user.baseCurrency,
        taxRate: input.taxRate ?? 0,
        color: input.color ?? null,
      },
    });
    let account = await getDefaultAccount(entity, tx);
    if (input.initialBalance) {
      account = await tx.account.update({ where: { id: account.id }, data: { initialBalance: input.initialBalance } });
    }
    const records: MutationRecordInput[] = [
      { model: "Entity", recordId: entity.id, before: null, after: snapshot(entity) },
      { model: "Account", recordId: account.id, before: null, after: snapshot(account) },
    ];
    const batchId = await finishBatch(tx, userId, "entity.create", entity.name, records, opts);
    return { ...entity, batchId };
  });
}

async function updateEntityIn(tx: DbClient, userId: string, entityId: string, patch: Partial<EntityInput>, records: MutationRecordInput[]) {
  const entity = await getOwnedEntity(userId, entityId, tx);
  if (entity.kind === "personal" && patch.name !== undefined && patch.name !== entity.name) {
    throw new LedgerError("The personal entity cannot be renamed", 422, { code: "entity.personal_rename" });
  }
  const updated = await tx.entity.update({
    where: { id: entityId },
    data: {
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.description !== undefined && { description: patch.description }),
      ...(patch.defaultCurrency !== undefined && { defaultCurrency: patch.defaultCurrency }),
      ...(patch.taxRate !== undefined && { taxRate: patch.taxRate }),
      ...(patch.color !== undefined && { color: patch.color }),
    },
  });
  records.push({ model: "Entity", recordId: entity.id, before: snapshot(entity), after: snapshot(updated) });
  if (patch.initialBalance !== undefined) {
    const account = await getDefaultAccount(updated, tx);
    const moved = await tx.account.update({ where: { id: account.id }, data: { initialBalance: patch.initialBalance } });
    records.push({ model: "Account", recordId: account.id, before: snapshot(account), after: snapshot(moved) });
  }
  return updated;
}

async function archiveEntityIn(tx: DbClient, userId: string, entityId: string, archived: boolean, records: MutationRecordInput[]) {
  const entity = await getOwnedEntity(userId, entityId, tx);
  if (entity.kind === "personal") throw new LedgerError("The personal entity cannot be archived", 422, { code: "entity.personal_archive" });
  const updated = await tx.entity.update({ where: { id: entityId }, data: { archivedAt: archived ? (entity.archivedAt ?? new Date()) : null } });
  records.push({ model: "Entity", recordId: entity.id, before: snapshot(entity), after: snapshot(updated) });
  return updated;
}

/** Edits an entity (and the opening balance of its main account), in one undoable batch. */
export async function updateEntity(userId: string, entityId: string, patch: Partial<EntityInput>, db: DbClient, opts: EntityWriteOptions = {}) {
  return inTransaction(db, async (tx) => {
    const records: MutationRecordInput[] = [];
    const updated = await updateEntityIn(tx, userId, entityId, patch, records);
    return { ...updated, batchId: await finishBatch(tx, userId, "entity.update", updated.name, records, opts) };
  });
}

/** Archives (or unarchives) a business, in one undoable batch. */
export async function archiveEntity(userId: string, entityId: string, archived: boolean, db: DbClient, opts: EntityWriteOptions = {}) {
  return inTransaction(db, async (tx) => {
    const records: MutationRecordInput[] = [];
    const updated = await archiveEntityIn(tx, userId, entityId, archived, records);
    return { ...updated, batchId: await finishBatch(tx, userId, archived ? "entity.archive" : "entity.unarchive", updated.name, records, opts) };
  });
}

/** PATCH /v2/entities/{id}: archive/unarchive and edit together, as one undoable batch. */
export async function patchEntity(userId: string, entityId: string, patch: Partial<EntityInput> & { archived?: boolean }, db: DbClient) {
  const { archived, ...fields } = patch;
  return inTransaction(db, async (tx) => {
    const records: MutationRecordInput[] = [];
    let entity = await getOwnedEntity(userId, entityId, tx);
    if (archived !== undefined) entity = await archiveEntityIn(tx, userId, entityId, archived, records);
    if (Object.keys(fields).length) entity = await updateEntityIn(tx, userId, entityId, fields, records);
    const op = archived === undefined ? "entity.update" : archived ? "entity.archive" : "entity.unarchive";
    return { ...entity, batchId: await finishBatch(tx, userId, op, entity.name, records, {}) };
  });
}

/**
 * Resolve an entity from the legacy `businessId` / `personalAccountId` pair
 * the MCP and assistant contracts still use. Entity ids equal the old
 * business / personal account ids, so this is an ownership check.
 */
export async function resolveLegacyEntity(
  userId: string,
  ref: { entityType?: EntityType | null; businessId?: string | null; personalAccountId?: string | null },
  db: DbClient
): Promise<Entity> {
  const id = ref.businessId ?? ref.personalAccountId ?? null;
  if (id) {
    const entity = await db.entity.findFirst({ where: { id, userId } });
    if (!entity) throw notFound(ref.businessId ? "Business" : "Personal account", "entity.not_found");
    if (ref.entityType && entity.kind !== ref.entityType) {
      throw new LedgerError(`Account ${id} is not a ${ref.entityType} account`, 422, { code: "entity.kind_mismatch", params: { id, kind: ref.entityType } });
    }
    return entity;
  }
  if (ref.entityType === "business") throw new LedgerError("businessId is required for business entries", 422, { code: "entity.business_required" });
  return getPersonalEntity(userId, db);
}

/** Legacy shape: { businessId | personalAccountId, entityType } for MCP/assistant outputs. */
export function legacyEntityRef(entity: Pick<Entity, "id" | "kind">) {
  return entity.kind === "business"
    ? { entityType: "business" as const, businessId: entity.id, personalAccountId: null }
    : { entityType: "personal" as const, businessId: null, personalAccountId: entity.id };
}
