import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import type { DbClient } from "@capital/server/lib/prisma";
import { bulkCreateTransactions } from "../tools/bulk-create-transactions";
import { listTransactions } from "../tools/list-transactions";
import {
  updateTransactionTool,
  deleteTransactionTool,
} from "../tools/manage-transactions";
import {
  listCategoriesForMcp,
  listAccounts,
  getValidTypes,
} from "../tools/metadata";
import {
  listInvestmentPositions,
  adjustPosition,
  addInvestmentAsset,
} from "../tools/investments";

// Zod schemas for tool parameters
const BulkCreateTransactionsSchema = z.object({
  transactions: z.array(
    z.object({
      entityType: z.enum(["business", "personal"]),
      type: z.enum(["income", "expense", "investment"]),
      amount: z.number().positive(),
      currency: z.string().length(3),
      exchangeRate: z.number().positive().optional(),
      description: z.string().min(1),
      category: z.string().min(1),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      isTaxDeductible: z.boolean().optional(),
      businessId: z.string().uuid().optional(),
      personalAccountId: z.string().uuid().optional(),
    })
  ),
  dryRun: z.boolean().default(false),
});

const ListTransactionsSchema = z.object({
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  type: z.enum(["income", "expense", "investment"]).optional(),
  category: z.string().optional(),
  entityType: z.enum(["business", "personal"]).optional(),
  businessId: z.string().uuid().optional(),
  personalAccountId: z.string().uuid().optional(),
});

const UpdateTransactionSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(["income", "expense", "investment"]).optional(),
  amount: z.number().positive().optional(),
  currency: z.string().length(3).optional(),
  exchangeRate: z.number().positive().optional(),
  description: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  isTaxDeductible: z.boolean().optional(),
});

const DeleteTransactionSchema = z.object({
  id: z.string().uuid(),
});

const ListCategoriesSchema = z.object({
  type: z.enum(["income", "expense", "investment"]).optional(),
});

const AdjustPositionSchema = z.object({
  holdingId: z.string().uuid(),
  currentQuantity: z.number().nonnegative(),
  averageCost: z.number().nonnegative(),
  notes: z.string().optional(),
});

const AddInvestmentAssetSchema = z.object({
  accountId: z.string().uuid(),
  ticker: z.string().optional(),
  name: z.string().min(1),
  assetClass: z.enum([
    "stocks",
    "fii",
    "etf",
    "bdr",
    "fixed_income",
    "crypto",
    "savings",
    "international_stocks",
    "international_etf",
  ]),
  currency: z.string().length(3).optional(),
});

/**
 * MCP tool definitions for Capital accounting operations.
 */
