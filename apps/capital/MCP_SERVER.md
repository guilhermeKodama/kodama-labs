# MCP Server for Remote AI Accounting Access

The Capital app exposes an MCP (Model Context Protocol) server at `/mcp` that allows external AI assistants (like Contador) to directly read and write accounting data through a standardized tool-calling interface.

## Overview

**Problem:** External AI assistants need to interact with accounting data but shouldn't use the web UI (entering 15 dividend payments one-by-one through forms is inefficient and error-prone).

**Solution:** MCP server with tools for bulk operations, duplicate detection, and direct database access through validated business logic.

## Data model behind the tools

The tools keep the contract they had before the ledger refactor (same names, same inputs). Underneath, everything is the ledger:

- **Entities.** `businessId` and `personalAccountId` are entity ids (`entities` table, `kind` business or personal). A transaction created for an entity lands on its main checking account ("Conta principal").
- **Transactions.** A "transaction" is a `LedgerEntry`. Tools take and return a positive `amount` plus `type`; stored amounts are signed (outflows negative) with a base-currency amount fixed when the entry is written. `category` is a category name resolved to a `categoryId`.
- **Credit cards.** A card is an `Account` of type `credit_card` (`bankName` = institution, `lastFourDigits` = externalId, nickname = name). Statement purchases are expenses on the card, counted on the statement's closing date. A settled bill payment is a `card_payment` transfer from the bank account to the card, so it never counts as an expense.
- **Undo and trash.** Writes made through these tools are recorded in undo batches. Deleting moves entries to the trash (restorable for 30 days) instead of removing them.
- **Rules.** Learned categorizations are `CategorizationRule` rows; merging or deleting a category moves its entries, budgets, recurring rules and rules by id.

## Endpoint

```
POST https://capital.kodamalabs.ai/mcp
```

The endpoint implements the **MCP Streamable HTTP transport** specification in stateless mode, compatible with standard MCP clients.

**Note:** The `/mcp` endpoint bypasses the Next.js session middleware (no `capital_session` cookie required) and is excluded from next-intl locale handling. Authentication is handled entirely through the two-layer auth described below.

## Authentication

Two layers of authentication are required:

### 1. Cloudflare Access (Service Tokens)

The production deployment is protected by Cloudflare Access. MCP clients must send service token headers:

```
CF-Access-Client-Id: <service-token-client-id>
CF-Access-Client-Secret: <service-token-secret>
```

**Setup in Cloudflare Dashboard:**

1. Navigate to Zero Trust → Access → Service Auth
2. Create a new Service Token with a descriptive name (e.g., "Contador MCP Client")
3. Save the Client ID and Client Secret (shown only once)
4. Go to Zero Trust → Access → Applications
5. Find the `capital.kodamalabs.ai` application
6. Add a new policy for the `/mcp` path:
   - Policy name: "MCP Service Token"
   - Action: Service Auth
   - Include: Service Token → Select the token created in step 2
7. Save the policy

**Alternative:** If you want to bypass Cloudflare Access for the MCP endpoint (e.g., serve it on a separate subdomain), update `infrastructure/cloudflared/config.yml` to route a different hostname directly to `capital-web:3000/mcp`.

### 2. Application Bearer Token

Independent of Cloudflare, the app itself validates a bearer token using constant-time comparison:

```
Authorization: Bearer <MCP_API_KEY>
```

**Setup:**

1. Generate a secure API key:
   ```bash
   openssl rand -hex 32
   ```

2. Add to `apps/capital/.env.production`:
   ```env
   MCP_API_KEY=<generated-key>
   MCP_USER_ID=<capital-user-uuid>
   ```

3. Share the `MCP_API_KEY` with the MCP client (Contador) securely (e.g., via 1Password)

**Security Note:** Both authentication layers must pass. The service token validates that the request comes from an authorized service (Cloudflare layer), and the bearer token validates that the request has app-level permission. Bearer token comparison uses `crypto.timingSafeEqual()` to prevent timing attacks.

## Available Tools

