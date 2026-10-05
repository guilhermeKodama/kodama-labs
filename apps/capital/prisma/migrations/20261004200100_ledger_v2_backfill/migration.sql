-- Ledger v2 backfill.
--
-- Copies every money movement from the pre-ledger tables into the ledger
-- tables created by 20261004200000_ledger_v2_schema, then reconciles P&L per
-- entity and month against the legacy tables and aborts (rolling back the
-- whole migration) on any difference above R$ 0.01.
--
-- Ids are preserved wherever a legacy row maps 1:1 (entities keep the
-- business / personal account id, accounts keep the card / broker id, entries
-- keep the transaction / bill transaction id, transfer groups keep the
-- transfer id). Rows that have no legacy counterpart get deterministic ids
-- (md5 of a stable key), so the backfill is idempotent on a fresh copy.
-- legacy.id_map records every correspondence.
--
-- Mapping rules (the old reports' semantics are kept exactly):
--   * Business / PersonalAccount -> Entity, plus one default checking account
--     per entity carrying the old initialBalance.
--   * CreditCard -> Account(credit_card); InvestmentAccount -> Account(brokerage).
--   * Transaction -> LedgerEntry on the entity's default checking account,
--     amount signed (income > 0, expense/investment < 0).
--   * A transaction that settled a card (CreditCardStatement.billPaymentTransactionId
--     or legacy CreditCardBill.transactionId) -> card_payment TransferGroup:
--     checking leg (keeps the transaction id) + card leg.
--   * Transfer -> TransferGroup + two legs. Reimbursement legs are `expense`
--     (payer books the cost, receiver a negative expense), mirroring getSummary.
--   * BillTransaction -> expense entry on the card account. Statement purchases
--     count on the statement's closing date (or the 1st of its month). Legacy
--     bill purchases count on the date of the transaction that paid the bill;
--     when the bill total differs from the sum of its purchases an adjustment
--     entry keeps the month's total identical. Purchases of a legacy bill that
--     was never linked to a payment were not counted before; they now count on
--     the bill's closing date (reported as a known adjustment, not an error).
--   * Investment operations that move cash get a cash leg (kind investment) on
--     the brokerage account; the account's initialBalance is set so the derived
--     cash equals the old cashBalance.

BEGIN;

CREATE SCHEMA IF NOT EXISTS legacy;

CREATE TABLE IF NOT EXISTS legacy.id_map (
  old_model text NOT NULL,
  old_id    text NOT NULL,
  new_model text NOT NULL,
  new_id    text NOT NULL,
  PRIMARY KEY (old_model, old_id, new_model, new_id)
);

-- ---------------------------------------------------------------------------
-- Entities and default checking accounts
-- ---------------------------------------------------------------------------

INSERT INTO entities (id, "userId", kind, name, description, "defaultCurrency", "taxRate", color, "createdAt", "updatedAt")
SELECT b.id, b."userId", 'business'::"EntityType", b.name, b.description, b."defaultCurrency", b."taxRate", b.color, b."createdAt", b."updatedAt"
FROM businesses b
UNION ALL
SELECT p.id, p."userId", 'personal'::"EntityType", 'PF', NULL, p."defaultCurrency", p."taxRate", NULL, p."createdAt", p."updatedAt"
FROM personal_accounts p
ON CONFLICT (id) DO NOTHING;

INSERT INTO accounts (id, "userId", "entityId", type, name, currency, "initialBalance", "isDefault", "createdAt", "updatedAt")
SELECT md5('default-checking:' || e.id)::uuid::text, e."userId", e.id, 'checking', 'Conta principal', e."defaultCurrency",
       coalesce(b."initialBalance", p."initialBalance", 0), true, e."createdAt", now()
FROM entities e
LEFT JOIN businesses b ON b.id = e.id
LEFT JOIN personal_accounts p ON p.id = e.id
ON CONFLICT (id) DO NOTHING;

CREATE TEMP TABLE _default_acct ON COMMIT DROP AS
SELECT "entityId" AS entity_id, id AS account_id FROM accounts WHERE "isDefault";
CREATE UNIQUE INDEX ON _default_acct (entity_id);

CREATE TEMP TABLE _personal_entity ON COMMIT DROP AS
SELECT DISTINCT ON ("userId") "userId" AS user_id, id AS entity_id FROM entities WHERE kind = 'personal' ORDER BY "userId", "createdAt";

-- Base-currency units per 1 unit of each user currency (manualRate is "1 base = X foreign").
CREATE TEMP TABLE _rate ON COMMIT DROP AS
SELECT u.id AS user_id, c.code,
       CASE WHEN c.code = u."baseCurrency" THEN 1::numeric
            WHEN c."manualRate" > 0 THEN (1 / c."manualRate"::numeric)
            ELSE 1::numeric END AS rate
FROM users u JOIN currencies c ON c."userId" = u.id;
CREATE UNIQUE INDEX ON _rate (user_id, code);

-- ---------------------------------------------------------------------------
-- Cards and brokers
-- ---------------------------------------------------------------------------

INSERT INTO accounts (id, "userId", "entityId", type, name, institution, currency, "externalId", "initialBalance", "isDefault",
                      color, "creditLimit", "closingDay", "dueDay", "payFromAccountId", "archivedAt", "createdAt", "updatedAt")
SELECT c.id, e."userId", e.id, 'credit_card',
       coalesce(nullif(c.nickname, ''), c."bankName" || ' ****' || c."lastFourDigits"),
       c."bankName", c.currency, c."lastFourDigits", 0, false, c.color, c."creditLimit", c."closingDay", c."dueDay",
       d.account_id, CASE WHEN c."isActive" THEN NULL ELSE c."updatedAt" END, c."createdAt", c."updatedAt"
FROM credit_cards c
JOIN entities e ON e.id = coalesce(c."businessId", c."personalAccountId")
JOIN _default_acct d ON d.entity_id = e.id
ON CONFLICT (id) DO NOTHING;

INSERT INTO accounts (id, "userId", "entityId", type, name, institution, currency, "externalId", "initialBalance", "isDefault",
                      "archivedAt", "createdAt", "updatedAt")
SELECT a.id, a."userId", coalesce(a."businessId", a."personalAccountId", pe.entity_id), 'brokerage', a.name, a.broker, a.currency,
       a."externalId", 0, false, CASE WHEN a."isActive" THEN NULL ELSE a."updatedAt" END, a."createdAt", a."updatedAt"
FROM investment_accounts a
LEFT JOIN _personal_entity pe ON pe.user_id = a."userId"
WHERE coalesce(a."businessId", a."personalAccountId", pe.entity_id) IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Categories referenced by name -> rows (created when missing)
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE _bt ON COMMIT DROP AS
SELECT bt.*, coalesce(s."creditCardId", b."creditCardId") AS card_id, a."userId" AS user_id, a."entityId" AS entity_id
FROM bill_transactions bt
LEFT JOIN credit_card_statements s ON s.id = bt."statementId"
LEFT JOIN credit_card_bills b ON b.id = bt."billId"
JOIN accounts a ON a.id = coalesce(s."creditCardId", b."creditCardId");

INSERT INTO categories (id, "userId", name, type, "isDefault", "isSystem", "isArchived", "createdAt", "updatedAt")
SELECT md5('cat:' || n.user_id || ':' || n.type || ':' || n.name)::uuid::text, n.user_id, n.name, n.type::"TransactionType",
       false, false, false, now(), now()
FROM (
  SELECT e."userId" AS user_id, t.category AS name, t.type::text AS type
    FROM transactions t JOIN entities e ON e.id = coalesce(t."businessId", t."personalAccountId")
  UNION SELECT user_id, category, 'expense' FROM _bt
  UNION SELECT e."userId", r.category, r.type::text
    FROM recurring_transactions r JOIN entities e ON e.id = coalesce(r."businessId", r."personalAccountId")
  UNION SELECT e."userId", bu.category, 'expense'
    FROM budgets bu JOIN entities e ON e.id = coalesce(bu."businessId", bu."personalAccountId")
  UNION SELECT m."userId", m.category, 'expense' FROM merchant_category_mappings m
    WHERE NOT EXISTS (SELECT 1 FROM categories c WHERE c."userId" = m."userId" AND c.name = m.category)
) n
WHERE n.name <> ''
  AND NOT EXISTS (SELECT 1 FROM categories c WHERE c."userId" = n.user_id AND c.name = n.name AND c.type::text = n.type)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Recurring rules (needed before entries reference them)
-- ---------------------------------------------------------------------------

INSERT INTO recurring_rules (id, "userId", "entityId", "accountId", kind, amount, currency, "exchangeRate", description, "categoryId",
                             "transferDirection", "toAccountId", frequency, "startDate", "endDate", "nextDueDate", "lastGeneratedDate",
                             "isActive", "autoGenerate", reminders, "createdAt", "updatedAt")
SELECT r.id, e."userId", e.id, d.account_id, r.type::text::"LedgerKind", r.amount, r.currency, r."exchangeRate", r.description, c.id,
       NULL, NULL, r.frequency, r."startDate", r."endDate", r."nextDueDate", r."lastGeneratedDate",
       r."isActive", r."autoGenerateTransaction", r.reminders, r."createdAt", r."updatedAt"
FROM recurring_transactions r
JOIN entities e ON e.id = coalesce(r."businessId", r."personalAccountId")
JOIN _default_acct d ON d.entity_id = e.id
LEFT JOIN categories c ON c."userId" = e."userId" AND c.name = r.category AND c.type = r.type
ON CONFLICT (id) DO NOTHING;

INSERT INTO recurring_rules (id, "userId", "entityId", "accountId", kind, amount, currency, "exchangeRate", description, "categoryId",
                             "transferDirection", "toAccountId", frequency, "startDate", "endDate", "nextDueDate", "lastGeneratedDate",
                             "isActive", "autoGenerate", reminders, "createdAt", "updatedAt")
SELECT rt.id, e."userId", e.id, d.account_id,
       CASE WHEN rt.direction = 'reimbursement' THEN 'expense'::"LedgerKind" ELSE 'transfer'::"LedgerKind" END,
       rt.amount, rt.currency, rt."exchangeRate", coalesce(rt.description, initcap(replace(rt.direction::text, '_', ' '))), NULL,
       rt.direction, d2.account_id, rt.frequency, rt."startDate", rt."endDate", rt."nextDueDate", rt."lastGeneratedDate",
       rt."isActive", true, NULL, rt."createdAt", rt."updatedAt"
FROM recurring_transfers rt
JOIN entities e ON e.id = coalesce(rt."fromBusinessId", rt."fromPersonalAccountId")
JOIN _default_acct d ON d.entity_id = e.id
JOIN _default_acct d2 ON d2.entity_id = coalesce(rt."toBusinessId", rt."toPersonalAccountId")
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Card statements (new statements + legacy bills folded in by card and month)
-- ---------------------------------------------------------------------------

INSERT INTO card_statements (id, "accountId", month, "closingDate", "dueDate", "totalAmount", "createdAt", "updatedAt")
SELECT s.id, s."creditCardId", s.month, s."closingDate", s."dueDate", s."totalAmount", s."createdAt", s."updatedAt"
FROM credit_card_statements s
WHERE EXISTS (SELECT 1 FROM accounts a WHERE a.id = s."creditCardId")
ON CONFLICT DO NOTHING;

INSERT INTO card_statements (id, "accountId", month, "closingDate", "dueDate", "totalAmount", "createdAt", "updatedAt")
SELECT DISTINCT ON (b."creditCardId", to_char(b."closingDate", 'YYYY-MM'))
       b.id, b."creditCardId", to_char(b."closingDate", 'YYYY-MM'), b."closingDate", b."dueDate", b."totalAmount", b."createdAt", b."updatedAt"
FROM credit_card_bills b
WHERE EXISTS (SELECT 1 FROM accounts a WHERE a.id = b."creditCardId")
ORDER BY b."creditCardId", to_char(b."closingDate", 'YYYY-MM'), b."createdAt"
ON CONFLICT DO NOTHING;

CREATE TEMP TABLE _bill_stmt ON COMMIT DROP AS
SELECT b.id AS bill_id, cs.id AS stmt_id
FROM credit_card_bills b
JOIN card_statements cs ON cs."accountId" = b."creditCardId" AND cs.month = to_char(b."closingDate", 'YYYY-MM');

-- ---------------------------------------------------------------------------
-- Card settlements -> card_payment transfers
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE _settle ON COMMIT DROP AS
SELECT DISTINCT ON (x.tx_id) x.*
FROM (
  SELECT s."billPaymentTransactionId" AS tx_id, s."creditCardId" AS card_id, s.id AS stmt_id, NULL::text AS bill_id, 1 AS pref
    FROM credit_card_statements s WHERE s."billPaymentTransactionId" IS NOT NULL
  UNION ALL
  SELECT b."transactionId", b."creditCardId", bs.stmt_id, b.id, 2
    FROM credit_card_bills b LEFT JOIN _bill_stmt bs ON bs.bill_id = b.id
    WHERE b."transactionId" IS NOT NULL
) x
JOIN transactions t ON t.id = x.tx_id
WHERE EXISTS (SELECT 1 FROM accounts a WHERE a.id = x.card_id)
ORDER BY x.tx_id, x.pref;

INSERT INTO transfer_groups (id, "userId", direction, description, date, "recurringRuleId", "importId", "externalId", "createdAt", "updatedAt")
SELECT t.id, e."userId", 'card_payment', t.description, t.date,
       (SELECT id FROM recurring_rules rr WHERE rr.id = t."recurringTransactionId"), t."statementImportId", t."externalId",
       t."createdAt", t."updatedAt"
FROM _settle s
JOIN transactions t ON t.id = s.tx_id
JOIN entities e ON e.id = coalesce(t."businessId", t."personalAccountId")
ON CONFLICT (id) DO NOTHING;

INSERT INTO ledger_entries (id, "userId", "entityId", "accountId", kind, amount, currency, "exchangeRate", "amountBase", date, "effectiveDate",
                            description, "categoryId", "isTaxDeductible", "transferGroupId", "recurringRuleId", "importId", "externalId",
                            metadata, "createdAt", "updatedAt")
SELECT t.id, e."userId", e.id, d.account_id, 'transfer'::"LedgerKind", -t.amount, t.currency, t."exchangeRate", round((-t.amount * t."exchangeRate")::numeric, 4),
       t.date, t.date, t.description, c.id, false, t.id,
       (SELECT id FROM recurring_rules rr WHERE rr.id = t."recurringTransactionId"), t."statementImportId", t."externalId",
       jsonb_build_object('migratedFrom', 'card_settlement_transaction'), t."createdAt", t."updatedAt"
FROM _settle s
JOIN transactions t ON t.id = s.tx_id
JOIN entities e ON e.id = coalesce(t."businessId", t."personalAccountId")
JOIN _default_acct d ON d.entity_id = e.id
LEFT JOIN categories c ON c."userId" = e."userId" AND c.name = t.category AND c.type = t.type
UNION ALL
SELECT md5('card-payment-leg:' || t.id)::uuid::text, ca."userId", ca."entityId", s.card_id, 'transfer'::"LedgerKind", t.amount, t.currency, t."exchangeRate",
       round((t.amount * t."exchangeRate")::numeric, 4), t.date, t.date, t.description, NULL, false, t.id, NULL, t."statementImportId", NULL,
       jsonb_build_object('migratedFrom', 'card_settlement_transaction'), t."createdAt", t."updatedAt"
FROM _settle s
JOIN transactions t ON t.id = s.tx_id
JOIN accounts ca ON ca.id = s.card_id
ON CONFLICT (id) DO NOTHING;

UPDATE card_statements cs SET "paymentGroupId" = s.tx_id
FROM _settle s
WHERE cs.id = s.stmt_id AND cs."paymentGroupId" IS NULL;

-- ---------------------------------------------------------------------------
-- Regular transactions
-- ---------------------------------------------------------------------------

INSERT INTO ledger_entries (id, "userId", "entityId", "accountId", kind, amount, currency, "exchangeRate", "amountBase", date, "effectiveDate",
                            description, "categoryId", "isTaxDeductible", "recurringRuleId", "importId", "externalId", "createdAt", "updatedAt")
SELECT t.id, e."userId", e.id, d.account_id, t.type::text::"LedgerKind",
       CASE WHEN t.type = 'income' THEN t.amount ELSE -t.amount END, t.currency, t."exchangeRate",
       round(((CASE WHEN t.type = 'income' THEN t.amount ELSE -t.amount END) * t."exchangeRate")::numeric, 4),
       t.date, t.date, t.description, c.id, t."isTaxDeductible",
       (SELECT id FROM recurring_rules rr WHERE rr.id = t."recurringTransactionId"), t."statementImportId", t."externalId",
       t."createdAt", t."updatedAt"
FROM transactions t
JOIN entities e ON e.id = coalesce(t."businessId", t."personalAccountId")
JOIN _default_acct d ON d.entity_id = e.id
LEFT JOIN categories c ON c."userId" = e."userId" AND c.name = t.category AND c.type = t.type
WHERE NOT EXISTS (SELECT 1 FROM _settle s WHERE s.tx_id = t.id)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Transfers
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE _tr ON COMMIT DROP AS
SELECT tr.*,
       coalesce(tr."fromInvestmentAccountId", df.account_id) AS from_account,
       coalesce(tr."toInvestmentAccountId", dt.account_id) AS to_account
FROM transfers tr
LEFT JOIN _default_acct df ON df.entity_id = coalesce(tr."fromBusinessId", tr."fromPersonalAccountId")
LEFT JOIN _default_acct dt ON dt.entity_id = coalesce(tr."toBusinessId", tr."toPersonalAccountId");

INSERT INTO transfer_groups (id, "userId", direction, description, date, "recurringRuleId", "externalId", "createdAt", "updatedAt")
SELECT tr.id, fa."userId", tr.direction, tr.description, tr.date,
       (SELECT id FROM recurring_rules rr WHERE rr.id = tr."recurringTransferId"), tr."externalId", tr."createdAt", tr."updatedAt"
FROM _tr tr
JOIN accounts fa ON fa.id = tr.from_account
JOIN accounts ta ON ta.id = tr.to_account
ON CONFLICT (id) DO NOTHING;

INSERT INTO ledger_entries (id, "userId", "entityId", "accountId", kind, amount, currency, "exchangeRate", "amountBase", date, "effectiveDate",
                            description, "transferGroupId", "recurringRuleId", "externalId", "createdAt", "updatedAt")
SELECT tr.id, fa."userId", fa."entityId", fa.id,
       CASE WHEN tr.direction = 'reimbursement' THEN 'expense'::"LedgerKind" ELSE 'transfer'::"LedgerKind" END,
       -tr.amount, tr.currency, tr."exchangeRate", round((-tr.amount * tr."exchangeRate")::numeric, 4), tr.date, tr.date,
       coalesce(tr.description, initcap(replace(tr.direction::text, '_', ' '))), tr.id,
       (SELECT id FROM recurring_rules rr WHERE rr.id = tr."recurringTransferId"), tr."externalId", tr."createdAt", tr."updatedAt"
FROM _tr tr JOIN accounts fa ON fa.id = tr.from_account JOIN accounts ta ON ta.id = tr.to_account
UNION ALL
SELECT md5('transfer-to:' || tr.id)::uuid::text, ta."userId", ta."entityId", ta.id,
       CASE WHEN tr.direction = 'reimbursement' THEN 'expense'::"LedgerKind" ELSE 'transfer'::"LedgerKind" END,
       tr.amount, tr.currency, tr."exchangeRate", round((tr.amount * tr."exchangeRate")::numeric, 4), tr.date, tr.date,
       coalesce(tr.description, initcap(replace(tr.direction::text, '_', ' '))), tr.id,
       (SELECT id FROM recurring_rules rr WHERE rr.id = tr."recurringTransferId"), NULL, tr."createdAt", tr."updatedAt"
FROM _tr tr JOIN accounts fa ON fa.id = tr.from_account JOIN accounts ta ON ta.id = tr.to_account
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Card purchases
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE _purchase ON COMMIT DROP AS
SELECT bt.*,
       coalesce(bt."statementId", bs.stmt_id) AS stmt_id,
       CASE
         WHEN bt."statementId" IS NOT NULL THEN coalesce(s."closingDate", (s.month || '-01 12:00:00')::timestamp)
         WHEN lt.id IS NOT NULL THEN lt.date
         ELSE b."closingDate"
       END AS effective_date,
       (bt."statementId" IS NULL AND b."transactionId" IS NULL) AS legacy_unlinked,
       CASE WHEN bt.currency = u."baseCurrency" THEN 1::numeric ELSE coalesce(r.rate, 1::numeric) END AS rate
FROM _bt bt
JOIN users u ON u.id = bt.user_id
LEFT JOIN _rate r ON r.user_id = bt.user_id AND r.code = bt.currency
LEFT JOIN credit_card_statements s ON s.id = bt."statementId"
LEFT JOIN credit_card_bills b ON b.id = bt."billId"
LEFT JOIN _bill_stmt bs ON bs.bill_id = bt."billId"
LEFT JOIN transactions lt ON lt.id = b."transactionId";

INSERT INTO ledger_entries (id, "userId", "entityId", "accountId", kind, amount, currency, "exchangeRate", "amountBase", date, "effectiveDate",
                            description, "merchantName", "categoryId", "isAutoCategorized", "cardStatementId", "installmentNumber",
                            metadata, "createdAt", "updatedAt")
SELECT p.id, p.user_id, p.entity_id, p.card_id, 'expense', -p.amount, p.currency, round(p.rate, 8), round((-p.amount * p.rate)::numeric, 4),
       p."transactionDate", p.effective_date, p.description, p."merchantName", c.id, p."isAutoCategorized", p.stmt_id, p."installmentNumber",
       CASE WHEN p."totalInstallments" IS NOT NULL THEN jsonb_build_object('totalInstallments', p."totalInstallments") END,
       p."createdAt", p."updatedAt"
FROM _purchase p
LEFT JOIN categories c ON c."userId" = p.user_id AND c.name = p.category AND c.type = 'expense'
ON CONFLICT (id) DO NOTHING;

-- Legacy bills whose total differs from their purchases: keep the paid total.
INSERT INTO ledger_entries (id, "userId", "entityId", "accountId", kind, amount, currency, "exchangeRate", "amountBase", date, "effectiveDate",
                            description, "categoryId", "cardStatementId", metadata, "createdAt", "updatedAt")
SELECT md5('bill-adjust:' || b.id)::uuid::text, ca."userId", ca."entityId", ca.id, 'expense',
       -round(x.diff, 4), u."baseCurrency", 1, -round(x.diff, 4), b."closingDate", lt.date,
       'Ajuste da fatura (total pago menos compras importadas)', c.id, bs.stmt_id,
       jsonb_build_object('migratedFrom', 'legacy_bill_adjustment', 'billId', b.id), now(), now()
FROM credit_card_bills b
JOIN transactions lt ON lt.id = b."transactionId"
JOIN accounts ca ON ca.id = b."creditCardId"
JOIN users u ON u.id = ca."userId"
LEFT JOIN _bill_stmt bs ON bs.bill_id = b.id
LEFT JOIN categories c ON c."userId" = ca."userId" AND c.name = lt.category AND c.type = lt.type
JOIN LATERAL (
  SELECT ((lt.amount * lt."exchangeRate")::numeric - coalesce((SELECT sum((p.amount * p.rate)::numeric) FROM _purchase p WHERE p."billId" = b.id), 0))::numeric AS diff
) x ON true
WHERE abs(x.diff) >= 0.005
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Installment plans
-- ---------------------------------------------------------------------------

INSERT INTO installment_plans (id, "userId", "accountId", description, "totalAmount", "totalInstallments", "installmentAmount", "startDate",
                               "isActive", "createdAt", "updatedAt")
SELECT i.id, a."userId", i."creditCardId", i.description, i."totalAmount", i."totalInstallments", i."installmentAmount", i."startDate",
       i."isActive", i."createdAt", i."updatedAt"
FROM installments i JOIN accounts a ON a.id = i."creditCardId"
ON CONFLICT (id) DO NOTHING;

UPDATE ledger_entries le SET "installmentPlanId" = i.id
FROM installments i
WHERE le.id = i."billTransactionId" AND le."installmentPlanId" IS NULL;

-- ---------------------------------------------------------------------------
-- Investment cash legs
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE _inv_cash ON COMMIT DROP AS
SELECT it.id AS op_id, it.date, it."createdAt", a."userId" AS user_id, a."entityId" AS entity_id, a.id AS account_id, a.currency,
       CASE WHEN a.currency = u."baseCurrency" THEN 1::numeric ELSE coalesce(r.rate, 1::numeric) END AS rate,
       (CASE it.type
          WHEN 'buy' THEN -(it."totalAmount" + it.fees)
          WHEN 'deposit' THEN -(it."totalAmount" + it.fees)
          WHEN 'sell' THEN it."totalAmount" - it.fees
          WHEN 'withdrawal' THEN it."totalAmount" - it.fees
          WHEN 'dividend' THEN it."totalAmount"
          WHEN 'yield_payment' THEN it."totalAmount"
          ELSE 0 END)::numeric AS impact,
       (CASE it.type
          WHEN 'buy' THEN 'Compra' WHEN 'sell' THEN 'Venda' WHEN 'deposit' THEN 'Aplicação' WHEN 'withdrawal' THEN 'Resgate'
          WHEN 'dividend' THEN 'Dividendo' WHEN 'yield_payment' THEN 'Rendimento' ELSE 'Ajuste' END)
         || ' ' || coalesce(h.ticker, h.name) AS label
FROM investment_transactions it
JOIN investment_holdings h ON h.id = it."holdingId"
JOIN accounts a ON a.id = h."accountId"
JOIN users u ON u.id = a."userId"
LEFT JOIN _rate r ON r.user_id = a."userId" AND r.code = a.currency;

INSERT INTO ledger_entries (id, "userId", "entityId", "accountId", kind, amount, currency, "exchangeRate", "amountBase", date, "effectiveDate",
                            description, metadata, "createdAt", "updatedAt")
SELECT md5('inv-cash:' || c.op_id)::uuid::text, c.user_id, c.entity_id, c.account_id, 'investment', round(c.impact, 4), c.currency,
       round(c.rate, 8), round(c.impact * c.rate, 4), c.date, c.date, c.label,
       jsonb_build_object('investmentOperationId', c.op_id), c."createdAt", now()
FROM _inv_cash c
WHERE c.impact <> 0
ON CONFLICT (id) DO NOTHING;

UPDATE investment_transactions it SET "cashEntryId" = md5('inv-cash:' || it.id)::uuid::text
WHERE EXISTS (SELECT 1 FROM ledger_entries le WHERE le.id = md5('inv-cash:' || it.id)::uuid::text);

UPDATE accounts a
SET "initialBalance" = ia."cashBalance"::numeric - coalesce((SELECT sum(le.amount) FROM ledger_entries le WHERE le."accountId" = a.id), 0)
FROM investment_accounts ia
WHERE ia.id = a.id;

-- ---------------------------------------------------------------------------
-- Rules, budgets, attachments, reminders, imports, assistant audit, views
-- ---------------------------------------------------------------------------

INSERT INTO categorization_rules (id, "userId", "matchType", pattern, "categoryId", source, "hitCount", "createdAt", "updatedAt")
SELECT m.id, m."userId", 'equals', m."normalizedDescription", c.id, m.source, 0, m."createdAt", m."updatedAt"
FROM merchant_category_mappings m
JOIN LATERAL (
  SELECT c.id FROM categories c WHERE c."userId" = m."userId" AND c.name = m.category ORDER BY (c.type = 'expense') DESC, c."createdAt" LIMIT 1
) c ON true
ON CONFLICT DO NOTHING;

UPDATE budgets b
SET "userId" = e."userId", "entityId" = e.id,
    "categoryId" = (SELECT c.id FROM categories c WHERE c."userId" = e."userId" AND c.name = b.category ORDER BY (c.type = 'expense') DESC LIMIT 1)
FROM entities e
WHERE e.id = coalesce(b."businessId", b."personalAccountId");

UPDATE attachments
SET "ledgerEntryId" = CASE WHEN EXISTS (SELECT 1 FROM ledger_entries le WHERE le.id = attachments."transactionId") THEN "transactionId" END,
    "transferGroupId" = CASE WHEN EXISTS (SELECT 1 FROM transfer_groups tg WHERE tg.id = attachments."transferId") THEN "transferId" END,
    "recurringRuleId" = CASE WHEN EXISTS (SELECT 1 FROM recurring_rules rr WHERE rr.id = coalesce(attachments."recurringTransactionId", attachments."recurringTransferId"))
                             THEN coalesce("recurringTransactionId", "recurringTransferId") END;

UPDATE reminder_dispatches SET "recurringRuleId" = "recurringTransactionId"
WHERE EXISTS (SELECT 1 FROM recurring_rules rr WHERE rr.id = reminder_dispatches."recurringTransactionId");

UPDATE statement_imports si
SET "entityId" = coalesce(si."businessId", si."personalAccountId"),
    "accountId" = d.account_id
FROM _default_acct d
WHERE d.entity_id = coalesce(si."businessId", si."personalAccountId");

UPDATE agent_actions aa
SET "createdRecords" = (
  SELECT coalesce(jsonb_agg(
    CASE elem->>'model'
      WHEN 'Transaction' THEN jsonb_build_object('model', 'LedgerEntry', 'id', elem->>'id')
      WHEN 'BillTransaction' THEN jsonb_build_object('model', 'LedgerEntry', 'id', elem->>'id')
      WHEN 'Transfer' THEN jsonb_build_object('model', 'TransferGroup', 'id', elem->>'id')
      WHEN 'InvestmentTransaction' THEN jsonb_build_object('model', 'InvestmentOperation', 'id', elem->>'id')
      WHEN 'CreditCardStatement' THEN jsonb_build_object('model', 'CardStatement', 'id', elem->>'id')
      WHEN 'CreditCardBill' THEN jsonb_build_object('model', 'CardStatement',
        'id', coalesce((SELECT bs.stmt_id FROM _bill_stmt bs WHERE bs.bill_id = elem->>'id'), elem->>'id'))
      WHEN 'CreditCard' THEN jsonb_build_object('model', 'Account', 'id', elem->>'id')
      WHEN 'InvestmentAccount' THEN jsonb_build_object('model', 'Account', 'id', elem->>'id')
      WHEN 'StatementImport' THEN jsonb_build_object('model', 'Import', 'id', elem->>'id')
      ELSE elem
    END), '[]'::jsonb)
  FROM jsonb_array_elements(aa."createdRecords") elem
)
WHERE jsonb_typeof(aa."createdRecords") = 'array';

INSERT INTO saved_views (id, "userId", dataset, name, position, "isBuiltin", "builtinKey", "isFavorite", config, "createdAt", "updatedAt")
SELECT md5('view-all:' || u.id)::uuid::text, u.id, 'ledger', 'Todas', 0, true, 'all', true, '{}'::jsonb, now(), now()
FROM users u
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- legacy.id_map
-- ---------------------------------------------------------------------------

INSERT INTO legacy.id_map (old_model, old_id, new_model, new_id)
SELECT 'Business', id, 'Entity', id FROM businesses
UNION ALL SELECT 'PersonalAccount', id, 'Entity', id FROM personal_accounts
UNION ALL SELECT 'Business', entity_id, 'Account', account_id FROM _default_acct WHERE entity_id IN (SELECT id FROM businesses)
UNION ALL SELECT 'PersonalAccount', entity_id, 'Account', account_id FROM _default_acct WHERE entity_id IN (SELECT id FROM personal_accounts)
UNION ALL SELECT 'CreditCard', id, 'Account', id FROM credit_cards WHERE id IN (SELECT id FROM accounts)
UNION ALL SELECT 'InvestmentAccount', id, 'Account', id FROM investment_accounts WHERE id IN (SELECT id FROM accounts)
UNION ALL SELECT 'Transaction', id, 'LedgerEntry', id FROM transactions WHERE id IN (SELECT id FROM ledger_entries)
UNION ALL SELECT 'Transaction', tx_id, 'TransferGroup', tx_id FROM _settle
UNION ALL SELECT 'Transfer', id, 'TransferGroup', id FROM transfers WHERE id IN (SELECT id FROM transfer_groups)
UNION ALL SELECT 'Transfer', id, 'LedgerEntry', id FROM transfers WHERE id IN (SELECT id FROM ledger_entries)
UNION ALL SELECT 'Transfer', id, 'LedgerEntry', md5('transfer-to:' || id)::uuid::text FROM transfers WHERE id IN (SELECT id FROM transfer_groups)
UNION ALL SELECT 'BillTransaction', id, 'LedgerEntry', id FROM bill_transactions WHERE id IN (SELECT id FROM ledger_entries)
UNION ALL SELECT 'CreditCardStatement', id, 'CardStatement', id FROM credit_card_statements WHERE id IN (SELECT id FROM card_statements)
UNION ALL SELECT 'CreditCardBill', bill_id, 'CardStatement', stmt_id FROM _bill_stmt
UNION ALL SELECT 'Installment', id, 'InstallmentPlan', id FROM installments WHERE id IN (SELECT id FROM installment_plans)
UNION ALL SELECT 'RecurringTransaction', id, 'RecurringRule', id FROM recurring_transactions WHERE id IN (SELECT id FROM recurring_rules)
UNION ALL SELECT 'RecurringTransfer', id, 'RecurringRule', id FROM recurring_transfers WHERE id IN (SELECT id FROM recurring_rules)
UNION ALL SELECT 'InvestmentTransaction', id, 'InvestmentOperation', id FROM investment_transactions
UNION ALL SELECT 'InvestmentTransaction', id, 'LedgerEntry', "cashEntryId" FROM investment_transactions WHERE "cashEntryId" IS NOT NULL
UNION ALL SELECT 'MerchantCategoryMapping', id, 'CategorizationRule', id FROM merchant_category_mappings WHERE id IN (SELECT id FROM categorization_rules)
UNION ALL SELECT 'StatementImport', id, 'Import', id FROM statement_imports
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Reconciliation (aborts the migration on divergence)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  missing_tx int;
  missing_bt int;
  missing_tr int;
  unbalanced int;
  divergent int;
  report text;
BEGIN
  SELECT count(*) INTO missing_tx FROM transactions t
    WHERE NOT EXISTS (SELECT 1 FROM ledger_entries le WHERE le.id = t.id)
      AND coalesce(t."businessId", t."personalAccountId") IS NOT NULL;
  SELECT count(*) INTO missing_bt FROM bill_transactions bt
    WHERE NOT EXISTS (SELECT 1 FROM ledger_entries le WHERE le.id = bt.id)
      AND bt.id IN (SELECT id FROM _bt);
  SELECT count(*) INTO missing_tr FROM _tr tr
    WHERE tr.from_account IS NOT NULL AND tr.to_account IS NOT NULL
      AND (SELECT count(*) FROM ledger_entries le WHERE le."transferGroupId" = tr.id) <> 2;
  SELECT count(*) INTO unbalanced FROM transfer_groups tg
    WHERE (SELECT abs(sum(le.amount)) FROM ledger_entries le WHERE le."transferGroupId" = tg.id) > 0.0001;

  IF missing_tx + missing_bt + missing_tr + unbalanced > 0 THEN
    RAISE EXCEPTION 'ledger backfill incomplete: % transactions, % bill transactions, % transfers missing; % unbalanced transfer groups',
      missing_tx, missing_bt, missing_tr, unbalanced;
  END IF;

  -- P&L per entity and month, computed independently from the legacy tables
  -- with getSummary's rules, plus the documented legacy-bill adjustments.
  CREATE TEMP TABLE _expected ON COMMIT DROP AS
  WITH stmt_settlements AS (
    SELECT "billPaymentTransactionId" AS id FROM credit_card_statements WHERE "billPaymentTransactionId" IS NOT NULL
  ),
  legacy_paid AS (
    SELECT b."transactionId" AS id FROM credit_card_bills b
    WHERE b."transactionId" IS NOT NULL AND b."transactionId" NOT IN (SELECT id FROM stmt_settlements)
  ),
  all_rows AS (
    -- income
    SELECT coalesce(t."businessId", t."personalAccountId") AS entity_id, date_trunc('month', t.date) AS m,
           (t.amount * t."exchangeRate")::numeric AS income, 0::numeric AS expense, 0::numeric AS investment
      FROM transactions t WHERE t.type = 'income'
    UNION ALL
    -- expenses that were not statement settlements (legacy bill payments included, as before)
    SELECT coalesce(t."businessId", t."personalAccountId"), date_trunc('month', t.date), 0, (t.amount * t."exchangeRate")::numeric, 0
      FROM transactions t WHERE t.type = 'expense' AND t.id NOT IN (SELECT id FROM stmt_settlements)
    UNION ALL
    SELECT coalesce(t."businessId", t."personalAccountId"), date_trunc('month', t.date), 0, 0, (t.amount * t."exchangeRate")::numeric
      FROM transactions t WHERE t.type = 'investment'
    UNION ALL
    -- statement purchases at the statement's effective date
    SELECT p.entity_id, date_trunc('month', p.effective_date), 0, (p.amount * p.rate)::numeric, 0
      FROM _purchase p WHERE p."statementId" IS NOT NULL
    UNION ALL
    -- reimbursements: business pays (expense), personal receives (negative expense)
    SELECT tr."fromBusinessId", date_trunc('month', tr.date), 0, (tr.amount * tr."exchangeRate")::numeric, 0
      FROM transfers tr WHERE tr.direction = 'reimbursement' AND tr."fromBusinessId" IS NOT NULL
    UNION ALL
    SELECT tr."toPersonalAccountId", date_trunc('month', tr.date), 0, -(tr.amount * tr."exchangeRate")::numeric, 0
      FROM transfers tr WHERE tr.direction = 'reimbursement' AND tr."toPersonalAccountId" IS NOT NULL
    UNION ALL
    -- documented change: unlinked legacy bills now count their purchases at closing
    SELECT p.entity_id, date_trunc('month', p.effective_date), 0, (p.amount * p.rate)::numeric, 0
      FROM _purchase p WHERE p.legacy_unlinked
    UNION ALL
    -- documented change: a paid legacy bill's expense moves to the card's entity (same month)
    SELECT coalesce(t."businessId", t."personalAccountId"), date_trunc('month', t.date), 0, -(t.amount * t."exchangeRate")::numeric, 0
      FROM transactions t WHERE t.id IN (SELECT id FROM legacy_paid)
    UNION ALL
    SELECT ca."entityId", date_trunc('month', t.date), 0, (t.amount * t."exchangeRate")::numeric, 0
      FROM credit_card_bills b JOIN transactions t ON t.id = b."transactionId" JOIN accounts ca ON ca.id = b."creditCardId"
      WHERE b."transactionId" IN (SELECT id FROM legacy_paid)
  )
  SELECT entity_id, m, sum(income) AS income, sum(expense) AS expense, sum(investment) AS investment
  FROM all_rows WHERE entity_id IS NOT NULL GROUP BY entity_id, m;

  CREATE TEMP TABLE _actual ON COMMIT DROP AS
  SELECT le."entityId" AS entity_id, date_trunc('month', le."effectiveDate") AS m,
         sum(CASE WHEN le.kind = 'income' THEN le."amountBase" ELSE 0 END) AS income,
         -sum(CASE WHEN le.kind = 'expense' THEN le."amountBase" ELSE 0 END) AS expense,
         -sum(CASE WHEN le.kind = 'investment' AND a.type <> 'brokerage' THEN le."amountBase" ELSE 0 END) AS investment
  FROM ledger_entries le JOIN accounts a ON a.id = le."accountId"
  GROUP BY le."entityId", date_trunc('month', le."effectiveDate");

  SELECT count(*), string_agg(format('%s %s income %s/%s expense %s/%s investment %s/%s',
           coalesce(e.entity_id, a.entity_id), to_char(coalesce(e.m, a.m), 'YYYY-MM'),
           round(coalesce(e.income, 0), 2), round(coalesce(a.income, 0), 2),
           round(coalesce(e.expense, 0), 2), round(coalesce(a.expense, 0), 2),
           round(coalesce(e.investment, 0), 2), round(coalesce(a.investment, 0), 2)), E'\n')
    INTO divergent, report
  FROM _expected e
  FULL JOIN _actual a ON a.entity_id = e.entity_id AND a.m = e.m
  WHERE abs(coalesce(e.income, 0) - coalesce(a.income, 0)) > 0.01
     OR abs(coalesce(e.expense, 0) - coalesce(a.expense, 0)) > 0.01
     OR abs(coalesce(e.investment, 0) - coalesce(a.investment, 0)) > 0.01;

  IF divergent > 0 THEN
    RAISE EXCEPTION 'ledger reconciliation failed for % entity-months (expected/actual):%', divergent, E'\n' || report;
  END IF;

  -- Brokerage cash derived from the ledger must equal the old cashBalance.
  SELECT count(*) INTO divergent
  FROM investment_accounts ia JOIN accounts a ON a.id = ia.id
  WHERE abs(a."initialBalance" + coalesce((SELECT sum(le.amount) FROM ledger_entries le WHERE le."accountId" = a.id), 0) - ia."cashBalance"::numeric) > 0.01;
  IF divergent > 0 THEN
    RAISE EXCEPTION 'brokerage cash reconciliation failed for % accounts', divergent;
  END IF;
END $$;

COMMIT;
