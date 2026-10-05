import { z } from "zod";
import { defineTool } from "../registry";
import { createAccount, updateAccount } from "@capital/server/modules/ledger/services/accounts";
import { fetchEntityForAgent } from "../../../data/queries/fetch-entity-for-agent";

export const manageInvestmentAccount = defineTool({
  name: "manage_investment_account",
  description:
    "Create a new brokerage/investment account, rename it, or activate/deactivate it. Does NOT require plan confirmation - each action is low-risk and fully reversible (deactivate instead of delete keeps history intact), and every call is audited. Deactivating is the way to remove an account from view; there is no destructive delete here on purpose - accounts can carry years of holdings and transactions.",
  inputSchema: z.object({
    action: z.enum(["create", "update", "set_active"]),
    accountId: z.string().optional(),
    name: z.string().optional(),
    broker: z.string().optional(),
    entityType: z.enum(["business", "personal"]).optional(),
    currency: z.string().optional(),
    businessId: z.string().optional(),
    personalAccountId: z.string().optional(),
    isActive: z.boolean().optional(),
  }),
  access: "write_domain",
  handler: async (ctx, input) => {
    if (input.action === "create") {
      if (!input.name) throw new Error("name is required to create an investment account");
      if (!input.entityType) throw new Error("entityType is required to create an investment account");
      if (!input.currency || input.currency.length !== 3) throw new Error("currency must be a 3-letter ISO code");
      const entityId = input.entityType === "business" ? input.businessId : input.personalAccountId;
      if (!entityId) {
        throw new Error(input.entityType === "business" ? "businessId is required when entityType is business" : "personalAccountId is required when entityType is personal");
      }
      // The model's input is untrusted: the entity must be the user's.
      const entity = await fetchEntityForAgent(ctx.userId, input.entityType, entityId, ctx.db);
      if (!entity) throw new Error(`${input.entityType} entity ${entityId} not found or access denied`);
      const account = await createAccount(ctx.userId, { entityId, type: "brokerage", name: input.name, institution: input.broker ?? null, currency: input.currency }, ctx.db);
      return { account, createdRecords: [{ model: "Account", id: account.id }] };
    }

    if (!input.accountId) throw new Error(`accountId is required for action "${input.action}"`);
    const existing = await ctx.db.account.findFirst({ where: { id: input.accountId, userId: ctx.userId, type: "brokerage" } });
    if (!existing) throw new Error("Investment account not found or access denied");

    if (input.action === "set_active") {
      if (input.isActive === undefined) throw new Error("isActive is required for action \"set_active\"");
      const account = await updateAccount(ctx.userId, input.accountId, { archived: !input.isActive }, ctx.db);
      return { account, createdRecords: [{ model: "Account", id: account.id }] };
    }

    const account = await updateAccount(
      ctx.userId,
      input.accountId,
      { ...(input.name && { name: input.name }), ...(input.broker !== undefined && { institution: input.broker }), ...(input.currency && { currency: input.currency }) },
      ctx.db
    );
    return { account, createdRecords: [{ model: "Account", id: account.id }] };
  },
});
