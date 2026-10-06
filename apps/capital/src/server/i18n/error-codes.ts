/**
 * Stable error codes of the HTTP API. Every error a v1 or v2 route returns
 * carries one in its JSON envelope ({ message, code, params?, issues? }),
 * except unexpected 5xx errors, so the UI can show `t("errors." + code, params)`
 * instead of the English `message`, which stays as it is for the MCP server
 * and the assistant.
 *
 * Each value is the English meaning. `{name}` placeholders name the `params`
 * the server sends with that code (ICU syntax, so the text can seed the
 * frontend's en messages). Codes are never renamed once shipped; add a new
 * one instead.
 *
 * Dependency-free on purpose: the frontend may import it.
 */
export const ERROR_CODES = {
  // Generic
  validation: "The request is invalid; issues lists each problem",
  bad_request: "The request could not be read (its body is not valid JSON or form data)",
  not_found: "The record was not found",
  duplicate: "A record with the same values already exists",
  reference_conflict: "The change conflicts with a related record: it points to one that does not exist, or other records still use this one",

  // Session and login
  "auth.required": "You need to log in",
  "auth.session_invalid": "Your session expired or is invalid; log in again",
  "auth.invalid_credentials": "Invalid email or password",
  "auth.email_taken": "An account with this email already exists",

  // User and preferences
  "user.not_found": "User not found",
  "user.invalid_timezone": "Unknown timezone {timezone}",
  "user.base_currency_locked": "The base currency cannot change while there are {count} entries, because their base amounts would mix two currencies",

  // Entities
  "entity.not_found": "Entity not found",
  "entity.personal_exists": "The user already has a personal entity",
  "entity.personal_rename": "The personal entity cannot be renamed",
  "entity.personal_archive": "The personal entity cannot be archived",
  "entity.kind_mismatch": "Entity {id} is not a {kind} entity",
  "entity.business_required": "Business entries need a business",

  // Accounts
  "account.not_found": "Account not found",
  "account.archived": "Account {name} is archived",
  "account.invalid_day": "{field} must be a day between 1 and 31",
  "account.invalid_credit_limit": "The credit limit must be positive",
  "account.not_credit_card": "The account is not a credit card",

  // Entries and transfers
  "entry.not_found": "Transaction not found",
  "entry.scope_unavailable": "This transaction is not part of a recurrence or an installment plan, so only it can be deleted",
  "entry.kind_locked": "The type of an investment operation's cash cannot change; edit the operation instead",
  "entry.not_transfer": "Only a transfer has a source and a destination account",
  "transfer.same_account": "A transfer needs two different accounts",
  "transfer.from_account_not_found": "Source account not found",
  "transfer.to_account_not_found": "Destination account not found",
  "transfer.kind_change": "A transfer cannot change type; delete it and create it again",

  // Card statements
  "statement.not_found": "Statement not found",
  "statement.payment_conflict": "The statement already has a different bill payment linked",
  "statement.entry_linked_elsewhere": "The transaction is already the bill payment of another statement",
  "statement.transfer_not_settlement": "A transfer cannot be a card settlement",
  "statement.settlement_requires_expense": "Only an expense can be marked as a card settlement",
  "statement.not_settlement": "The transaction is not linked as a card settlement",

  // Categories
  "category.not_found": "Category not found",
  "category.target_not_found": "Target category not found",
  "category.archived": "Category {name} is archived and cannot be assigned",
  "category.name_required": "The category name is required",
  "category.name_taken": "A category named {name} already exists for type {type}",
  "category.system_key_immutable": "The system key of a category cannot change",
  "category.system_type_locked": "The type of system category {name} cannot change",
  "category.type_in_use": "The type cannot change while {count} transactions use the category",
  "category.system_protected": "System category {name} cannot be deleted or merged",
  "category.default_protected": "Default category {name} cannot be deleted or merged",
  "category.reassign_self": "A category cannot be reassigned to itself",
  "category.type_mismatch": "Categories of different types cannot be combined ({from} and {to})",
  "category.reassign_budget_clash": "The target category already has {count} budgets starting in the same months",
  "category.in_use": "The category is used by {entries} transactions, {recurring} recurring rules, {budgets} budgets and {rules} rules; choose a category to move them to",
  "category.merge_self": "A category cannot be merged into itself",
  "category.merge_into_archived": "Cannot merge into archived category {name}; unarchive it first",

  // Categorization rules
  "rule.not_found": "Rule not found",
  "rule.invalid_regex": "Invalid regular expression",

  // Saved views
  "view.not_found": "View not found",
  "view.builtin_rename": "The built-in view cannot be renamed",
  "view.builtin_delete": "The built-in view cannot be deleted",
  "view.not_exportable": "Only transaction views can be exported",

  // Ledger query and selection
  "query.unknown_aggregation_field": "Unknown aggregation field {field}",
  "query.aggregation_needs_numeric": "{fn} needs a numeric field, got {field}",
  "query.invalid_cursor": "Invalid page cursor",
  "query.selection_too_large": "The selection matches more than {cap} rows; narrow the filters",

  // Undo
  "undo.not_found": "Change not found",
  "undo.already_undone": "This change was already undone",
  "undo.newer_change": "A newer change touched these rows; undo it first",
  "undo.unsupported": "Changes to {model} records cannot be undone",

  // Trash
  "trash.operation_recorded_again": "{description} is the cash of an investment operation that was recorded again; restoring it would count it twice",
  "trash.operation_edited": "{description} is the cash of an investment operation that was edited since to move no cash; edit the operation instead",

  // Budgets
  "budget.not_found": "Budget not found",
  "budget.negative_amount": "The budget amount cannot be negative",
  "budget.clash": "A budget for this category already starts in that month",
  "budget.overview_period_required": "Choose a month (YYYY-MM) or a year (YYYY)",
  "budget.apply_before_start": "The change can only apply from the month the budget starts",

  // Recurring rules
  "recurring.not_found": "Recurring rule not found",
  "recurring.invalid_amount": "The amount must be positive",
  "recurring.transfer_needs_destination": "A recurring transfer needs a destination account",

  // Investments
  "holding.not_found": "Holding not found",
  "holding.requires_brokerage": "Holdings live on brokerage accounts",
  "operation.not_found": "Investment operation not found",
  "brokerage.insufficient_cash": "Insufficient cash balance in the investment account",
  "portfolio.targets_sum": "The targets must add up to 100%",
  "rebalance.invalid_amount": "The amount must be positive",
  "rebalance.no_targets": "Set the allocation targets first",

  // Attachments
  "attachment.not_found": "Attachment not found",
  "attachment.file_required": "A file is required",
  "attachment.fields_required": "kind, ownerType and ownerId are required",
  "attachment.owner_not_found": "The {ownerType} the attachment belongs to was not found",
  "attachment.kind_not_allowed": "A {kind} attachment is not allowed on a {ownerType}",
  "attachment.too_large": "The file exceeds the maximum size of {maxBytes} bytes",
  "attachment.mime_not_allowed": "Files of type {mimeType} are not allowed",

  // Currencies
  "currency.not_found": "Currency not found",
  "currency.base_protected": "The base currency cannot be removed",
  "currency.in_use": "{code} is used by {accounts} accounts and {entries} entries",

  // Imports
  "import.not_found": "Import not found",
  "import.already_reverted": "This import was already reverted",
  "import.invalid_file": "The file could not be read as a bank statement or card bill",
  "import.no_transactions": "No valid transactions were found in the file",
  "import.bill_without_card": "Bill file {fileId} resolved to no credit card",
  "import.file_not_found": "File {fileId} not found",
  "import.file_unreadable": "The content of file {fileId} could not be read",
  "import.transfer_inconsistent": "Transfer {externalId} is inconsistent: either its direction or its counterparty is wrong",
  "import.transfer_entity_not_owned": "Transfer {externalId} references an entity you do not own",
  "import.investment_account_not_found": "Investment account {accountId} not found",
  "import.reconcile_target_not_found": "Transfer {transferId} to reconcile was not found",
  "import.reconcile_direction_change": "Transfer {transferId} cannot change to direction {direction} through reconciliation; delete and recreate it",
  "import.holding_unresolved": "Investment transaction {externalId} resolved to no holding",
  "import.account_kind_mismatch": "Account {name} cannot receive this import: bank statements go into a checking or cash account, card bills into a credit card",
  "import.account_entity_mismatch": "Account {name} belongs to another entity than the import",
  "import.mixed_files": "Bank statements and card bills cannot be imported together",
  "import.card_payment_target": "Card payment {externalId} needs a credit card account",

  // Assistant (v1)
  "assistant.conversation_not_found": "Conversation not found",
  "assistant.plan_not_found": "Plan not found",
  "assistant.plan_not_proposed": "The plan is {status}; only a proposed plan can be confirmed or rejected",
  "assistant.plan_changed": "The plan changed since it was shown; review it again before confirming",
  "assistant.message_required": "Send a message, answer the card or attach a file",
  "assistant.turn_running": "The assistant is still answering in this conversation",
  "assistant.file_required": "A file is required",
  "assistant.file_too_large": "The file exceeds the maximum size of {maxBytes} bytes",
  "assistant.image_too_large": "The image exceeds the maximum size of {maxBytes} bytes",
  "assistant.file_type_unsupported": "Only OFX, CSV, PDF and image files are allowed",

  // FIRE (v1)
  "fire.no_plan": "Set up the FIRE plan first",
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

/** Placeholder names in an English meaning, e.g. "{fn} needs {field}" -> "fn" | "field". */
type PlaceholderNames<S extends string> = S extends `${string}{${infer Name}}${infer Rest}` ? Name | PlaceholderNames<Rest> : never;

export type ErrorParamName<C extends ErrorCode> = PlaceholderNames<(typeof ERROR_CODES)[C]>;
export type ErrorParamValue = string | number;
export type ErrorParams = Record<string, ErrorParamValue>;

/**
 * `{ code, params }` for one code: `params` is required, with exactly the
 * code's placeholders, when its meaning has any. A union over every code, so
 * an object literal is checked against the code it names.
 */
export type ErrorDetails<C extends ErrorCode = ErrorCode> = C extends ErrorCode
  ? [ErrorParamName<C>] extends [never]
    ? { code: C; params?: undefined }
    : { code: C; params: Record<ErrorParamName<C>, ErrorParamValue> }
  : never;

/** Codes whose meaning has no placeholders. */
export type ParamlessErrorCode = { [C in ErrorCode]: [ErrorParamName<C>] extends [never] ? C : never }[ErrorCode];

export const ERROR_CODE_LIST = Object.keys(ERROR_CODES) as ErrorCode[];

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ERROR_CODES, value);
}

/** Placeholder names of a code's meaning, in order of appearance. */
export function errorParamNames(code: ErrorCode): string[] {
  return Array.from((ERROR_CODES[code] as string).matchAll(/\{(\w+)\}/g), (m) => m[1]);
}

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

/** One failed check of a request body, query or path parameter. `path` is dot-joined ("targets.0.allocationClass"). */
export interface ValidationIssue {
  path: string;
  code: string;
  message: string;
}

/** JSON body of every v2 error response. */
export interface ApiErrorBody {
  message: string;
  code?: ErrorCode;
  params?: ErrorParams;
  issues?: ValidationIssue[];
}