The server registers **42 tools**. Read-only API tokens receive only the read tools (`list_`, `get_`, `find_`, `search_`, or a tool marked read-only). Writes are undoable batches attributed to the MCP client.

| Tool | Access | What it does |
|---|---|---|
| `bulk_create_transactions` | write | Create many income, expense, or investment rows, skipping duplicates |
| `list_transactions` | read | List transactions and summaries |
| `update_transaction` | write | Edit one transaction |
| `delete_transaction` | write | Move one transaction to the trash |
| `bulk_update_transactions` | write | Edit many transactions |
| `list_categories` | read | List categories |
| `create_category` | write | Create a category |
| `update_category` | write | Rename, recolor, or archive a category |
| `delete_category` | write | Delete a category, optionally reassigning its rows |
| `merge_categories` | write | Merge one category into another |
| `find_orphan_transactions` | read | Income and expense rows with no category or an archived one |
| `list_accounts` | read | List entities (businesses and the personal entity), not ledger accounts |
| `list_ledger_accounts` | read | List checking, cash, and brokerage accounts |
| `get_valid_types` | read | `income`, `expense`, `investment` |
| `create_transfer` | write | Move cash between checking, cash, or brokerage accounts |
| `list_transfers` | read | List transfers, one row per transfer |
| `list_investment_positions` | read | Active holdings, with account and entity ids |
| `adjust_position` | write | Set a holding's quantity and average cost |
| `add_investment_asset` | write | Open a new holding on a brokerage account |
| `record_investment_contribution` | write | Aporte into a holding, including the cash transfer |
| `record_investment_redemption` | write | Resgate out of a holding, including the cash transfer |
| `record_dividend` | write | Record a provento on a holding and credit the cash once |
| `convert_income_to_dividend` | write | Link an existing income row to a holding without a second credit |
| `update_holding_price` | write | Set the current price or total value; cost stays |
| `get_fire_plan` | read | Read the FIRE plan and the current month's contribution |
| `update_fire_phase_contribution` | write | Set one FIRE phase's monthly contribution |
| `attach_receipt` | write | Attach a PDF or image to a transaction |
| `list_attachments` | read | List a transaction's attachments |
| `delete_attachment` | write | Delete an attachment |
| `get_settings` | read | Read user settings |
| `update_settings` | write | Update user settings |
| `update_account` | write | Update an entity's settings (name and currency) |
| `list_budgets` | read | List budgets |
| `create_budget` | write | Create a budget |
| `update_budget` | write | Update a budget |
| `delete_budget` | write | Delete a budget |
| `get_budget_status` | read | Budget vs. actual for a period |
| `list_credit_cards` | read | List credit cards |
| `create_credit_card` | write | Create a credit card |
| `update_credit_card` | write | Update or archive a credit card |
| `import_credit_card_statement` | write | Import a card statement |
| `get_credit_card_statement` | read | Read one card statement |
| `mark_transaction_as_card_settlement` | write | Turn a bank expense into a card-bill payment |
| `unmark_transaction_as_card_settlement` | write | Turn a card-bill payment back into an expense |

### 1. `bulk_create_transactions`

Bulk create Personal transactions with automatic duplicate detection.

**Use case:** Import 15 dividend payments from XP Investimentos statement without re-entering duplicates.

**Duplicate detection:** Matches `date + amount + description` against existing transactions and within the batch.

**Parameters:**
- `transactions` (array): List of transactions to create
  - `entityType`: `"personal"` or `"business"`
  - `type`: `"income"`, `"expense"`, or `"investment"`
  - `amount`: Number (positive)
  - `currency`: String (3-letter code, e.g., `"BRL"`)
  - `exchangeRate`: Number (optional, defaults to 1)
  - `description`: String
  - `category`: String (must exist, see `list_categories`)
  - `date`: String (ISO date, e.g., `"2026-09-15"`)
  - `isTaxDeductible`: Boolean (optional)
  - `businessId`: UUID (required if `entityType: "business"`)
  - `personalAccountId`: UUID (required if `entityType: "personal"`)
