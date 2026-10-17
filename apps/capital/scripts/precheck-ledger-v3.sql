-- Read-only precheck for the ledger v3 cutover (docs/ledger-v3-architecture.md).
--
-- Safe on the live production database: every statement is a SELECT inside a
-- read-only transaction. Run it before any v3 migration, save the output, and
-- record a decision for every row of section 1 before the cutover.
--
--   docker --context desktop-linux exec -i postgres \
--     psql -U root -d capital -v ON_ERROR_STOP=1 \
--     < apps/capital/scripts/precheck-ledger-v3.sql
--
-- Section 1 lists the data the v3 projection cannot map on its own. Section 2
-- is informational. Section 3 is the baseline the v3 verification is checked
-- against after the projection.

BEGIN READ ONLY;

\echo '== 0. ledger_v3 migrations already recorded (must return no rows)'
SELECT migration_name, finished_at
FROM _prisma_migrations
WHERE migration_name LIKE '%ledger_v3%'
ORDER BY migration_name;

\echo '== 1a. Entries in a currency other than their account (v3 keeps every posting in its account commodity)'
SELECT u.email, e.name AS entity, a.id AS account_id, a.name AS account, a.type AS account_type,
       a.currency AS account_currency, le.currency AS entry_currency, le.kind,
       count(*) AS rows, sum(le.amount) AS amount, sum(le."amountBase") AS amount_base,
       min(le.date)::date AS first, max(le.date)::date AS last
FROM ledger_entries le
JOIN accounts a ON a.id = le."accountId"
JOIN entities e ON e.id = a."entityId"
JOIN users u ON u.id = le."userId"
WHERE le."deletedAt" IS NULL AND upper(le.currency) <> upper(a.currency)
GROUP BY u.email, e.name, a.id, a.name, a.type, a.currency, le.currency, le.kind
ORDER BY 1, 2, 4, 8;

\echo '== 1b. Accounts whose currency differs from their entity default (possible mislabelled account)'
SELECT u.email, e.name AS entity, e."defaultCurrency", a.id AS account_id, a.name AS account, a.type, a.currency,
       a."initialBalance",
       (SELECT count(*) FROM ledger_entries le WHERE le."accountId" = a.id AND le."deletedAt" IS NULL AND upper(le.currency) = upper(a.currency)) AS rows_in_account_currency,
       (SELECT count(*) FROM ledger_entries le WHERE le."accountId" = a.id AND le."deletedAt" IS NULL AND upper(le.currency) <> upper(a.currency)) AS rows_in_other_currency,
       (SELECT count(*) FROM ledger_entries le WHERE le."accountId" = a.id AND le."deletedAt" IS NOT NULL) AS trashed_rows
FROM accounts a
JOIN entities e ON e.id = a."entityId"
JOIN users u ON u.id = a."userId"
WHERE a.currency <> e."defaultCurrency" OR a.currency <> u."baseCurrency"
ORDER BY 1, 2, 4;

\echo '== 1c. Live operations whose cash leg is in the trash'
SELECT u.email, a.name AS broker, coalesce(h.ticker, h.name) AS holding, o.type, o.date::date,
       o.quantity, o."totalAmount", le."deletedAt"::date AS leg_trashed
FROM investment_operations o
JOIN investment_holdings h ON h.id = o."holdingId"
JOIN accounts a ON a.id = h."accountId"
JOIN users u ON u.id = a."userId"
JOIN ledger_entries le ON le.id = o."cashEntryId"
WHERE le."deletedAt" IS NOT NULL
ORDER BY 1, 2, 5;

\echo '== 1d. Cash-moving operations with no cash leg (opening lots, or legs lost to SET NULL)'
SELECT u.email, a.name AS broker, coalesce(h.ticker, h.name) AS holding, o.type, o.date::date,
       o.quantity, o."totalAmount", o.fees,
       NOT EXISTS (
         SELECT 1 FROM investment_operations p
         WHERE p."holdingId" = o."holdingId"
           AND (p.date < o.date OR (p.date = o.date AND p."createdAt" < o."createdAt"))
       ) AS first_op_of_holding
