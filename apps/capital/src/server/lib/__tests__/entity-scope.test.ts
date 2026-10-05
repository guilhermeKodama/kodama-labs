import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { entityScopeWhere, resolveEntityScope } from "../entity-scope";

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

describe("entityScopeWhere", () => {
  it("filters on entityId only for a resolved list", () => {
    expect(entityScopeWhere(null)).toEqual({});
    expect(entityScopeWhere([])).toEqual({ entityId: { in: [] } });
    expect(entityScopeWhere(["a", "b"])).toEqual({ entityId: { in: ["a", "b"] } });
  });
});
