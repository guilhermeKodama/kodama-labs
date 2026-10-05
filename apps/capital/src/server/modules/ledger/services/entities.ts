import type { DbClient } from "@capital/server/lib/prisma";
import type { Entity, EntityType } from "@/generated/prisma";
import { LedgerError, notFound } from "../lib/errors";

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

export async function getOwnedEntity(userId: string, entityId: string, db: DbClient): Promise<Entity> {
  const entity = await db.entity.findFirst({ where: { id: entityId, userId } });
  if (!entity) throw notFound("Entity");
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
  if (!user) throw notFound("User");
  const entity = await db.entity.create({
    data: { userId, kind: "personal", name: "PF", defaultCurrency: user.baseCurrency },
  });
  await getDefaultAccount(entity, db);
  return entity;
}

export async function createEntity(userId: string, input: EntityInput, db: DbClient): Promise<Entity> {
  const kind = input.kind ?? "business";
  if (kind === "personal") {
    const pf = await db.entity.findFirst({ where: { userId, kind: "personal" } });
    if (pf) throw new LedgerError("The user already has a personal entity", 409);
  }
  const user = await db.user.findUnique({ where: { id: userId }, select: { baseCurrency: true } });
  if (!user) throw notFound("User");
  const entity = await db.entity.create({
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
  const account = await getDefaultAccount(entity, db);
  if (input.initialBalance) {
    await db.account.update({ where: { id: account.id }, data: { initialBalance: input.initialBalance } });
  }
  return entity;
}

export async function updateEntity(userId: string, entityId: string, patch: Partial<EntityInput>, db: DbClient) {
  const entity = await getOwnedEntity(userId, entityId, db);
  if (entity.kind === "personal" && patch.name !== undefined && patch.name !== entity.name) {
    throw new LedgerError("The personal entity cannot be renamed", 422);
  }
  const updated = await db.entity.update({
    where: { id: entityId },
    data: {
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.description !== undefined && { description: patch.description }),
      ...(patch.defaultCurrency !== undefined && { defaultCurrency: patch.defaultCurrency }),
      ...(patch.taxRate !== undefined && { taxRate: patch.taxRate }),
      ...(patch.color !== undefined && { color: patch.color }),
    },
  });
  if (patch.initialBalance !== undefined) {
    const account = await getDefaultAccount(updated, db);
    await db.account.update({ where: { id: account.id }, data: { initialBalance: patch.initialBalance } });
  }
  return updated;
}

export async function archiveEntity(userId: string, entityId: string, archived: boolean, db: DbClient) {
  const entity = await getOwnedEntity(userId, entityId, db);
  if (entity.kind === "personal") throw new LedgerError("The personal entity cannot be archived", 422);
  return db.entity.update({ where: { id: entityId }, data: { archivedAt: archived ? new Date() : null } });
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
    if (!entity) throw notFound(ref.businessId ? "Business" : "Personal account");
    if (ref.entityType && entity.kind !== ref.entityType) {
      throw new LedgerError(`Account ${id} is not a ${ref.entityType} account`, 422);
    }
    return entity;
  }
  if (ref.entityType === "business") throw new LedgerError("businessId is required for business entries", 422);
  return getPersonalEntity(userId, db);
}

/** Legacy shape: { businessId | personalAccountId, entityType } for MCP/assistant outputs. */
export function legacyEntityRef(entity: Pick<Entity, "id" | "kind">) {
  return entity.kind === "business"
    ? { entityType: "business" as const, businessId: entity.id, personalAccountId: null }
    : { entityType: "personal" as const, businessId: null, personalAccountId: entity.id };
}