FROM investment_operations o
JOIN investment_holdings h ON h.id = o."holdingId"
JOIN accounts a ON a.id = h."accountId"
JOIN users u ON u.id = a."userId"
WHERE o."cashEntryId" IS NULL
  -- the cash the operation moves (portfolio.ts cashImpact): only those that move some
  AND CASE
        WHEN o.type IN ('buy', 'deposit') THEN o."totalAmount" + o.fees
        WHEN o.type IN ('sell', 'withdrawal') THEN o."totalAmount" - o.fees
        WHEN o.type IN ('dividend', 'yield_payment') THEN o."totalAmount" - o."taxWithheld"
        ELSE 0
      END <> 0
ORDER BY 1, 2, 5;

\echo '== 1e. Holdings with a stored position and no operations'
SELECT u.email, a.name AS broker, coalesce(h.ticker, h.name) AS holding, h."assetClass",
       h.currency, h."currentQuantity", h."totalInvested", h."isActive", h."createdAt"::date
FROM investment_holdings h
JOIN accounts a ON a.id = h."accountId"
JOIN users u ON u.id = a."userId"
WHERE NOT EXISTS (SELECT 1 FROM investment_operations o WHERE o."holdingId" = h.id)
  AND (h."currentQuantity" <> 0 OR h."totalInvested" <> 0)
ORDER BY 1, 2, 3;

\echo '== 1f. Deactivated holdings that still hold a position'
SELECT u.email, a.name AS broker, coalesce(h.ticker, h.name) AS holding, h.currency,
       h."currentQuantity", h."totalInvested", h."updatedAt"::date AS deactivated_at
FROM investment_holdings h
JOIN accounts a ON a.id = h."accountId"
JOIN users u ON u.id = a."userId"
WHERE NOT h."isActive" AND (h."currentQuantity" > 0 OR h."totalInvested" > 0)
ORDER BY 1, 2, 3;

\echo '== 1g. Position adjustments (become explicit differences against Ajustes)'
SELECT u.email, a.name AS broker, coalesce(h.ticker, h.name) AS holding, o.date::date,
       o."adjustmentMode", o.quantity, o."pricePerUnit", o."totalAmount", o.notes
FROM investment_operations o
JOIN investment_holdings h ON h.id = o."holdingId"
JOIN accounts a ON a.id = h."accountId"
JOIN users u ON u.id = a."userId"
WHERE o.type = 'adjustment'
ORDER BY 1, 2, 4;

\echo '== 1h. Caixinha rows on bank accounts (investment kind, no transfer, no operation)'
\echo 'matched_broker_leg: a brokerage leg in the same entity within R$ 0.01 and 3 days already covers the row.'
SELECT u.email, a.name AS account, le.date::date, le.description, le."amountBase",
       EXISTS (
         SELECT 1 FROM ledger_entries b
         JOIN accounts ba ON ba.id = b."accountId" AND ba.type = 'brokerage'
         WHERE b."deletedAt" IS NULL AND b."entityId" = le."entityId"
           AND abs(abs(b."amountBase") - abs(le."amountBase")) <= 0.01
           AND abs(extract(epoch FROM b.date - le.date)) <= 3 * 86400
       ) AS matched_broker_leg
FROM ledger_entries le
JOIN accounts a ON a.id = le."accountId" AND a.type IN ('checking', 'cash')
JOIN users u ON u.id = le."userId"
WHERE le."deletedAt" IS NULL AND le.kind = 'investment' AND le."transferGroupId" IS NULL
  AND NOT EXISTS (SELECT 1 FROM investment_operations o WHERE o."cashEntryId" = le.id)
ORDER BY 1, 2, 3;

