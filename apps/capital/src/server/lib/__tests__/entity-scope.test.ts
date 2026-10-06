import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { Prisma } from "@/generated/prisma";
import { entityScopeSql, entityScopeWhere, inEntityScope, resolveEntityScope, resolveScopeQuery } from "../entity-scope";

const USER = "test-user-entity-scope-001";
const OTHER = "test-user-entity-scope-002";
let f: LedgerFixture;
let other: LedgerFixture;
let archivedPj: string;

beforeAll(async () => {
  f = await createLedgerFixture(prisma, USER);
  other = await createLedgerFixture(prisma, OTHER);
  archivedPj = (await prisma.entity.create({ data: { userId: USER, kind: "business", name: "Old LTDA", archivedAt: new Date() } })).id;
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
  await deleteLedgerFixture(prisma, OTHER);
});

describe("resolveEntityScope", () => {
  it("is no filter for all and for no scope", async () => {
    expect(await resolveEntityScope(USER, "all", prisma)).toBeNull();
    expect(await resolveEntityScope(USER, undefined, prisma)).toBeNull();
    expect(await resolveEntityScope(USER, "", prisma)).toBeNull();
  });

  it("is the personal entity for pf and every business, archived ones too, for pj", async () => {
    expect(await resolveEntityScope(USER, "pf", prisma)).toEqual([f.pfId]);
    expect(await resolveEntityScope(USER, "pj", prisma)).toEqual([f.pjId, archivedPj]);
  });

  it("is the one entity an id names, when the user owns it", async () => {
    expect(await resolveEntityScope(USER, f.pjId, prisma)).toEqual([f.pjId]);
    await expect(resolveEntityScope(USER, other.pjId, prisma)).rejects.toMatchObject({ status: 404, code: "entity.not_found" });
    await expect(resolveEntityScope(USER, "nope", prisma)).rejects.toMatchObject({ status: 404 });
  });

  it("is an empty list for pj when the user has no business", async () => {
    await prisma.entity.deleteMany({ where: { userId: OTHER, kind: "business" } });
    expect(await resolveEntityScope(OTHER, "pj", prisma)).toEqual([]);
  });
});

describe("resolveScopeQuery", () => {
  it("takes scope over the older entityId", async () => {
    expect(await resolveScopeQuery(USER, { scope: "pf", entityId: f.pjId }, prisma)).toEqual([f.pfId]);
    expect(await resolveScopeQuery(USER, { entityId: f.pjId }, prisma)).toEqual([f.pjId]);
    expect(await resolveScopeQuery(USER, {}, prisma)).toBeNull();
  });
});

describe("inEntityScope and entityScopeSql", () => {
  it("match everything for no scope and nothing for an empty one", async () => {
    expect(inEntityScope(null, "x")).toBe(true);
    expect(inEntityScope(["a"], "a")).toBe(true);
    expect(inEntityScope(["a"], "b")).toBe(false);
    expect(inEntityScope(["a"], null)).toBe(false);
    expect(inEntityScope([], "a")).toBe(false);

    const count = async (ids: string[] | null) =>
      (await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM entities e WHERE e."userId" = ${USER} AND ${entityScopeSql(Prisma.sql`e.id`, ids)}`)[0].n;
    expect(await count(null)).toBe(3);
    expect(await count([])).toBe(0);
    expect(await count([f.pfId, f.pjId])).toBe(2);
  });
});

describe("entityScopeWhere", () => {
  it("filters on entityId only for a resolved list", () => {
    expect(entityScopeWhere(null)).toEqual({});
    expect(entityScopeWhere([])).toEqual({ entityId: { in: [] } });
    expect(entityScopeWhere(["a", "b"])).toEqual({ entityId: { in: ["a", "b"] } });
  });
});
