import { z } from "zod";
import { defineTool } from "../registry";
import { createCreditCardTool, updateCreditCardTool } from "@capital/server/modules/mcp/tools/credit-cards";
import { updateAccount } from "@capital/server/modules/ledger/services/accounts";

export const manageCreditCard = defineTool({
  name: "manage_credit_card",
  description:
    "Create a new credit card, edit one, or activate/deactivate it. Does NOT require plan confirmation - each action is low-risk and fully reversible (deactivate instead of delete keeps statements and installment history intact), and every call is audited. There is no destructive delete here on purpose - a card can carry years of statements.",
  inputSchema: z.object({
    action: z.enum(["create", "update", "set_active"]),
    cardId: z.string().optional(),
    bankName: z.string().optional(),
    lastFourDigits: z.string().optional(),
    nickname: z.string().optional(),
    creditLimit: z.number().optional(),
    closingDay: z.number().int().min(1).max(31).optional(),
    dueDay: z.number().int().min(1).max(31).optional(),
    currency: z.string().optional(),
    entityType: z.enum(["business", "personal"]).optional(),
    businessId: z.string().optional(),
    personalAccountId: z.string().optional(),
    isActive: z.boolean().optional(),
  }),
  access: "write_domain",
  handler: async (ctx, input) => {
    if (input.action === "create") {
      if (!input.bankName) throw new Error("bankName is required to create a credit card");
      if (!input.lastFourDigits) throw new Error("lastFourDigits is required to create a credit card");
      if (input.creditLimit === undefined) throw new Error("creditLimit is required to create a credit card");
      if (input.closingDay === undefined) throw new Error("closingDay is required to create a credit card");
      if (input.dueDay === undefined) throw new Error("dueDay is required to create a credit card");
      if (!input.currency || input.currency.length !== 3) throw new Error("currency must be a 3-letter ISO code");
      if (!input.entityType) throw new Error("entityType is required to create a credit card");
      const card = await createCreditCardTool(
        ctx.userId,
        {
          entityType: input.entityType,
          bankName: input.bankName,
          lastFourDigits: input.lastFourDigits,
          nickname: input.nickname,
          creditLimit: input.creditLimit,
          closingDay: input.closingDay,
          dueDay: input.dueDay,
          currency: input.currency,
          businessId: input.businessId,
          personalAccountId: input.personalAccountId,
        },
        ctx.db
      );
      return { card, createdRecords: [{ model: "Account", id: card.id }] };
    }

    if (!input.cardId) throw new Error(`cardId is required for action "${input.action}"`);

    if (input.action === "set_active") {
      if (input.isActive === undefined) throw new Error("isActive is required for action \"set_active\"");
      const card = await updateCreditCardTool(ctx.userId, { id: input.cardId, isActive: input.isActive }, ctx.db);
      return { card, createdRecords: [{ model: "Account", id: card.id }] };
    }

    if (input.creditLimit !== undefined || input.currency) {
      const owned = await ctx.db.account.findFirst({ where: { id: input.cardId, userId: ctx.userId, type: "credit_card" } });
      if (!owned) throw new Error("Credit card not found or access denied");
      await updateAccount(ctx.userId, owned.id, { ...(input.creditLimit !== undefined && { creditLimit: input.creditLimit }), ...(input.currency && { currency: input.currency }) }, ctx.db);
    }
    const card = await updateCreditCardTool(
      ctx.userId,
      { id: input.cardId, bankName: input.bankName, lastFourDigits: input.lastFourDigits, nickname: input.nickname, closingDay: input.closingDay, dueDay: input.dueDay },
      ctx.db
    );
    return { card, createdRecords: [{ model: "Account", id: card.id }] };
  },
});