- `dryRun`: Boolean (default `false`). If `true`, simulates without writing to DB.

**Returns:**
```json
{
  "created": [
    { "id": "uuid", "description": "...", "amount": 100, "date": "..." }
  ],
  "duplicates": [
    { "description": "...", "amount": 100, "date": "...", "existingId": "uuid" }
  ],
  "errors": [
    { "item": {...}, "error": "..." }
  ]
}
```

**Example:**
```json
{
  "transactions": [
    {
      "entityType": "personal",
      "type": "income",
      "amount": 50.75,
      "currency": "BRL",
      "description": "PMLL11 - Dividends September 2026",
      "category": "Dividends",
      "date": "2026-09-15",
      "personalAccountId": "<uuid>"
    }
  ],
  "dryRun": false
}
```

### 2. `list_transactions`

List and search transactions by date range, type, and category.

**Use case:** List all Income/Dividends transactions in September 2026 to check for duplicates before importing.

**Parameters:**
- `dateFrom`: String (ISO date, optional)
- `dateTo`: String (ISO date, optional)
- `type`: `"income"` | `"expense"` | `"investment"` (optional)
- `category`: String (optional)
- `entityType`: `"personal"` | `"business"` (optional)
- `businessId`: UUID (optional)
- `personalAccountId`: UUID (optional)

**Returns:**
```json
{
  "transactions": [
    {
      "id": "uuid",
      "entityType": "personal",
      "type": "income",
      "amount": 50.75,
      "currency": "BRL",
      "description": "...",
      "category": "Dividends",
      "date": "2026-09-15T00:00:00.000Z",
      ...
    }
  ],
  "summaries": [
    { "type": "income", "category": "Dividends", "total": 750.25, "count": 15, "currency": "BRL" }
  ]
}
```

### 3. `update_transaction`

Update an existing transaction by ID (one undoable batch). Changing `date` on a card purchase moves it to the matching statement.

**Parameters:**
- `id`: UUID (required)
- `type`, `amount`, `currency`, `exchangeRate`, `description`, `category`, `date`, `isTaxDeductible`: (all optional)

**Returns:** Updated transaction object.

### 4. `delete_transaction`

Move a transaction to the trash. A transfer leg takes its other leg with it. Restorable from the trash for 30 days (`POST /api/v2/trash/restore`) or by undoing the batch.

**Parameters:**
- `id`: UUID (required)

**Returns:**
```json
{ "success": true, "id": "uuid" }
```

### 5. `list_categories`

List all available categories, optionally filtered by type.

**Parameters:**
- `type`: `"income"` | `"expense"` | `"investment"` (optional)

**Returns:**
```json
{
  "categories": [
    { "id": "uuid", "name": "Dividends", "type": "income", "color": "#...", "icon": "...", "isDefault": true, "isSystem": true }
  ]
}
```

**Common categories:**
- Income: `"Dividends"`, `"Salary"`, `"Freelance"`
- Expense: `"Groceries"`, `"Rent"`, `"Utilities"`
- Investment: `"Stocks"`, `"Real Estate"`, `"Crypto"`

### 6. `list_accounts`

List all accounts (businesses and personal account) that can receive transactions.

**Parameters:** None.

**Returns:**
```json
{
  "businesses": [
    { "id": "uuid", "name": "My Company", "defaultCurrency": "USD", "entityType": "business" }
  ],
  "personalAccount": {
    "id": "uuid",
    "name": "Personal",
    "defaultCurrency": "BRL",
    "entityType": "personal"
  }
}
```

### 7. `get_valid_types`

Get the list of valid transaction types.

**Parameters:** None.

**Returns:**
```json
{ "types": ["income", "expense", "investment"] }
```

### 8. `list_investment_positions`

List all active investment positions with quantity, average cost, and current value.

**Use case:** Check that PMLL11 shows 164 cotas but broker has 174.

**Parameters:**
- `accountId`: UUID (optional). One brokerage account, from `list_ledger_accounts`.
- `entityId`: UUID (optional). One entity, from `list_accounts`.

