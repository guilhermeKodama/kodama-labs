import type { Account, EntityType } from "@/generated/prisma";
import type { DbClient } from "@capital/server/lib/prisma";
import { createAccount, updateAccount } from "../../ledger/services/accounts";
import { getDefaultAccount, legacyEntityRef, resolveLegacyEntity } from "../../ledger/services/entities";
import { toNumber } from "../../ledger/lib/money";

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

/**
 * A card is an Account of type credit_card: institution is the issuer,
 * externalId the last 4 digits, name the nickname (or "<bank> ****1234").
 */
type CardAccount = Account & { entity: { id: string; kind: EntityType; name: string } };
const defaultCardName = (bank: string, last4: string) => `${bank} ****${last4}`;

function toMcpCard(card: CardAccount, latestStatementMonth: string | null) {
  const ref = legacyEntityRef(card.entity);
  const bankName = card.institution ?? card.name;
  const last4 = card.externalId ?? "";
  return {
    id: card.id,
    bankName,
    nickname: card.name === defaultCardName(bankName, last4) ? null : card.name,
    lastFourDigits: last4,
    currency: card.currency,
    isActive: card.archivedAt === null,
    creditLimit: toNumber(card.creditLimit ?? 0),
    closingDay: card.closingDay ?? 1,
    dueDay: card.dueDay ?? 1,
    entityType: ref.entityType,
    businessId: ref.businessId,
    personalAccountId: ref.personalAccountId,
    ownerName: ref.entityType === "business" ? card.entity.name : "Personal",
    latestStatementMonth,
  };
}

async function latestStatementMonths(ids: string[], db: DbClient) {
  const grouped = ids.length ? await db.cardStatement.groupBy({ by: ["accountId"], where: { accountId: { in: ids } }, _max: { month: true } }) : [];
  return new Map(grouped.map((g) => [g.accountId, g._max.month]));
}

const CARD_INCLUDE = { entity: { select: { id: true, kind: true, name: true } } } as const;

export async function listCreditCardsForMcp(userId: string, params: ListCreditCardsParams, db: DbClient) {
  if (params.accountId) {
    const entity = await db.entity.findFirst({ where: { id: params.accountId, userId } });
    if (!entity) throw new Error("Account not found or access denied");
    if (params.entityType && params.entityType !== entity.kind) throw new Error("entityType does not match the account");
  }
  const cards = await db.account.findMany({
    where: {
      userId,
      type: "credit_card",
      ...(params.accountId && { entityId: params.accountId }),
      ...(params.entityType && { entity: { kind: params.entityType } }),
      ...(params.lastFourDigits && { externalId: params.lastFourDigits }),
    },
    include: CARD_INCLUDE,
    orderBy: { createdAt: "asc" },
  });
  const months = await latestStatementMonths(cards.map((c) => c.id), db);
  return { creditCards: cards.map((c) => toMcpCard(c, months.get(c.id) ?? null)) };
}

export async function createCreditCardTool(userId: string, params: CreateCreditCardParams, db: DbClient) {
  if (!/^\d{4}$/.test(params.lastFourDigits)) throw new Error("lastFourDigits must be exactly 4 digits");
  if (params.entityType === "personal" && !params.personalAccountId) throw new Error("personalAccountId is required for personal cards");
  if (params.entityType === "business" && !params.businessId) throw new Error("businessId is required for business cards");
  const entity = await resolveLegacyEntity(userId, params, db);
  const payFrom = await getDefaultAccount(entity, db);
  const card = await createAccount(
    userId,
    {
      entityId: entity.id,
      type: "credit_card",
      name: params.nickname?.trim() || defaultCardName(params.bankName, params.lastFourDigits),
      institution: params.bankName,
      externalId: params.lastFourDigits,
      currency: params.currency,
      creditLimit: params.creditLimit,
      closingDay: params.closingDay,
      dueDay: params.dueDay,
      color: params.color ?? null,
      payFromAccountId: payFrom.id,
    },
    db
  );
  return toMcpCard(await db.account.findUniqueOrThrow({ where: { id: card.id }, include: CARD_INCLUDE }), null);
}

export async function updateCreditCardTool(userId: string, params: UpdateCreditCardParams, db: DbClient) {
  const card = await db.account.findFirst({ where: { id: params.id, userId, type: "credit_card" } });
  if (!card) throw new Error("Credit card not found or access denied");
  if (params.lastFourDigits && !/^\d{4}$/.test(params.lastFourDigits)) throw new Error("lastFourDigits must be exactly 4 digits");
  const bank = params.bankName ?? card.institution ?? card.name;
  const last4 = params.lastFourDigits ?? card.externalId ?? "";
  const hadDefaultName = card.name === defaultCardName(card.institution ?? card.name, card.externalId ?? "");
  const name = params.nickname !== undefined ? params.nickname.trim() || defaultCardName(bank, last4) : hadDefaultName ? defaultCardName(bank, last4) : card.name;
  await updateAccount(
    userId,
    card.id,
    {
      name,
      institution: bank,
      externalId: last4,
      ...(params.closingDay !== undefined && { closingDay: params.closingDay }),
      ...(params.dueDay !== undefined && { dueDay: params.dueDay }),
      ...(params.isActive !== undefined && { archived: !params.isActive }),
    },
    db
  );
  const loaded = await db.account.findUniqueOrThrow({ where: { id: card.id }, include: CARD_INCLUDE });
  const months = await latestStatementMonths([card.id], db);
  return toMcpCard(loaded, months.get(card.id) ?? null);
}