\echo '== 1i. Categories of type investment used by live entries'
SELECT u.email, c.name, count(le.id) AS rows, sum(le."amountBase") AS amount_base
FROM categories c
JOIN users u ON u.id = c."userId"
JOIN ledger_entries le ON le."categoryId" = c.id AND le."deletedAt" IS NULL
WHERE c.type = 'investment'
GROUP BY 1, 2
ORDER BY 1, 2;

\echo '== 1j. Transfer legs that still carry a category (dropped by the projection)'
SELECT u.email, tg.direction, c.name AS category, count(*) AS legs, sum(le."amountBase") AS amount_base
FROM ledger_entries le
JOIN transfer_groups tg ON tg.id = le."transferGroupId"
JOIN categories c ON c.id = le."categoryId"
JOIN users u ON u.id = le."userId"
WHERE le."deletedAt" IS NULL AND tg."deletedAt" IS NULL
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3;

\echo '== 1k. Live transfer groups without exactly 2 live legs or that do not sum to zero'
SELECT tg.id, tg.direction, tg.date::date, count(le.id) AS legs, coalesce(sum(le."amountBase"), 0) AS sum_base
FROM transfer_groups tg
LEFT JOIN ledger_entries le ON le."transferGroupId" = tg.id AND le."deletedAt" IS NULL
WHERE tg."deletedAt" IS NULL
GROUP BY tg.id, tg.direction, tg.date
HAVING count(le.id) <> 2 OR abs(coalesce(sum(le."amountBase"), 0)) > 0.01
ORDER BY 3;

\echo '== 1l. Card purchases with no statement'
SELECT u.email, a.name AS card, count(*) AS rows, sum(le."amountBase") AS amount_base
FROM ledger_entries le
JOIN accounts a ON a.id = le."accountId" AND a.type = 'credit_card'
JOIN users u ON u.id = le."userId"
WHERE le."deletedAt" IS NULL AND le."transferGroupId" IS NULL AND le."cardStatementId" IS NULL
GROUP BY 1, 2
ORDER BY 1, 2;

\echo '== 1m. Recurring rules of kind investment with no destination account'
SELECT u.email, r.description, r.amount, r.currency, r."isActive"
FROM recurring_rules r
JOIN users u ON u.id = r."userId"
WHERE r.kind = 'investment' AND r."toAccountId" IS NULL
ORDER BY 1, 2;

\echo '== 2a. Users, entities and accounts'
SELECT u.email, e.kind, e.name AS entity, a.type, count(a.id) AS accounts,
       count(a.id) FILTER (WHERE a."archivedAt" IS NOT NULL) AS archived
FROM users u
JOIN entities e ON e."userId" = u.id
LEFT JOIN accounts a ON a."entityId" = e.id
GROUP BY 1, 2, 3, 4
ORDER BY 1, 2, 3, 4;

\echo '== 2b. Categories used by more than one entity (become one account per entity with a shared categoryKey)'
SELECT u.email, c.name, c.type, count(DISTINCT le."entityId") AS entities
FROM categories c
JOIN users u ON u.id = c."userId"
JOIN ledger_entries le ON le."categoryId" = c.id AND le."deletedAt" IS NULL
GROUP BY 1, 2, 3
HAVING count(DISTINCT le."entityId") > 1
ORDER BY 1, 2;

\echo '== 2c. Cross-entity transfers by direction (become intercompany postings)'
SELECT u.email, tg.direction, count(DISTINCT tg.id) AS groups
FROM transfer_groups tg
JOIN users u ON u.id = tg."userId"
WHERE tg."deletedAt" IS NULL
  AND (SELECT count(DISTINCT le."entityId") FROM ledger_entries le WHERE le."transferGroupId" = tg.id AND le."deletedAt" IS NULL) > 1
GROUP BY 1, 2
ORDER BY 1, 2;

