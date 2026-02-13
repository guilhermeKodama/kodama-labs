import type { PrismaClient } from "@prisma/client";
import type { DbClient } from "@capital/server/lib/prisma";

interface FundInvestmentAccountInput {
  accountId: string;
  amount: number;
  currency: string;
  exchangeRate?: number;
  description?: string;
  date: Date;
}

/**
 * Fund an investment account by transferring money from the owning entity's
 * checking account.
 *
 * Creates:
 *   1. An expense Transaction on the entity (business or personal)
 *   2. Increases the investment account's cashBalance
 */
export async function fundInvestmentAccount(
  userId: string,
  input: FundInvestmentAccountInput,
  db: PrismaClient
) {
  // Verify user owns the account
  const account = await db.investmentAccount.findFirst({
    where: { id: input.accountId, userId },
    select: {
      id: true,
      name: true,
      entityType: true,
      businessId: true,
      personalAccountId: true,
      currency: true,
    },
  });

  if (!account) {
    throw new Error("Investment account not found or access denied");
  }

  return db.$transaction(async (tx: DbClient) => {
    // 1. Create expense transaction on the entity
    const description = input.description || `Fund investment account: ${account.name}`;
    const linkedTx = await tx.transaction.create({
      data: {
        entityType: account.entityType,
        type: "expense",
        amount: input.amount,
        currency: input.currency,
        exchangeRate: input.exchangeRate ?? 1,
        description,
        category: "Investment",
        date: input.date,
        isTaxDeductible: false,
        businessId: account.businessId ?? undefined,
        personalAccountId: account.personalAccountId ?? undefined,
      },
    });

    // 2. Increase the investment account's cash balance
    const updatedAccount = await tx.investmentAccount.update({
      where: { id: input.accountId },
      data: { cashBalance: { increment: input.amount } },
    });

    return {
      account: updatedAccount,
      linkedTransaction: linkedTx,
    };
  });
}

interface WithdrawInvestmentAccountInput {
  accountId: string;
  amount: number;
  currency: string;
  exchangeRate?: number;
  description?: string;
  date: Date;
}

/**
 * Withdraw from an investment account, transferring money back to the
 * owning entity's checking account.
 *
 * Creates:
 *   1. An income Transaction on the entity (business or personal)
 *   2. Decreases the investment account's cashBalance
 */
export async function withdrawInvestmentAccount(
  userId: string,
  input: WithdrawInvestmentAccountInput,
  db: PrismaClient
) {
  // Verify user owns the account
  const account = await db.investmentAccount.findFirst({
    where: { id: input.accountId, userId },
    select: {
      id: true,
      name: true,
      entityType: true,
      businessId: true,
      personalAccountId: true,
      currency: true,
      cashBalance: true,
    },
  });

  if (!account) {
    throw new Error("Investment account not found or access denied");
  }

  if (account.cashBalance < input.amount) {
    throw new Error("Insufficient cash balance in investment account");
  }

  return db.$transaction(async (tx: DbClient) => {
    // 1. Create income transaction on the entity
    const description = input.description || `Withdraw from investment account: ${account.name}`;
    const linkedTx = await tx.transaction.create({
      data: {
        entityType: account.entityType,
        type: "income",
        amount: input.amount,
        currency: input.currency,
        exchangeRate: input.exchangeRate ?? 1,
        description,
        category: "Investment",
        date: input.date,
        isTaxDeductible: false,
        businessId: account.businessId ?? undefined,
        personalAccountId: account.personalAccountId ?? undefined,
      },
    });

    // 2. Decrease the investment account's cash balance
    const updatedAccount = await tx.investmentAccount.update({
      where: { id: input.accountId },
      data: { cashBalance: { decrement: input.amount } },
    });

    return {
      account: updatedAccount,
      linkedTransaction: linkedTx,
    };
  });
}
