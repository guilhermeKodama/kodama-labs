import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { DbClient } from "@capital/server/lib/prisma";
import { bulkCreateTransactions } from "../tools/bulk-create-transactions";
import { listTransactions } from "../tools/list-transactions";
import {
  updateTransactionTool,
  deleteTransactionTool,
} from "../tools/manage-transactions";
import { bulkUpdateTransactions } from "../tools/bulk-update-transactions";
import {
  listCategoriesForMcp,
  listAccounts,
  getValidTypes,
} from "../tools/metadata";
import {
  createCategoryTool,
  updateCategoryTool,
  deleteCategoryTool,
  mergeCategoryTool,
} from "../tools/categories";
import { findOrphanTransactions } from "../lib/category-validation";
import {
  getUserSettings,
  updateUserSettings,
  updateAccountSettings,
} from "../tools/settings";
import {
  listInvestmentPositions,
  adjustPosition,
  addInvestmentAsset,
} from "../tools/investments";
import {
  attachReceipt,
  listTransactionAttachments,
  deleteAttachment,
} from "../tools/attachments";
import {
  listBudgets,
  createBudget,
  updateBudget,
  deleteBudget,
  getBudgetStatus,
} from "../tools/budgets";
import {
  MAX_FILE_SIZE_BYTES,
  ALLOWED_MIME_TYPES,
} from "../../attachments/constants";

// Date string schema that accepts both YYYY-MM-DD and full ISO strings
const DateStringSchema = z.string().refine(
  (val) => {
    // Accept YYYY-MM-DD format
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return true;
    // Accept ISO datetime format
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/.test(val)) return true;
    return false;
  },
  { message: "Date must be in YYYY-MM-DD or ISO datetime format" }
);

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
      date: DateStringSchema,
      isTaxDeductible: z.boolean().optional(),
      businessId: z.string().uuid().optional(),
      personalAccountId: z.string().uuid().optional(),
    })
  ),
  dryRun: z.boolean().default(false),
});

const ListTransactionsInputSchema = z.object({
  dateFrom: DateStringSchema.optional(),
  dateTo: DateStringSchema.optional(),
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
  date: DateStringSchema.optional(),
  isTaxDeductible: z.boolean().optional(),
});

const DeleteTransactionInputSchema = z.object({
  id: z.string().uuid(),
});

const ListCategoriesInputSchema = z.object({
  type: z.enum(["income", "expense", "investment"]).optional(),
});

const CreateCategoryInputSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["income", "expense", "investment"]),
  color: z.string().optional(),
  icon: z.string().optional(),
});

const UpdateCategoryInputSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).optional(),
  color: z.string().optional(),
  icon: z.string().optional(),
});

const DeleteCategoryInputSchema = z.object({
  id: z.string().uuid(),
  reassignTo: z.string().uuid().optional(),
});

const MergeCategoriesInputSchema = z.object({
  fromId: z.string().uuid(),
  toId: z.string().uuid(),
});

const BulkUpdateTransactionsInputSchema = z.object({
  updates: z.array(
    z.object({
      id: z.string().uuid(),
      type: z.enum(["income", "expense", "investment"]).optional(),
      amount: z.number().positive().optional(),
      currency: z.string().length(3).optional(),
      exchangeRate: z.number().positive().optional(),
      description: z.string().min(1).optional(),
      category: z.string().min(1).optional(),
      date: DateStringSchema.optional(),
      isTaxDeductible: z.boolean().optional(),
    })
  ),
  dryRun: z.boolean().default(false),
});

const UpdateAccountInputSchema = z.object({
  accountId: z.string().uuid(),
  entityType: z.enum(["personal", "business"]),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  defaultCurrency: z.string().length(3).optional(),
  color: z.string().optional(),
  taxRate: z.number().min(0).max(1).optional(),
  initialBalance: z.number().optional(),
});