export const TOOLS = [
  {
    name: "bulk_create_transactions",
    description:
      "Bulk create Personal transactions with automatic duplicate detection. " +
      "Duplicates are detected by matching date + amount + description against existing " +
      "transactions and within the batch. Supports dry-run mode to preview what would " +
      "be created without writing to the database. Example: Create 15 dividend payments " +
      "from XP Investimentos statement.",
    inputSchema: zodToJsonSchema(BulkCreateTransactionsSchema),
  },
  {
    name: "list_transactions",
    description:
      "List and search transactions by date range, type, and category. Returns " +
      "individual transactions plus monthly totals grouped by type and category. " +
      "Example: List all Income/Dividends transactions in September 2026.",
    inputSchema: zodToJsonSchema(ListTransactionsSchema),
  },
  {
    name: "update_transaction",
    description:
      "Update an existing transaction by ID. Can modify type, amount, currency, " +
      "exchange rate, description, category, date, or tax deductible status.",
    inputSchema: zodToJsonSchema(UpdateTransactionSchema),
  },
  {
    name: "delete_transaction",
    description:
      "Delete a transaction by ID. Use with caution - this action cannot be undone.",
    inputSchema: zodToJsonSchema(DeleteTransactionSchema),
  },
  {
    name: "list_categories",
    description:
      "List all available categories, optionally filtered by transaction type " +
      "(income, expense, investment). Categories include system defaults and " +
      "user-created ones. Example categories: 'Dividends' (income), 'Groceries' " +
      "(expense), 'Stocks' (investment).",
    inputSchema: zodToJsonSchema(ListCategoriesSchema),
  },
  {
    name: "list_accounts",
    description:
      "List all accounts (businesses and personal account) that can receive " +
      "transactions. Returns business entities with their names and the personal " +
      "account. Use the returned IDs when creating transactions.",
    inputSchema: zodToJsonSchema(z.object({})),
  },
  {
    name: "get_valid_types",
    description:
      "Get the list of valid transaction types: income, expense, investment. " +
      "Use these when filtering or creating transactions.",
    inputSchema: zodToJsonSchema(z.object({})),
  },
  {
    name: "list_investment_positions",
    description:
      "List all active investment positions with quantity, average cost, current " +
      "value, and unrealized gain. Shows Brazilian FIIs like PMLL11, PVBI11, stocks, " +
      "and other assets. Example: PMLL11 shows 164 cotas but broker has 174.",
    inputSchema: zodToJsonSchema(z.object({})),
  },
  {
    name: "adjust_position",
    description:
      "Manually adjust an investment position's quantity and average cost. Use " +
      "when the broker statement shows different values than recorded. Records an " +
      "audit trail transaction. Example: Update PMLL11 from 164 to 174 cotas.",
    inputSchema: zodToJsonSchema(AdjustPositionSchema),
  },
  {
    name: "add_investment_asset",
    description:
      "Add a new asset/position to an investment account. Use when a new Brazilian " +
      "FII like PVBI11 is missing from the system. Requires account ID, ticker, name, " +
      "and asset class (e.g., 'fii' for Brazilian real estate funds).",
    inputSchema: zodToJsonSchema(AddInvestmentAssetSchema),
  },
];

/**
 * Handle MCP tool calls directly without the full SDK server.
 * 
 * This implements a simplified MCP JSON-RPC handler that works with regular POST requests.
 */
export async function handleMcpRequest(
  userId: string,
  db: DbClient,
  request: { method: string; params?: unknown }
) {
  const { method, params } = request;

  switch (method) {
    case "tools/list": {
      return { tools: TOOLS };
    }

    case "tools/call": {
      const { name, arguments: args } = params;

      try {
        switch (name) {
          case "bulk_create_transactions": {
            const validated = BulkCreateTransactionsSchema.parse(args);
            const result = await bulkCreateTransactions(
              userId,
              validated.transactions,
              validated.dryRun,
              db
            );
            return {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            };
          }

          case "list_transactions": {
            const validated = ListTransactionsSchema.parse(args);
            const result = await listTransactions(userId, validated, db);
            return {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            };
          }

          case "update_transaction": {
            const validated = UpdateTransactionSchema.parse(args);
            const result = await updateTransactionTool(userId, validated, db);
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      id: result.id,
                      type: result.type,
                      amount: result.amount,
                      description: result.description,
                      category: result.category,
                      date: result.date,
                    },
                    null,
                    2
                  ),
                },
              ],
            };
          }

          case "delete_transaction": {
            const validated = DeleteTransactionSchema.parse(args);
            await deleteTransactionTool(userId, validated.id, db);
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({ success: true, id: validated.id }),
                },
              ],
            };
          }

          case "list_categories": {
            const validated = ListCategoriesSchema.parse(args);
            const result = await listCategoriesForMcp(userId, validated.type, db);
            return {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            };
          }

          case "list_accounts": {
            const result = await listAccounts(userId, db);
            return {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            };
          }

          case "get_valid_types": {
            const result = getValidTypes();
            return {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            };
          }

          case "list_investment_positions": {
            const result = await listInvestmentPositions(userId, db);
            return {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            };
          }

          case "adjust_position": {
            const validated = AdjustPositionSchema.parse(args);
            const result = await adjustPosition(userId, validated, db);
            return {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            };
          }

          case "add_investment_asset": {
            const validated = AddInvestmentAssetSchema.parse(args);
            const result = await addInvestmentAsset(userId, validated, db);
            return {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            };
          }

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new Error(`Invalid parameters: ${error.message}`);
        }
        throw error;
      }
    }

    default:
      throw new Error(`Unsupported method: ${method}`);
  }
}