\echo '== 2d. Budgets, rules and undo history'
SELECT u.email,
       (SELECT count(*) FROM budgets b WHERE b."userId" = u.id AND b."isActive") AS active_budgets,
       (SELECT count(*) FROM budgets b WHERE b."userId" = u.id AND b."isActive" AND b."entityId" IS NULL) AS all_entity_budgets,
       (SELECT count(*) FROM categorization_rules r WHERE r."userId" = u.id) AS rules,
       (SELECT count(*) FROM mutation_batches m WHERE m."userId" = u.id) AS undo_batches
FROM users u
ORDER BY 1;

\echo '== 2e. Projected installment rows (future parcels from card imports)'
SELECT u.email, count(*) AS rows, sum(le."amountBase") AS amount_base
FROM ledger_entries le
JOIN users u ON u.id = le."userId"
WHERE le."deletedAt" IS NULL AND le.metadata ->> 'projected' = 'true'
GROUP BY 1
ORDER BY 1;

\echo '== 3a. Baseline: balance per account (account currency) and base amount'
SELECT u.email, e.name AS entity, a.id AS account_id, a.name AS account, a.type, a.currency,
       a."initialBalance" + coalesce(sum(le.amount) FILTER (WHERE le."deletedAt" IS NULL), 0) AS balance,
       coalesce(sum(le."amountBase") FILTER (WHERE le."deletedAt" IS NULL), 0) AS sum_base,
       count(le.id) FILTER (WHERE le."deletedAt" IS NULL) AS rows
FROM accounts a
JOIN entities e ON e.id = a."entityId"
JOIN users u ON u.id = a."userId"
LEFT JOIN ledger_entries le ON le."accountId" = a.id
GROUP BY u.email, e.name, a.id, a.name, a.type, a.currency, a."initialBalance"
ORDER BY 1, 2, 4, 3;

\echo '== 3b. Baseline: income and expense per entity, category and month (date)'
SELECT u.email, e.id AS entity_id, e.name AS entity, c.id AS category_id, coalesce(c.name, '(sem categoria)') AS category, le.kind,
       to_char(le.date, 'YYYY-MM') AS month, count(*) AS rows, sum(le."amountBase") AS amount_base
FROM ledger_entries le
JOIN entities e ON e.id = le."entityId"
JOIN users u ON u.id = le."userId"
LEFT JOIN categories c ON c.id = le."categoryId"
WHERE le."deletedAt" IS NULL AND le."transferGroupId" IS NULL AND le.kind IN ('income', 'expense')
GROUP BY u.email, e.id, e.name, c.id, c.name, le.kind, to_char(le.date, 'YYYY-MM')
ORDER BY 1, 3, 7, 5, 4;

\echo '== 3c. Baseline: card statement totals (live purchases and refunds)'
SELECT u.email, a.name AS card, cs.month, count(le.id) AS rows, coalesce(sum(le."amountBase"), 0) AS amount_base
FROM card_statements cs
JOIN accounts a ON a.id = cs."accountId"
JOIN users u ON u.id = a."userId"
LEFT JOIN ledger_entries le ON le."cardStatementId" = cs.id AND le."deletedAt" IS NULL AND le."transferGroupId" IS NULL
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3;

\echo '== 3d. Baseline: stored holdings'
SELECT u.email, a.name AS broker, coalesce(h.ticker, h.name) AS holding, h.currency, h."isActive",
       h."currentQuantity", h."averageCost", h."totalInvested",
       (SELECT count(*) FROM investment_operations o WHERE o."holdingId" = h.id) AS operations
FROM investment_holdings h
JOIN accounts a ON a.id = h."accountId"
JOIN users u ON u.id = a."userId"
ORDER BY 1, 2, 3;

\echo '== 3e. Baseline: live transfer groups by direction'
SELECT u.email, tg.direction, count(*) AS groups
FROM transfer_groups tg
JOIN users u ON u.id = tg."userId"
WHERE tg."deletedAt" IS NULL
GROUP BY 1, 2
ORDER BY 1, 2;

ROLLBACK;
