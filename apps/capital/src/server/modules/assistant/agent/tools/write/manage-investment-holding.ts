import { z } from "zod";
import { defineTool } from "../registry";
import { createInvestmentHolding } from "../../../../investments/services/create-investment-holding";
import { updateInvestmentHoldingService } from "../../../../investments/services/update-investment-holding";

export const manageInvestmentHolding = defineTool({
  name: "manage_investment_holding",
  description:
    "Create a new holding (position) inside an investment account, correct its metadata (name/ticker/asset class), or activate/deactivate it. Does NOT require plan confirmation - low-risk and reversible, every call is audited. currentQuantity/averageCost/totalInvested are never set directly here - they are always derived from the holding's transactions via record_investment_transaction, to keep them from drifting out of sync with real history.",
  inputSchema: z.object({
    action: z.enum(["create", "update", "set_active"]),
    holdingId: z.string().optional(),
    accountId: z.string().optional(),
    assetClass: z
      .enum([
        "stocks",
        "fii",
        "etf",
        "bdr",
        "fixed_income",
        "crypto",
        "savings",
        "international_stocks",
        "international_etf",
      ])
      .optional(),
    subType: z
      .enum([
        "cdb",
        "rdb",
        "lci",
        "lca",
        "cdi",
        "tesouro_selic",
        "tesouro_ipca",
        "tesouro_prefixado",
        "debenture",
      ])
      .optional(),
    ticker: z.string().optional(),
    name: z.string().optional(),
    currency: z.string().optional(),
    isActive: z.boolean().optional(),
  }),
  access: "write_domain",
  handler: async (ctx, input) => {
    if (input.action === "create") {
      if (!input.accountId) throw new Error("accountId is required to create a holding");
      if (!input.assetClass) throw new Error("assetClass is required to create a holding");
      if (!input.name) throw new Error("name is required to create a holding");
      if (!input.currency || input.currency.length !== 3) {
        throw new Error("currency must be a 3-letter ISO code");
      }

      const holding = await createInvestmentHolding(
        ctx.userId,
        {
          accountId: input.accountId,
          assetClass: input.assetClass,
          subType: input.subType,
          ticker: input.ticker,
          name: input.name,
          currency: input.currency,
        },
        ctx.db
      );

      return { holding, createdRecords: [{ model: "InvestmentHolding", id: holding.id }] };
    }

    if (!input.holdingId) throw new Error(`holdingId is required for action "${input.action}"`);

    if (input.action === "set_active") {
      if (input.isActive === undefined) throw new Error("isActive is required for action \"set_active\"");
      const holding = await updateInvestmentHoldingService(
        ctx.userId,
        input.holdingId,
        { isActive: input.isActive },
        ctx.db
      );
      return { holding, createdRecords: [{ model: "InvestmentHolding", id: holding.id }] };
    }

    // action === "update"
    const holding = await updateInvestmentHoldingService(
      ctx.userId,
      input.holdingId,
      {
        name: input.name,
        ticker: input.ticker,
        assetClass: input.assetClass,
        subType: input.subType,
        currency: input.currency,
      },
      ctx.db
    );
    return { holding, createdRecords: [{ model: "InvestmentHolding", id: holding.id }] };
  },
});
