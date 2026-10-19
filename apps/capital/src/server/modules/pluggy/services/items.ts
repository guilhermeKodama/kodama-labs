import type { DividendOrigin, EntityType } from "@/generated/prisma";
import type { PassiveIncomeType } from "@/lib/invest/passive-income";
import { formatDateOnly, parseLocalDate } from "@capital/server/lib/date-utils";
import type { DbClient } from "@capital/server/lib/prisma";
import { LedgerError } from "@capital/server/modules/ledger/lib/errors";
import { isPluggyConfigured } from "../lib/config";
import { bookConfirmedIncome } from "./sync";

const ITEM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertItemId(itemId: string): string {
  const value = itemId.trim();
  if (!ITEM_ID.test(value)) throw new LedgerError("The Pluggy item id is not a UUID", 422, { code: "pluggy.item_id" });
  return value;
}

export async function pluggyOverview(userId: string, db: DbClient) {
  const [items, reviews] = await Promise.all([
    db.pluggyItem.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      include: { accounts: { orderBy: { name: "asc" } } },
    }),
    db.pluggyReview.findMany({ where: { userId, status: "open" }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  return {
    enabled: isPluggyConfigured(),
    items: items.map((item) => ({
      id: item.id,
      label: item.label,
      itemId: item.itemId,
      entityKind: item.entityKind,
      status: item.status,
      consentExpiresAt: item.consentExpiresAt?.toISOString() ?? null,
      lastSyncAt: item.lastSyncAt?.toISOString() ?? null,
      lastSuccessAt: item.lastSuccessAt?.toISOString() ?? null,
      lastError: item.lastError,
      syncing: item.syncingAt != null,
      syncCutoff: item.syncCutoff ? formatDateOnly(item.syncCutoff) : null,
      incomeCategoryId: item.incomeCategoryId,
      brokerageAccountId: item.brokerageAccountId,
      accounts: item.accounts.map((account) => ({
        id: account.id,
        name: account.name,
        type: account.type,
        subtype: account.subtype,
        capitalAccountId: account.capitalAccountId,
      })),
    })),
    reviews: reviews.map((review) => ({
      id: review.id,
      itemRowId: review.itemRowId,
      kind: review.kind,
      status: review.status,
      draft: review.draft,
      createdAt: review.createdAt.toISOString(),
    })),
  };
}

async function ownedItem(userId: string, id: string, db: DbClient) {
  const item = await db.pluggyItem.findFirst({ where: { id, userId } });
  if (!item) throw new LedgerError("Connection not found", 404, { code: "pluggy.not_found" });
  return item;
}

async function accountOfKind(userId: string, accountId: string, entityKind: EntityType, types: string[], db: DbClient) {
  const account = await db.account.findFirst({ where: { id: accountId, userId, archivedAt: null }, include: { entity: true } });
  if (!account) throw new LedgerError("Account not found", 404, { code: "account.not_found" });
  if (account.entity.kind !== entityKind) throw new LedgerError("That account belongs to the other entity", 422, { code: "pluggy.entity_mismatch" });
  if (!types.includes(account.type)) throw new LedgerError("That account cannot be used here", 422, { code: "pluggy.account_type" });
  return account;
}

export async function createPluggyItem(userId: string, input: { label: string; itemId: string; entityKind: EntityType }, db: DbClient) {
  const itemId = assertItemId(input.itemId);
  const label = input.label.trim();
  if (!label) throw new LedgerError("A label is required", 422, { code: "pluggy.label" });
  const syncCutoff = parseLocalDate(formatDateOnly(new Date()));
  return db.pluggyItem.create({ data: { userId, label, itemId, entityKind: input.entityKind, syncCutoff } });
}

export async function updatePluggyItem(
  userId: string,
  id: string,
  patch: { label?: string; itemId?: string; entityKind?: EntityType; brokerageAccountId?: string | null; incomeCategoryId?: string | null; syncCutoff?: string | null },
  db: DbClient,
) {
  const item = await ownedItem(userId, id, db);
  const entityKind = patch.entityKind ?? item.entityKind;
  const data: {
    label?: string;
    itemId?: string;
    entityKind?: EntityType;
    brokerageAccountId?: string | null;
    incomeCategoryId?: string | null;
    syncCutoff?: Date | null;
    status?: "idle";
    lastError?: null;
  } = {};
  if (patch.label !== undefined) {
    const label = patch.label.trim();
    if (!label) throw new LedgerError("A label is required", 422, { code: "pluggy.label" });
    data.label = label;
  }
  if (patch.itemId !== undefined) {
    data.itemId = assertItemId(patch.itemId);
    if (data.itemId !== item.itemId) {
      data.status = "idle";
      data.lastError = null;
    }
  }
  if (patch.entityKind !== undefined && patch.entityKind !== item.entityKind) {
    data.entityKind = patch.entityKind;
    data.brokerageAccountId = null;
    data.incomeCategoryId = null;
    await db.pluggyAccountLink.updateMany({ where: { itemRowId: id }, data: { capitalAccountId: null } });
  }
  if (patch.brokerageAccountId !== undefined) {
    if (patch.brokerageAccountId === null) data.brokerageAccountId = null;
    else {
      await accountOfKind(userId, patch.brokerageAccountId, entityKind, ["brokerage"], db);
      data.brokerageAccountId = patch.brokerageAccountId;
    }
  }
  if (patch.syncCutoff !== undefined) {
    data.syncCutoff = patch.syncCutoff === null ? null : parseLocalDate(patch.syncCutoff);
  }
  if (patch.incomeCategoryId !== undefined) {
    if (patch.incomeCategoryId === null) data.incomeCategoryId = null;
    else {
      const category = await db.category.findFirst({ where: { id: patch.incomeCategoryId, userId, type: "income", isArchived: false } });
      if (!category) throw new LedgerError("Category not found", 404, { code: "category.not_found" });
      data.incomeCategoryId = category.id;
    }
  }
  return db.pluggyItem.update({ where: { id }, data });
}

export async function deletePluggyItem(userId: string, id: string, db: DbClient) {
  await ownedItem(userId, id, db);
  await db.pluggyItem.delete({ where: { id } });
}

export async function mapPluggyAccount(userId: string, linkId: string, capitalAccountId: string | null, db: DbClient) {
  const link = await db.pluggyAccountLink.findFirst({ where: { id: linkId }, include: { item: true } });
  if (!link || link.item.userId !== userId) throw new LedgerError("Account link not found", 404, { code: "pluggy.link_not_found" });
  if (capitalAccountId === null) {
    return db.pluggyAccountLink.update({ where: { id: linkId }, data: { capitalAccountId: null } });
  }
  const types = link.type === "CREDIT" ? ["credit_card"] : ["checking", "cash", "brokerage"];
  await accountOfKind(userId, capitalAccountId, link.item.entityKind, types, db);
  return db.pluggyAccountLink.update({ where: { id: linkId }, data: { capitalAccountId } });
}

export async function resolvePluggyReview(
  userId: string,
  reviewId: string,
  action: "ignore" | "link" | "confirm",
  ledgerEntryId: string | null,
  db: DbClient,
  patch: { incomeType?: PassiveIncomeType; origin?: DividendOrigin | null } = {},
) {
  const review = await db.pluggyReview.findFirst({ where: { id: reviewId, userId } });
  if (!review) throw new LedgerError("Review not found", 404, { code: "pluggy.review_not_found" });
  if (review.status !== "open") return review;
  if (action === "link") {
    if (!ledgerEntryId) throw new LedgerError("Choose the existing entry", 422, { code: "pluggy.link_target" });
    const entry = await db.ledgerEntry.findFirst({ where: { id: ledgerEntryId, userId, deletedAt: null } });
    if (!entry) throw new LedgerError("Entry not found", 404, { code: "entry.not_found" });
    const draft = review.draft as { pluggyId?: string };
    if (draft.pluggyId) {
      await db.pluggyExternalRef.upsert({
        where: { userId_pluggyId: { userId, pluggyId: draft.pluggyId } },
        create: { userId, pluggyId: draft.pluggyId, ledgerEntryId, matchKind: "linked" },
        update: { ledgerEntryId, matchKind: "linked" },
      });
    }
  }
  if (action === "confirm") {
    const draft = review.draft as { operationId?: string; event?: string };
    if (draft.event === "amortization" || draft.event === "buy" || draft.event === "sell" || draft.event === "skip") {
      throw new LedgerError("Amortization, a sale or a redemption is not income", 422, { code: "pluggy.not_income" });
    }
    if (review.kind !== "low_confidence") {
      throw new LedgerError("Only an uncertain classification can be confirmed", 422, { code: "pluggy.not_income" });
    }
    if (draft.operationId) {
      await db.investmentOperation.updateMany({
        where: { id: draft.operationId, holding: { account: { userId } } },
        data: { classificationSource: "manual", syncLocked: true },
      });
    } else {
      await bookConfirmedIncome(userId, review.draft, patch, db, review.itemRowId);
    }
  }
  return db.pluggyReview.update({
    where: { id: reviewId },
    data: { status: action === "ignore" ? "ignored" : "resolved", resolvedAt: new Date() },
  });
}
