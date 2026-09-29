import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

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
const BulkCreateTransactionsInputSchema = z.object({
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

const ListTransactionsInputSchema = z.object({
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  type: z.enum(["income", "expense", "investment"]).optional(),
  category: z.string().optional(),
  entityType: z.enum(["business", "personal"]).optional(),
  businessId: z.string().uuid().optional(),
  personalAccountId: z.string().uuid().optional(),
});

const UpdateTransactionInputSchema = z.object({
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

const DeleteTransactionInputSchema = z.object({
  id: z.string().uuid(),
});

const ListCategoriesInputSchema = z.object({
  type: z.enum(["income", "expense", "investment"]).optional(),
});

const AdjustPositionInputSchema = z.object({
  holdingId: z.string().uuid(),
  currentQuantity: z.number().nonnegative(),
  averageCost: z.number().nonnegative(),
  notes: z.string().optional(),
});

const AddInvestmentAssetInputSchema = z.object({
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
 * Create an MCP server for Capital accounting operations.
 *
 * This server follows the MCP specification and is designed to work with
 * Streamable HTTP transport in stateless mode.
 */
export function createCapitalMcpServer(userId: string, db: DbClient) {
  const server = new McpServer(
    {
      name: "capital-accounting",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register tool: bulk_create_transactions
  server.registerTool(
    "bulk_create_transactions",
    {
      description:
        "Bulk create Personal transactions with automatic duplicate detection. " +
        "Duplicates are detected by matching date + amount + description against existing " +
        "transactions and within the batch. Supports dry-run mode to preview what would " +
        "be created without writing to the database. Example: Create 15 dividend payments " +
        "from XP Investimentos statement.",
      inputSchema: BulkCreateTransactionsInputSchema,
    },
    async ({ transactions, dryRun }) => {
      const result = await bulkCreateTransactions(
        userId,
        transactions,
        dryRun,
        db
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // Register tool: list_transactions
  server.registerTool(
    "list_transactions",
    {
      description:
        "List and search transactions by date range, type, and category. Returns " +
        "individual transactions plus monthly totals grouped by type and category. " +
        "Example: List all Income/Dividends transactions in September 2026.",
      inputSchema: ListTransactionsInputSchema,
    },
    async (params) => {
      const result = await listTransactions(userId, params, db);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // Register tool: update_transaction
  server.registerTool(
    "update_transaction",
    {
      description:
        "Update an existing transaction by ID. Can modify type, amount, currency, " +
        "exchange rate, description, category, date, or tax deductible status.",
      inputSchema: UpdateTransactionInputSchema,
    },
    async (params) => {
      const result = await updateTransactionTool(userId, params, db);
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
  );

  // Register tool: delete_transaction
  server.registerTool(
    "delete_transaction",
    {
      description:
        "Delete a transaction by ID. Use with caution - this action cannot be undone.",
      inputSchema: DeleteTransactionInputSchema,
    },
    async ({ id }) => {
      await deleteTransactionTool(userId, id, db);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, id }),
          },
        ],
      };
    }
  );

  // Register tool: list_categories
  server.registerTool(
    "list_categories",
    {
      description:
        "List all available categories, optionally filtered by transaction type " +
        "(income, expense, investment). Categories include system defaults and " +
        "user-created ones. Example categories: 'Dividends' (income), 'Groceries' " +
        "(expense), 'Stocks' (investment).",
      inputSchema: ListCategoriesInputSchema,
    },
    async ({ type }) => {
      const result = await listCategoriesForMcp(userId, type, db);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // Register tool: list_accounts
  server.registerTool(
    "list_accounts",
    {
      description:
        "List all accounts (businesses and personal account) that can receive " +
        "transactions. Returns business entities with their names and the personal " +
        "account. Use the returned IDs when creating transactions.",
      inputSchema: z.object({}),
    },
    async () => {
      const result = await listAccounts(userId, db);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // Register tool: get_valid_types
  server.registerTool(
    "get_valid_types",
    {
      description:
        "Get the list of valid transaction types: income, expense, investment. " +
        "Use these when filtering or creating transactions.",
      inputSchema: z.object({}),
    },
    async () => {
      const result = getValidTypes();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // Register tool: list_investment_positions
  server.registerTool(
    "list_investment_positions",
    {
      description:
        "List all active investment positions with quantity, average cost, current " +
        "value, and unrealized gain. Shows Brazilian FIIs like PMLL11, PVBI11, stocks, " +
        "and other assets. Example: PMLL11 shows 164 cotas but broker has 174.",
      inputSchema: z.object({}),
    },
    async () => {
      const result = await listInvestmentPositions(userId, db);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // Register tool: adjust_position
  server.registerTool(
    "adjust_position",
    {
      description:
        "Manually adjust an investment position's quantity and average cost. Use " +
        "when the broker statement shows different values than recorded. Records an " +
        "audit trail transaction. Example: Update PMLL11 from 164 to 174 cotas.",
      inputSchema: AdjustPositionInputSchema,
    },
    async (params) => {
      const result = await adjustPosition(userId, params, db);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // Register tool: add_investment_asset
  server.registerTool(
    "add_investment_asset",
    {
      description:
        "Add a new asset/position to an investment account. Use when a new Brazilian " +
        "FII like PVBI11 is missing from the system. Requires account ID, ticker, name, " +
        "and asset class (e.g., 'fii' for Brazilian real estate funds).",
      inputSchema: AddInvestmentAssetInputSchema,
    },
    async (params) => {
      const result = await addInvestmentAsset(userId, params, db);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  return server;
}