**Returns:**
```json
{
  "positions": [
    {
      "id": "uuid",
      "ticker": "PMLL11",
      "name": "Maxi Renda FII",
      "assetClass": "fii",
      "currentQuantity": 164,
      "averageCost": 102.5,
      "totalInvested": 16810,
      "currentPrice": 105.2,
      "currentValue": 17252.8,
      "unrealizedGain": 442.8,
      "currency": "BRL",
      "accountId": "uuid",
      "accountName": "XP Investimentos",
      "entityId": "uuid"
    }
  ]
}
```

### 9. `adjust_position`

Manually adjust an investment position's quantity and average cost.

**Use case:** Update PMLL11 from 164 to 174 cotas when broker statement shows different values.

**Parameters:**
- `holdingId`: UUID (required)
- `currentQuantity`: Number (non-negative)
- `averageCost`: Number (non-negative)
- `notes`: String (optional, defaults to "Manual adjustment via MCP")

**Returns:**
```json
{
  "success": true,
  "holdingId": "uuid",
  "newQuantity": 174,
  "newAverageCost": 102.5,
  "newTotalInvested": 17835
}
```

**Note:** Records an audit trail transaction with type `"adjustment"`.

### 10. `add_investment_asset`

Add a new asset/position to an investment account.

**Use case:** PVBI11 is missing from the system.

**Parameters:**
- `accountId`: UUID (required). A brokerage account from `list_ledger_accounts`, not an entity id from `list_accounts`.
- `ticker`: String (optional, e.g., `"PVBI11"`)
- `name`: String (required, e.g., `"Valora Brasil FII"`)
- `assetClass`: Enum (required):
  - `"stocks"`, `"fii"`, `"etf"`, `"bdr"`, `"fixed_income"`, `"crypto"`, `"savings"`, `"international_stocks"`, `"international_etf"`
