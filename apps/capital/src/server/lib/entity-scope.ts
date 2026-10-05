import { z } from "@hono/zod-openapi";
import type { DbClient } from "./prisma";
import { notFound } from "../modules/ledger/lib/errors";

/**
 * The "PF / PJ" scope of the budget, portfolio and contributions screens:
 * "all" (no filter), "pf" (the personal entity), "pj" (every business) or
 * one entity's id.
 */
export const ENTITY_SCOPES = ["all", "pf", "pj"] as const;
export type EntityScope = (typeof ENTITY_SCOPES)[number] | (string & {});

/** Query parameter for a scope; resolveEntityScope checks that an id is the user's. */
export const entityScopeSchema = z.string().min(1).describe('"all", "pf", "pj" (every business entity) or an entity id');

/**
 * The entity ids a scope covers, or null for "all" (and no scope) so callers
 * skip the filter. Archived entities stay in "pf" and "pj": their history
 * still counts. "pj" without businesses is an empty list (nothing matches).
 * An id that is not one of the user's entities is a 404.
 */
export async function resolveEntityScope(userId: string, scope: EntityScope | null | undefined, db: DbClient): Promise<string[] | null> {
  if (!scope || scope === "all") return null;
  if (scope === "pf" || scope === "pj") {
    const entities = await db.entity.findMany({
      where: { userId, kind: scope === "pf" ? "personal" : "business" },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    return entities.map((e) => e.id);
  }
  const entity = await db.entity.findFirst({ where: { id: scope, userId }, select: { id: true } });
  if (!entity) throw notFound("Entity", "entity.not_found");
  return [entity.id];
}

/** Prisma filter on `entityId` for a resolved scope (no filter for null). */
export function entityScopeWhere(entityIds: string[] | null): { entityId?: { in: string[] } } {
  return entityIds ? { entityId: { in: entityIds } } : {};
}
