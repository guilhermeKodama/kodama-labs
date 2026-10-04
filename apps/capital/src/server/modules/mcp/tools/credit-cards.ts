import type { EntityType } from "@/generated/prisma";
import type { DbClient } from "@capital/server/lib/prisma";
import { createCreditCard } from "../../credit-cards/services/create-credit-card";
import { updateCreditCardService } from "../../credit-cards/services/update-credit-card";
import { fetchCreditCards } from "../../credit-cards/data/queries/fetch-credit-cards";

export interface ListCreditCardsParams {
  accountId?: string;
  entityType?: EntityType;
  lastFourDigits?: string;
}

export interface CreateCreditCardParams {
  entityType: EntityType;
  bankName: string;
  lastFourDigits: string;
  nickname?: string;
  creditLimit: number;
  closingDay: number;
  dueDay: number;
  color?: string;
  currency: string;
  businessId?: string;
  personalAccountId?: string;
}

export interface UpdateCreditCardParams {
  id: string;
  bankName?: string;
  nickname?: string;
  lastFourDigits?: string;
  closingDay?: number;
  dueDay?: number;
  isActive?: boolean;
}

interface CardRow {
  id: string;
  bankName: string;
  nickname: string | null;
  lastFourDigits: string;
  currency: string;
  isActive: boolean;
  creditLimit: number;
  closingDay: number;
  dueDay: number;
  entityType: EntityType;
  businessId: string | null;
  personalAccountId: string | null;
  business?: { name: string } | null;
}

function toMcpCard(card: CardRow, latestStatementMonth: string | null) {
  return {
    id: card.id,
    bankName: card.bankName,
    nickname: card.nickname,
    lastFourDigits: card.lastFourDigits,
    currency: card.currency,
    isActive: card.isActive,
    creditLimit: card.creditLimit,
    closingDay: card.closingDay,
    dueDay: card.dueDay,
    entityType: card.entityType,
    businessId: card.businessId,
    personalAccountId: card.personalAccountId,
    ownerName: card.business?.name ?? (card.personalAccountId ? "Personal" : null),
    latestStatementMonth,
  };
}

async function latestStatementMonths(ids: string[], db: DbClient) {
  const months = new Map<string, string | null>();
  if (ids.length === 0) return months;
  const grouped = await db.creditCardStatement.groupBy({
    by: ["creditCardId"],
    where: { creditCardId: { in: ids } },
    _max: { month: true },
  });
  for (const row of grouped) {
    months.set(row.creditCardId, row._max.month);
  }
  return months;
}

async function loadCard(id: string, db: DbClient) {
  return db.creditCard.findUnique({
    where: { id },
    include: { business: { select: { name: true } } },
  });
}

/**
 * accountId is either an owned personal account or an owned business.
 * Budget lookup is personal-only and is not reused here.
 */
async function resolveAccountFilter(
  userId: string,
  accountId: string | undefined,
  entityType: EntityType | undefined,
  db: DbClient
) {
  if (!accountId) return { entityType };
  const personal = await db.personalAccount.findFirst({
    where: { id: accountId, userId },
    select: { id: true },
  });
  if (personal) {
    if (entityType && entityType !== "personal") {
      throw new Error("entityType does not match the account");
    }
    return { personalAccountId: accountId, entityType: "personal" as const };
  }
  const business = await db.business.findFirst({
    where: { id: accountId, userId },
    select: { id: true },
  });
  if (!business) {
    throw new Error("Account not found or access denied");
  }
  if (entityType && entityType !== "business") {
    throw new Error("entityType does not match the account");
  }
  return { businessId: accountId, entityType: "business" as const };
}

export async function listCreditCardsForMcp(
  userId: string,
  params: ListCreditCardsParams,
  db: DbClient
) {
  const account = await resolveAccountFilter(userId, params.accountId, params.entityType, db);
  const cards = await fetchCreditCards(
    userId,
    {
      ...account,
      lastFourDigits: params.lastFourDigits,
    },
    db
  );
  const months = await latestStatementMonths(cards.map((card) => card.id), db);
  return {
    creditCards: cards.map((card) => toMcpCard(card, months.get(card.id) ?? null)),
  };
}

export async function createCreditCardTool(
  userId: string,
  params: CreateCreditCardParams,
  db: DbClient
) {
  const card = await createCreditCard(userId, params, db);
  const loaded = await loadCard(card.id, db);
  if (!loaded) {
    throw new Error("Credit card not found");
  }
  return toMcpCard(loaded, null);
}

export async function updateCreditCardTool(
  userId: string,
  params: UpdateCreditCardParams,
  db: DbClient
) {
  const { id, ...input } = params;
  const card = await updateCreditCardService(userId, id, input, db);
  const loaded = await loadCard(card.id, db);
  if (!loaded) {
    throw new Error("Credit card not found");
  }
  const months = await latestStatementMonths([loaded.id], db);
  return toMcpCard(loaded, months.get(loaded.id) ?? null);
}