- `currency`: String (optional, 3-letter code, defaults to account's currency)

**Returns:**
```json
{
  "id": "uuid",
  "ticker": "PVBI11",
  "name": "Valora Brasil FII",
  "assetClass": "fii",
  "currency": "BRL"
}
```

### 11. `list_ledger_accounts`

Checking, cash, and brokerage accounts. `list_accounts` returns entities; these ids are what `create_transfer` and the investment cashflow tools take.

**Parameters:** `type` optional, one of `checking`, `cash`, `brokerage`.

**Returns:** `accounts[]` with `id`, `name`, `type`, `currency`, `entityId`, `entityName`, `entityKind`, `isDefault`. Credit cards are omitted.

### 12. `create_transfer`

One transfer between two checking, cash, or brokerage accounts. Direction is inferred. Checking → broker on the same entity is an `investment_deposit` and counts as an aporte of cash only; the holding does not change. Credit cards are rejected.

A deposit or withdrawal that crosses entities (PF checking into a PJ broker, or the reverse) is rejected. Use `record_investment_contribution` or `record_investment_redemption`, which route the money through the broker entity's checking account.

Do not use this to contribute to a holding. `record_investment_contribution` already books that cash transfer. A second `create_transfer` would move the money twice.

Same currency: pass `amount` only (`toAmount` and `exchangeRate` are rejected). Different currencies: `amount` leaves the source; `toAmount` is what arrives.

A repeat of the same accounts, date, amount, description, and `toAmount` returns the existing transfer (`duplicate: true`). Two identical same-day transfers need different descriptions. A parallel double-submit is serialized and also returns the first transfer.

### 13. `list_transfers`

One row per live transfer: date, direction, description, both accounts, both amounts and currencies. Filters: `dateFrom`, `dateTo`, `accountId` (either leg), `direction`, `entityId` (either leg). `accountId` and `entityId` both apply. `limit` defaults to 100 and caps at 500; `offset` skips that many transfers.

### 14. `record_investment_contribution`

An aporte the way the Investments screen books it: cash into the broker and a buy on the holding, one undo batch. This tool already books the cash transfer. Do not also call `create_transfer`.

`mode` is `by_value` or `by_units`.

**by_value** is a caixinha or fixed income stored as quantity 1 whose price is the whole position. Caixinha Nubank PJ is quantity 1, average cost R$29,883, current gross value R$39,943.76. A R$10,000 contribution keeps quantity at 1, adds R$10,000 to the cost basis (average cost and total invested become R$39,883) and adds R$10,000 to the value (current price becomes R$49,943.76). Buying a new unit would make it 2 units and halve the average. Do not pass `quantity` or `price` in this mode; they are rejected.

**by_units** buys units (a stock or FII). Pass `quantity` and `price` (their product must match the amount the holding receives, within 0.01), or one of them, or neither when the holding has a current price.

Default: `by_value` when the asset class is fixed income or savings, or when the name contains "caixinha". Otherwise `by_units`. Quantity 1 on its own does not select `by_value`. A holding whose ticker is repriced from the market stays `by_units` unless `mode` is `by_value` explicitly. Pass `mode` to override.

A by-value buy on a live position is stored with quantity 0 so replaying the operations reproduces the cost. A fully redeemed position (quantity 0) is reopened as quantity 1 at the contribution amount. Deleting that quantity-0 buy in the Investments screen removes the cost and the cash and leaves `currentPrice` where this tool set it. Undo the batch to put the price back as well. `notes`, when passed, are kept and `by_value` is appended.

`amount` is what leaves `cashAccountId`, in that account's currency. When the holding's currency differs, `toAmount` is what the holding receives. `description` is the Aportes text, for example `Aplicação Caixinha Nubank PJ (CDB)`. The same holding, date, and amount returns the existing operation (`duplicate: true`), including a parallel double-submit. A cross-entity duplicate lists every transfer group, including the hop. An archived broker is rejected.

### 15. `record_investment_redemption`

A resgate: the sell and the withdrawal back to a checking or cash account, one undo batch. The withdrawal's metadata carries the sell operation id. Do not also call `create_transfer`.

`by_value` keeps the quantity, lowers the position value by `amount`, and removes cost in proportion to the value redeemed. On the caixinha above, redeeming R$10,000 leaves quantity 1 and value R$29,943.76, and removes `29883 × 10000 / 39943.76` from the cost basis. Realized gain is the amount minus that cost. A redemption larger than the current value is rejected. Paying out the whole value (within R$0.01) can zero the position. Do not pass `quantity` or `price`.

`by_units` sells that many units. `amount` is what leaves the holding, in the holding's currency. When the cash account's currency differs, `toAmount` is what arrives there. The same holding, date, and amount returns the existing redemption (`duplicate: true`), including a full payout retried after the position is already empty. A cross-entity duplicate lists every transfer group, including the hop. `notes`, when passed, are kept and `by_value` is appended. An archived broker is rejected.

### 16. `record_dividend`

Records a provento linked to a holding and credits the cash account, in one undo batch. This is the only way to attach income to a holding: a plain income in category Proventos shows as unlinked, not as the asset. The cash leg is the same shape the ledger uses for dividends (kind `investment`, linked to the holding). Do not also call `create_transaction` or `create_transfer`.

`amount` is the gross, in `currency`. `currency` must be the holding's currency or the cash account's. `withholdingTax`, in that same currency, is optional; the account receives the net. The cash leg stores the exchange rate of `date`, not today's rate.

`incomeType` is `fii_income` (Rendimento FII, tax-exempt), `dividend`, `jcp` (income tax withheld at source) or `fixed_income_interest` (caixinha, CDB or Tesouro interest). `origin` (`BR`, `BDR`, `EXTERIOR`) applies to dividends and defaults from the asset class. `description` defaults to `Dividendo <ticker>` (or JCP / Rendimento FII / Juros), using the holding name when it has no ticker.

Proventos means `fii_income` + `dividend` + `jcp`. `fixed_income_interest` on a business entity is recorded and returned with `passiveIncome: false`. Amortization, bonus shares, sales, redemptions and transfers are not income.

The cash account and the holding have to belong to the same entity (PF or PJ). `fii_income` rejects `withholdingTax` greater than zero.

The same holding, date, income type, cash account and net amount returns the existing operation (`duplicate: true`) and writes nothing.

If an unlinked income already exists on that cash account within 3 days, with the same net within 0.02, and its category is Proventos (or the system dividends category) or its description contains the ticker, the call fails with `dividend.unlinked_income` and does not credit again. The error names that `transactionId`. Pass it to `convert_income_to_dividend`.

### 17. `convert_income_to_dividend`

Links an existing income transaction to a holding as a provento without crediting the cash again. The income entry becomes the dividend's cash leg, so the chart counts it once, on the asset, at the amount and exchange rate already stored. `transactionId` is the income's ledger entry id. `incomeType` is required. `withholdingTax` is optional, in the transaction's currency: the entry amount stays the net, and gross is net + tax. The tax cannot exceed that gross. `fii_income` rejects `withholdingTax` greater than zero.

Transfers, expenses and investment entries are rejected. Calling again on the same entry returns that operation (`duplicate: true`).

An existing dividend of this holding within 7 days is matched in the base currency (`amountBase`, within 0.01), not by comparing the holding's currency with the entry's. If that operation has no cash leg, this income is attached as its leg and no second operation is created. If it already has a leg, the call fails with `dividend.extra_cash` and links nothing: the entry is extra cash (`transactionId`), and the existing dividend is `operationId`. That is not a success and not `duplicate: true`.

Deleting or editing the operation afterwards unlinks this income and leaves it as plain income. The original transaction is not deleted and its amount is not rewritten.

### 18. `update_holding_price`

Sets the current price and leaves average cost and total invested untouched. Pass exactly one of `price` (per unit) or `totalValue` (the whole position: price becomes `totalValue / quantity`). For the caixinha, `totalValue` is the new gross value. `totalValue` on a quantity of 0 is rejected. A negative price is rejected. Zero is allowed. `date` is the day of the price and cannot be in the future; omit it to stamp now.

## MCP Client Configuration

For MCP clients like Claude Desktop or custom implementations using the official SDK, configure the connection like this:

**Example for TypeScript MCP client:**
```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { WebStandardStreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const transport = new WebStandardStreamableHTTPClientTransport(
  new URL("https://capital.kodamalabs.ai/mcp")
);

// Set auth headers
transport.setHeaders({
  "Authorization": "Bearer <MCP_API_KEY>",
  "CF-Access-Client-Id": "<service-token-client-id>",
  "CF-Access-Client-Secret": "<service-token-secret>",
});

const client = new Client(
  { name: "contador", version: "1.0.0" },
  { capabilities: {} }
);

await client.connect(transport);

// List available tools
const tools = await client.listTools();

// Call a tool
const result = await client.callTool({
  name: "list_categories",
  arguments: { type: "income" },
});
```

## Protocol Compliance

The server implements the MCP Streamable HTTP transport specification:

- **Initialization**: Handles `initialize` request with protocol version negotiation (supports `2024-11-05`)
- **Capabilities**: Advertises `tools` capability
- **Server Info**: Returns `capital-accounting` v1.0.0
- **Notifications**: Handles `notifications/initialized` (HTTP 202, no body)
- **Tools**: `tools/list` and `tools/call` with proper error handling
- **Error Handling**: Tool errors returned as `isError` results, not transport errors
- **Stateless Mode**: No session management (sessionId is undefined)
- **HTTP Methods**:
  - `POST /mcp`: Handle JSON-RPC requests
  - `GET /mcp`: 405 Method Not Allowed
  - `DELETE /mcp`: 405 Method Not Allowed

The implementation uses `@modelcontextprotocol/sdk` v1.30.1 with `WebStandardStreamableHTTPServerTransport` for full spec compliance.

## Deployment Steps

1. **Set environment variables** in `apps/capital/.env.production`:
   ```env
   MCP_API_KEY=<generated-secure-key>
   MCP_USER_ID=<capital-user-uuid>
   ```

2. **Configure Cloudflare Access** (see Authentication section above)

3. **Rebuild and restart the capital-web service:**
   ```bash
   cd /path/to/kodama-labs
   docker compose -p kodama-prod build capital-web
   docker compose -p kodama-prod up -d capital-web
   ```

4. **Test the endpoint:**
   ```bash
   curl -X POST https://capital.kodamalabs.ai/mcp \
     -H "Authorization: Bearer <MCP_API_KEY>" \
     -H "CF-Access-Client-Id: <service-token-client-id>" \
     -H "CF-Access-Client-Secret: <service-token-secret>" \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":1}'
   ```

   Expected response: JSON-RPC response with tool list.

## Manual Cloudflare Steps (Summary)

1. Create a Service Token in Cloudflare Zero Trust → Access → Service Auth
2. Save the Client ID and Secret
3. Add a policy to the `capital.kodamalabs.ai` application for the `/mcp` path with Service Auth
4. Share the service token credentials with the MCP client (Contador)

## Troubleshooting

**401 Unauthorized:**
- Check that `MCP_API_KEY` matches in `.env.production` and the client
- Verify Cloudflare service token is valid and policy is applied

**500 Internal Server Error:**
- Check that `MCP_USER_ID` is set in `.env.production`
- Verify the user ID exists in the database
- Check docker logs: `docker compose -p kodama-prod logs capital-web`

**Connection timeout:**
- Verify Cloudflare Tunnel is running: `docker compose -p kodama-prod ps cloudflared`
- Check that `capital-web` service is healthy: `docker compose -p kodama-prod ps capital-web`

## Credit cards and category archive

`list_credit_cards`, `create_credit_card`, and `update_credit_card` sit on the same account services as the v2 API. `list_credit_cards` accepts optional `accountId` (personal or business entity id), `entityType`, and `lastFourDigits` (exactly 4 digits). There is no brand column; `bankName` plus `lastFourDigits` identify a card. `create_credit_card` requires `creditLimit` and pays from the entity's main account. `update_credit_card` changes name, last 4, closing day, due day, and `isActive` (archive) only.

`import_credit_card_statement` treats rows as a multiset: re-importing the same rows creates nothing. Installment rows join an installment plan; the remaining installments are booked on the next statements as committed entries and replaced by the real row when that statement is imported. `get_credit_card_statement` lists purchases without those committed installments.

`mark_transaction_as_card_settlement` turns a bank-account expense into the `card_payment` transfer for a statement (one per statement). `unmark_transaction_as_card_settlement` turns it back into an expense.

`list_categories` hides archived categories unless `includeArchived` is true. `update_category` accepts `isArchived`. Archiving hides a category from pickers. Existing transactions, budgets, and reports keep it. Assigning an archived category to a new transaction is rejected. Internal fallbacks (the system Other category for uncategorized statement rows) still apply when the category is archived. Renaming a category changes one row: entries reference it by id.

`find_orphan_transactions` returns income/expense entries with no category or an archived one; a category name that matches nothing can no longer exist.

`update_settings` refuses a `baseCurrency` change while the ledger has entries unless `force: true` is passed, because base amounts are stored in the current base currency and are not converted.

## Migration Notes

The ledger refactor (`20261004200000_ledger_v2_schema`, `..._backfill`, `..._retire_legacy`) moved every transaction, transfer, bill and investment movement into the ledger and kept the old ids, so ids held by MCP clients still resolve. The previous tables live in the `legacy` schema, with `legacy.id_map` recording old → new ids, until `pnpm --filter @wallex/capital db:drop-legacy` removes them.

## Security Considerations

- **Never commit `MCP_API_KEY`** to the repository
- Rotate the API key if it's compromised
- The MCP server operates as a single user (`MCP_USER_ID`) - ensure this user has appropriate permissions
- Consider rate limiting at the Cloudflare level if needed
- Audit MCP operations through the undo batches (`GET /api/v2/mutations`) or by querying `ledger_entries` with `createdAt` filters