const UpdateUserSettingsInputSchema = z.object({
  baseCurrency: z.string().length(3).optional(),
  theme: z.string().optional(),
  dateFormat: z.string().optional(),
  numberFormat: z.string().optional(),
  timezone: z.string().optional(),
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

const AttachReceiptInputSchema = z.object({
  transactionId: z.string().uuid(),
  filename: z.string().min(1),
  mimeType: z.enum(Array.from(ALLOWED_MIME_TYPES) as [string, ...string[]]),
  contentBase64: z.string().min(1),
});

const ListAttachmentsInputSchema = z.object({
  transactionId: z.string().uuid(),
});

const DeleteAttachmentInputSchema = z.object({
  attachmentId: z.string().uuid(),
});

const ListBudgetsInputSchema = z.object({
  accountId: z.string().uuid().optional(),
  category: z.string().optional(),
  effectiveDate: z.string().optional(), // YYYY-MM or YYYY-MM-DD
});

const CreateBudgetInputSchema = z.object({
  accountId: z.string().uuid(),
  category: z.string().min(1),
  amount: z.number().nonnegative(),
  currency: z.string().length(3),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD
});

const UpdateBudgetInputSchema = z.object({
  budgetId: z.string().uuid(),
  amount: z.number().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), // YYYY-MM-DD
  isActive: z.boolean().optional(),
});

const DeleteBudgetInputSchema = z.object({
  budgetId: z.string().uuid(),
});

const GetBudgetStatusInputSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/), // YYYY-MM
  accountId: z.string().uuid().optional(),
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

  // Register tool: attach_receipt
  server.registerTool(
    "attach_receipt",
    {
      description:
        "Attach a receipt (image or PDF) to a transaction via base64-encoded content. " +
        "Accepted mime types: application/pdf, image/jpeg, image/png, image/webp. " +
        `Maximum file size: ${Math.round(MAX_FILE_SIZE_BYTES / 1024 / 1024)} MB. ` +
        "Note: base64 encoding increases size by ~33%, so a 10 MB file becomes ~13.3 MB encoded. " +
        "The attachment will be stored using the same backend as the UI (local filesystem in dev, " +
        "Vercel Blob in production) and will be visible in the transaction detail page.",
      inputSchema: AttachReceiptInputSchema,
    },
    async (params) => {
      const result = await attachReceipt(userId, params, db);
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

  // Register tool: list_attachments
  server.registerTool(
    "list_attachments",
    {
      description:
        "List all attachments for a transaction. Returns attachment metadata including " +
        "ID, filename, mime type, size, and URL. Use this to check what's already attached " +
        "before uploading to avoid duplicates.",
      inputSchema: ListAttachmentsInputSchema,
    },
    async (params) => {
      const result = await listTransactionAttachments(userId, params, db);
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

  // Register tool: delete_attachment
  server.registerTool(
    "delete_attachment",
    {
      description:
        "Delete an attachment by ID. Verifies the attachment belongs to a transaction " +
        "owned by the authenticated user. This will remove both the database record and " +
        "the stored file (best-effort).",
      inputSchema: DeleteAttachmentInputSchema,
    },
    async (params) => {
      const result = await deleteAttachment(userId, params, db);
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

  // Register tool: create_category
  server.registerTool(
    "create_category",
    {
      description:
        "Create a new category for organizing transactions. Categories are per-user " +
        "and must have a type (income, expense, or investment). Optional color and icon " +
        "for visual organization.",
      inputSchema: CreateCategoryInputSchema,
    },
    async (params) => {
      const result = await createCategoryTool(userId, params, db);
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

  // Register tool: update_category
  server.registerTool(
    "update_category",
    {
      description:
        "Update an existing category's name, type, color, or icon. NAME CHANGES CASCADE atomically " +
        "to all tables (transactions, recurring transactions, budgets, bill transactions, mappings). " +
        "Renaming to an existing category name for the same type is rejected (use merge_categories instead). " +
        "TYPE CHANGES are only allowed when no transactions use the category. LOCALIZATION: System and " +
        "default categories CAN be renamed (e.g., 'Credit Card' → 'Cartão de Crédito'). The system uses " +
        "skipDuplicates when seeding, so renamed categories won't be duplicated on next login.",
      inputSchema: UpdateCategoryInputSchema,
    },
    async (params) => {
      const result = await updateCategoryTool(userId, params, db);
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

  // Register tool: delete_category
  server.registerTool(
    "delete_category",
    {
      description:
        "Delete a category. Requires 'reassignTo' (category ID) if any transactions or " +
        "budgets use this category - they will be reassigned first. Without reassignTo, " +
        "fails with counts of linked transactions and budgets. Cannot delete categories " +
        "with systemKey (required by the app).",
      inputSchema: DeleteCategoryInputSchema,
    },
    async (params) => {
      const result = await deleteCategoryTool(userId, params, db);
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

  // Register tool: merge_categories
  server.registerTool(
    "merge_categories",
    {
      description:
        "Merge two categories by moving all transactions and budgets from 'fromId' to " +
        "'toId', then deleting 'fromId'. Categories must have the same type. Returns counts " +
        "of moved transactions and budgets. Cannot merge FROM categories with systemKey.",
      inputSchema: MergeCategoriesInputSchema,
    },
    async (params) => {
      const result = await mergeCategoryTool(userId, params, db);
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

  // Register tool: find_orphan_transactions
  server.registerTool(
    "find_orphan_transactions",
    {
      description:
        "Find transactions whose category doesn't match any existing category. Returns " +
        "counts grouped by category name and full transaction details. Useful for data " +
        "cleanup after imports or category changes.",
      inputSchema: z.object({}),
    },
    async () => {
      const result = await findOrphanTransactions(userId, db);
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

  // Register tool: bulk_update_transactions
  server.registerTool(
    "bulk_update_transactions",
    {
      description:
        "Bulk update transactions with all-or-nothing validation. Validates all updates " +
        "(ownership, categories) first, then applies changes in a database transaction. " +
        "Supports updating type, amount, currency, exchange rate, description, category, " +
        "date, and tax deductible status. Dates are normalized to noon UTC via parseLocalDate. " +
        "Returns per-transaction results. Example: Recategorize 95 transactions after reviewing " +
        "statement imports.",
      inputSchema: BulkUpdateTransactionsInputSchema,
    },
    async ({ updates, dryRun }) => {
      const result = await bulkUpdateTransactions(userId, updates, dryRun, db);
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

  // Register tool: get_settings
  server.registerTool(
    "get_settings",
    {
      description:
        "Get user-level settings: baseCurrency, theme, dateFormat, numberFormat, timezone. " +
        "These settings apply across all accounts.",
      inputSchema: z.object({}),
    },
    async () => {
      const result = await getUserSettings(userId, db);
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

  // Register tool: update_settings
  server.registerTool(
    "update_settings",
    {
      description:
        "Update user-level settings: baseCurrency, theme, dateFormat, numberFormat, timezone.",
      inputSchema: UpdateUserSettingsInputSchema,
    },
    async (params) => {
      const result = await updateUserSettings(userId, params, db);
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

  // Register tool: update_account
  server.registerTool(
    "update_account",
    {
      description:
        "Update account (personal or business) settings: name, description, defaultCurrency, " +
        "color, taxRate, initialBalance. IMPORTANT: Changing defaultCurrency requires " +
        "force: true when the account has existing transactions (guard against accidental changes). " +
        "Historical transaction amounts remain in their original currency as stored in the 'currency' field. " +
        "The defaultCurrency only affects what currency new transactions default to in the UI.",
      inputSchema: UpdateAccountInputSchema,
    },
    async (params) => {
      const { accountId, entityType, ...updates } = params;
      const result = await updateAccountSettings(userId, accountId, entityType, updates, db);
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

  // Register tool: list_budgets
  server.registerTool(
    "list_budgets",
    {
      description:
        "List budgets for an account, optionally filtered by category. " +
        "If effectiveDate (YYYY-MM or YYYY-MM-DD) is provided, returns only budgets effective at that date " +
        "(the most recent budget with effectiveFrom <= effectiveDate for each category). " +
        "Otherwise, returns all active budgets. Budgets support effective dating: multiple budgets can exist " +
        "for the same category with different effective dates, e.g., Shopping 2,800 BRL from Oct 2026, " +
        "2,000 BRL from Dec 2026, 1,500 BRL from Jan 2027.",
      inputSchema: ListBudgetsInputSchema,
    },
    async (params) => {
      const result = await listBudgets(userId, params, db);
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

  // Register tool: create_budget
  server.registerTool(
    "create_budget",
    {
      description:
        "Create a new budget for a category, effective from a specific date (YYYY-MM-DD). " +
        "The budget will apply to all months from effectiveFrom onwards until a newer budget " +
        "with a later effectiveFrom is created for the same category. Currency should typically be BRL. " +
        "Amount must be non-negative. Multiple budgets can exist for the same category with different " +
        "effective dates to handle budget changes over time.",
      inputSchema: CreateBudgetInputSchema,
    },
    async (params) => {
      const result = await createBudget(userId, params, db);
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

  // Register tool: update_budget
  server.registerTool(
    "update_budget",
    {
      description:
        "Update an existing budget. Can change amount, currency, effectiveFrom date, or isActive status. " +
        "Changing effectiveFrom will update when the budget takes effect. Setting isActive=false soft-deletes " +
        "the budget. Amount must be non-negative if provided.",
      inputSchema: UpdateBudgetInputSchema,
    },
    async (params) => {
      const result = await updateBudget(userId, params, db);
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

  // Register tool: delete_budget
  server.registerTool(
    "delete_budget",
    {
      description:
        "Delete a budget (soft delete by setting isActive=false). The budget will no longer appear in " +
        "budget status calculations or listings, but the record is retained in the database.",
      inputSchema: DeleteBudgetInputSchema,
    },
    async (params) => {
      const result = await deleteBudget(userId, params, db);
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

  // Register tool: get_budget_status
  server.registerTool(
    "get_budget_status",
    {
      description:
        "Get budget status for a specific month (YYYY-MM), comparing budgeted vs actual spending per category. " +
        "Returns summary (total budgeted, actual, remaining) and per-category breakdown with percentages. " +
        "Budgets are in BRL. Actual spending includes only expenses (not transfers or income) and is converted " +
        "to BRL using transaction exchange rates. For each category, returns the effective budget for that month " +
        "(most recent budget with effectiveFrom <= month start) and compares it to actual spending. " +
        "Categories are sorted by percentUsed descending (most over-budget first).",
      inputSchema: GetBudgetStatusInputSchema,
    },
    async (params) => {
      const result = await getBudgetStatus(userId, params, db);
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
