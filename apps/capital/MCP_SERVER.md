# MCP Server for Remote AI Accounting Access

The Capital app exposes an MCP (Model Context Protocol) server at `/mcp` that allows external AI assistants (like Contador) to directly read and write accounting data through a standardized tool-calling interface.

## Overview

**Problem:** External AI assistants need to interact with accounting data but shouldn't use the web UI (entering 15 dividend payments one-by-one through forms is inefficient and error-prone).

**Solution:** MCP server with tools for bulk operations, duplicate detection, and direct database access through validated business logic.

## Endpoint

```
POST https://capital.kodamalabs.ai/mcp
```

The endpoint uses **Streamable HTTP (SSE)** transport compatible with MCP clients.

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

Independent of Cloudflare, the app itself validates a bearer token:

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

**Security Note:** Both authentication layers must pass. The service token validates that the request comes from an authorized service (Cloudflare layer), and the bearer token validates that the request has app-level permission.

## Available Tools

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

Update an existing transaction by ID.

**Parameters:**
- `id`: UUID (required)
- `type`, `amount`, `currency`, `exchangeRate`, `description`, `category`, `date`, `isTaxDeductible`: (all optional)

**Returns:** Updated transaction object.

### 4. `delete_transaction`

Delete a transaction by ID.

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

**Parameters:** None.

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
      "accountName": "XP Investimentos"
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
- `accountId`: UUID (required, from `list_accounts` or query directly)
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

## MCP Client Configuration

For MCP clients like Claude Desktop or custom implementations, configure the connection like this:

**Example for a TypeScript MCP client:**
```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const transport = new SSEClientTransport(
  new URL("https://capital.kodamalabs.ai/mcp"),
  {
    headers: {
      "Authorization": "Bearer <MCP_API_KEY>",
      "CF-Access-Client-Id": "<service-token-client-id>",
      "CF-Access-Client-Secret": "<service-token-secret>",
    },
  }
);

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

## Migration Notes

No database migrations are required. The MCP server uses existing tables and services.

## Security Considerations

- **Never commit `MCP_API_KEY`** to the repository
- Rotate the API key if it's compromised
- The MCP server operates as a single user (`MCP_USER_ID`) - ensure this user has appropriate permissions
- Consider rate limiting at the Cloudflare level if needed
- Audit MCP operations by querying `transactions` with `createdAt` filters
