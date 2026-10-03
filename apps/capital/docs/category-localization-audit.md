# Category Localization Audit

## Summary

As of PR #64, the Capital app supports **full localization of system and default categories** via the MCP `update_category` tool. Users can rename categories like "Credit Card" → "Cartão de Crédito", "Home" → "Casa", etc. The rename cascades atomically to all referencing tables.

## Hardcoded Category Name References

The following code locations reference category names as string literals. After renaming a category, these checks will match the **new name** (since the category row persists with the updated name):

### 1. Bill Expense Creation
**File**: `apps/capital/src/server/modules/credit-cards/services/create-bill-expense.ts:56`
```typescript
category: "Credit Card",
```
- **Context**: When creating an expense transaction from a credit card bill, hardcodes category as `"Credit Card"`
- **Impact**: If "Credit Card" is renamed to "Cartão de Crédito", new bill expenses will still use `"Credit Card"` literal
- **Fix**: Query for the `isSystem=true` expense category with stable criteria, or accept user-provided category param

### 2. Bill Transaction Linking UI
**File**: `apps/capital/src/components/tables/bills-table.tsx:195,217`
```typescript
.filter((tx) => tx.category === 'Credit Card')
```
- **Context**: Filters expense transactions to show linkable ones for credit card bills
- **Impact**: If "Credit Card" is renamed, this filter won't match transactions with the new name
- **Fix**: Filter by `isSystem` flag via API, or query category by stable ID/flag

### 3. Budget Utility Fallback
**File**: `apps/capital/src/lib/utils/budget.ts:806,880`
```typescript
const category = inst.category || 'Credit Card';
// Line 880:
const category = inst.billTransaction?.category || "Credit Card";
```
- **Context**: Uses `"Credit Card"` as fallback category display for bill installments when category is missing
- **Impact**: If "Credit Card" is renamed, fallback will still show English literal
- **Fix**: Query user's system category or use translated fallback string

### 4. Budget Dashboard Service
**File**: `apps/capital/src/server/modules/budgets/services/get-budget-dashboard.ts:249`
```typescript
const category = inst.billTransaction?.category || "Credit Card";
```
- **Context**: Uses `"Credit Card"` as fallback category for bill installment in budget calculations
- **Impact**: If "Credit Card" is renamed, fallback will still show English literal
- **Fix**: Same as #3, query user's system category

## Category Seeding (No Issue)

**File**: `apps/capital/src/server/modules/auth/services/signup.ts:69-152`
- Seeds default and system categories on signup using `createMany` with `skipDuplicates: true`
- **No issue**: Renamed categories won't be duplicated because the seed uses `skipDuplicates` and checks by name

## Recommendations

1. **Short-term**: Document that the above 4 locations use hardcoded English category names and will need manual translation if users rename those categories
2. **Long-term**: Refactor to:
   - Query categories by `isSystem=true` flag + type instead of hardcoded names
   - Use stable category IDs instead of names for filtering/matching
   - Store category IDs in `BillTransaction.categoryId` FK instead of denormalized `category` string field
   - Provide user-level translation strings for fallback category displays

## Tests

**File**: `apps/capital/src/server/modules/mcp/tools/__tests__/categories.test.ts`
- Test: "should update default categories for localization"
- Verifies renaming a default category cascades to transactions
- Verifies no duplicate English category is recreated after rename

## Status

✅ Localization fully supported in MCP tools (PR #64)
⚠️ Hardcoded English category names remain in 4 locations (documented above)
