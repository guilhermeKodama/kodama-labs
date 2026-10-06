-- Read-only precheck for the ledger v2 backfill.
--
-- Safe on the live production database: every statement is a SELECT, and the
-- script runs inside a read-only transaction. It uses only pre-ledger tables,
-- so run it before `prisma migrate deploy`. Save the output; step 4 is the
-- baseline that verify-ledger-migration.sql is checked against after the
-- migration.
--
--   docker --context desktop-linux exec -i postgres \
--     sh -c 'psql -U "$POSTGRES_USER" -d capital -v ON_ERROR_STOP=1' \
--     < apps/capital/scripts/precheck-ledger-migration.sql
--
-- Every row_count in section 1 must be 0 or the migration will abort.
-- Sections 2 and 3 are informational (rows that will be mapped, not dropped).
--
-- Editing 20261004200000_ledger_v2_schema, 20261004200100_ledger_v2_backfill,
-- or 20261004200200_ledger_v2_retire_legacy changes their Prisma checksums.
-- A database that already applied an older copy of those files will refuse
-- `migrate deploy` until it is recreated. Production has never applied them;
-- section 0 must return no rows.

BEGIN READ ONLY;

\echo '== 0. ledger_v2 migrations already recorded (must return no rows on prod)'
SELECT migration_name, finished_at, rolled_back_at
FROM _prisma_migrations
WHERE migration_name LIKE '%ledger_v2%'
ORDER BY migration_name;

-- Canonical ledger v2 checks. Pre-ledger tables only, so this SQL runs on
-- production before the migration. apps/capital/scripts/precheck-ledger-migration.sql
-- prints it, and 20261004200100_ledger_v2_backfill copies each block verbatim
-- (the migration test fails if the copies diverge).

\echo '== 1. Rows the backfill will refuse (every row_count must be 0)'
\echo 'Missing exchange-rate groups are omitted when there are none.'
-- BEGIN failures
WITH ia_target AS (
  SELECT ia.id,
         ia."userId",
         coalesce(
           ia."businessId",
           ia."personalAccountId",
           (SELECT p.id FROM personal_accounts p WHERE p."userId" = ia."userId" LIMIT 1),
           CASE
             WHEN ia."entityType" = 'business'
              AND NOT EXISTS (SELECT 1 FROM personal_accounts p WHERE p."userId" = ia."userId")
              AND (SELECT count(*) FROM businesses b WHERE b."userId" = ia."userId") = 1
             THEN (SELECT min(b.id) FROM businesses b WHERE b."userId" = ia."userId")
           END
         ) AS entity_id
  FROM investment_accounts ia
),
transfer_resolved AS (
  SELECT tr.id,
         tr."externalId",
         tr."fromInvestmentAccountId",
         tr."toInvestmentAccountId",
         CASE
           WHEN tr."fromInvestmentAccountId" IS NOT NULL THEN (
             SELECT t.entity_id FROM ia_target t WHERE t.id = tr."fromInvestmentAccountId"
           )
           ELSE coalesce(
             tr."fromBusinessId",
             tr."fromPersonalAccountId",
             (
               SELECT CASE tr."fromEntityType"
                 WHEN 'personal' THEN (
                   SELECT min(p.id) FROM personal_accounts p
                   WHERE p."userId" = ou.user_id
                     AND (SELECT count(*) FROM personal_accounts p2 WHERE p2."userId" = ou.user_id) = 1
                 )
                 WHEN 'business' THEN (
                   SELECT min(b.id) FROM businesses b
                   WHERE b."userId" = ou.user_id
                     AND (SELECT count(*) FROM businesses b2 WHERE b2."userId" = ou.user_id) = 1
                 )
               END
               FROM (
                 SELECT coalesce(
                   (SELECT b."userId" FROM businesses b WHERE b.id = tr."toBusinessId"),
                   (SELECT p."userId" FROM personal_accounts p WHERE p.id = tr."toPersonalAccountId"),
                   (SELECT ia."userId" FROM investment_accounts ia WHERE ia.id = tr."toInvestmentAccountId")
                 ) AS user_id
               ) ou
               WHERE tr."fromBusinessId" IS NULL
                 AND tr."fromPersonalAccountId" IS NULL
                 AND ou.user_id IS NOT NULL
             )
           )
         END AS from_entity,
         CASE
           WHEN tr."toInvestmentAccountId" IS NOT NULL THEN (
             SELECT t.entity_id FROM ia_target t WHERE t.id = tr."toInvestmentAccountId"
           )
           ELSE coalesce(
             tr."toBusinessId",
             tr."toPersonalAccountId",
             (
               SELECT CASE tr."toEntityType"
                 WHEN 'personal' THEN (
                   SELECT min(p.id) FROM personal_accounts p
                   WHERE p."userId" = ou.user_id
                     AND (SELECT count(*) FROM personal_accounts p2 WHERE p2."userId" = ou.user_id) = 1
                 )
                 WHEN 'business' THEN (
                   SELECT min(b.id) FROM businesses b
                   WHERE b."userId" = ou.user_id
                     AND (SELECT count(*) FROM businesses b2 WHERE b2."userId" = ou.user_id) = 1
                 )
               END
               FROM (
                 SELECT coalesce(
                   (SELECT b."userId" FROM businesses b WHERE b.id = tr."fromBusinessId"),
                   (SELECT p."userId" FROM personal_accounts p WHERE p.id = tr."fromPersonalAccountId"),
                   (SELECT ia."userId" FROM investment_accounts ia WHERE ia.id = tr."fromInvestmentAccountId")
                 ) AS user_id
               ) ou
               WHERE tr."toBusinessId" IS NULL
                 AND tr."toPersonalAccountId" IS NULL
                 AND ou.user_id IS NOT NULL
             )
           )
         END AS to_entity
  FROM transfers tr
),
recurring_transfer_resolved AS (
  SELECT rt.id,
         coalesce(
           rt."fromBusinessId",
           rt."fromPersonalAccountId",
           (
             SELECT CASE rt."fromEntityType"
               WHEN 'personal' THEN (
                 SELECT min(p.id) FROM personal_accounts p
                 WHERE p."userId" = ou.user_id
                   AND (SELECT count(*) FROM personal_accounts p2 WHERE p2."userId" = ou.user_id) = 1
               )
               WHEN 'business' THEN (
                 SELECT min(b.id) FROM businesses b
                 WHERE b."userId" = ou.user_id
                   AND (SELECT count(*) FROM businesses b2 WHERE b2."userId" = ou.user_id) = 1
               )
             END
             FROM (
               SELECT coalesce(
                 (SELECT b."userId" FROM businesses b WHERE b.id = rt."toBusinessId"),
                 (SELECT p."userId" FROM personal_accounts p WHERE p.id = rt."toPersonalAccountId")
               ) AS user_id
             ) ou
             WHERE rt."fromBusinessId" IS NULL
               AND rt."fromPersonalAccountId" IS NULL
               AND ou.user_id IS NOT NULL
           )
         ) AS from_entity,
         coalesce(
           rt."toBusinessId",
           rt."toPersonalAccountId",
           (
             SELECT CASE rt."toEntityType"
               WHEN 'personal' THEN (
                 SELECT min(p.id) FROM personal_accounts p
                 WHERE p."userId" = ou.user_id
                   AND (SELECT count(*) FROM personal_accounts p2 WHERE p2."userId" = ou.user_id) = 1
               )
               WHEN 'business' THEN (
                 SELECT min(b.id) FROM businesses b
                 WHERE b."userId" = ou.user_id
                   AND (SELECT count(*) FROM businesses b2 WHERE b2."userId" = ou.user_id) = 1
               )
             END
             FROM (
               SELECT coalesce(
                 (SELECT b."userId" FROM businesses b WHERE b.id = rt."fromBusinessId"),
                 (SELECT p."userId" FROM personal_accounts p WHERE p.id = rt."fromPersonalAccountId")
               ) AS user_id
             ) ou
             WHERE rt."toBusinessId" IS NULL
               AND rt."toPersonalAccountId" IS NULL
               AND ou.user_id IS NOT NULL
           )
         ) AS to_entity
  FROM recurring_transfers rt
),
fx_gaps AS (
  SELECT bt.id,
         'purchase'::text AS kind,
         bt.currency,
         to_char(bt."transactionDate" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day
  FROM bill_transactions bt
  LEFT JOIN credit_card_statements s ON s.id = bt."statementId"
  LEFT JOIN credit_card_bills bill ON bill.id = bt."billId"
  JOIN credit_cards c ON c.id = coalesce(s."creditCardId", bill."creditCardId")
  JOIN users u ON u.id = coalesce(
    (SELECT bs."userId" FROM businesses bs WHERE bs.id = c."businessId"),
    (SELECT pa."userId" FROM personal_accounts pa WHERE pa.id = c."personalAccountId")
  )
  WHERE coalesce(c."businessId", c."personalAccountId") IS NOT NULL
    AND bt.currency <> u."baseCurrency"
    AND NOT EXISTS (
      SELECT 1 FROM currencies cu
      WHERE cu."userId" = u.id AND cu.code = bt.currency AND cu."manualRate" > 0
    )
  UNION ALL
  SELECT it.id,
         'investment'::text,
         ia.currency,
         to_char(it.date AT TIME ZONE 'UTC', 'YYYY-MM-DD')
  FROM investment_transactions it
  JOIN investment_holdings h ON h.id = it."holdingId"
  JOIN investment_accounts ia ON ia.id = h."accountId"
  JOIN ia_target t ON t.id = ia.id AND t.entity_id IS NOT NULL
  JOIN users u ON u.id = ia."userId"
  WHERE (CASE it.type
           WHEN 'buy' THEN -(it."totalAmount" + it.fees)
           WHEN 'deposit' THEN -(it."totalAmount" + it.fees)
           WHEN 'sell' THEN it."totalAmount" - it.fees
           WHEN 'withdrawal' THEN it."totalAmount" - it.fees
           WHEN 'dividend' THEN it."totalAmount"
           WHEN 'yield_payment' THEN it."totalAmount"
           ELSE 0
         END) <> 0
    AND ia.currency <> u."baseCurrency"
    AND NOT EXISTS (
      SELECT 1 FROM currencies cu
      WHERE cu."userId" = u.id AND cu.code = ia.currency AND cu."manualRate" > 0
    )
),
ext_groups AS (
  SELECT format(
           'account=%s externalId=%s %s',
           account_id,
           external_id,
           string_agg(source || ':' || source_id, ' ' ORDER BY source, source_id)
         ) AS label
  FROM (
    SELECT md5('default-checking:' || coalesce(t."businessId", t."personalAccountId"))::uuid::text AS account_id,
           t."externalId" AS external_id,
           'transaction'::text AS source,
           t.id AS source_id
    FROM transactions t
    WHERE t."externalId" IS NOT NULL
      AND coalesce(t."businessId", t."personalAccountId") IS NOT NULL
    UNION ALL
    SELECT CASE
             WHEN ts."fromInvestmentAccountId" IS NOT NULL THEN ts."fromInvestmentAccountId"
             ELSE md5('default-checking:' || ts.from_entity)::uuid::text
           END,
           ts."externalId",
           'transfer'::text,
           ts.id
    FROM transfer_resolved ts
    WHERE ts."externalId" IS NOT NULL
      AND ts.from_entity IS NOT NULL
      AND ts.to_entity IS NOT NULL
  ) claims
  GROUP BY account_id, external_id
  HAVING count(*) > 1
)
SELECT category, row_count, sample_ids
FROM (
  SELECT 'transactions without an account'::text AS category,
         count(*)::int AS row_count,
         coalesce((array_agg(id ORDER BY id))[1:10], ARRAY[]::text[]) AS sample_ids
  FROM transactions
  WHERE coalesce("businessId", "personalAccountId") IS NULL
  UNION ALL
  SELECT 'credit cards without an owner',
         count(*)::int,
         coalesce((array_agg(id ORDER BY id))[1:10], ARRAY[]::text[])
  FROM credit_cards
  WHERE coalesce("businessId", "personalAccountId") IS NULL
  UNION ALL
  SELECT 'card purchases whose card was not mapped',
         count(*)::int,
         coalesce((array_agg(bt.id ORDER BY bt.id))[1:10], ARRAY[]::text[])
  FROM bill_transactions bt
  LEFT JOIN credit_card_statements s ON s.id = bt."statementId"
  LEFT JOIN credit_card_bills bill ON bill.id = bt."billId"
  LEFT JOIN credit_cards c ON c.id = coalesce(s."creditCardId", bill."creditCardId")
  WHERE c.id IS NULL OR coalesce(c."businessId", c."personalAccountId") IS NULL
  UNION ALL
  SELECT 'transfers missing a side',
         count(*)::int,
         coalesce((array_agg(id ORDER BY id))[1:10], ARRAY[]::text[])
  FROM transfer_resolved
  WHERE from_entity IS NULL OR to_entity IS NULL
  UNION ALL
  SELECT 'investment accounts without an owner',
         count(*)::int,
         coalesce((array_agg(id ORDER BY id))[1:10], ARRAY[]::text[])
  FROM ia_target
  WHERE entity_id IS NULL
  UNION ALL
  SELECT 'budgets without an owner',
         count(*)::int,
         coalesce((array_agg(id ORDER BY id))[1:10], ARRAY[]::text[])
  FROM budgets
  WHERE coalesce("businessId", "personalAccountId") IS NULL
  UNION ALL
  SELECT 'budgets with an unmappable category',
         count(*)::int,
         coalesce((array_agg(id ORDER BY id))[1:10], ARRAY[]::text[])
  FROM budgets
  WHERE coalesce("businessId", "personalAccountId") IS NOT NULL
    AND btrim(category) = ''
  UNION ALL
  SELECT 'recurring transactions without an owner',
         count(*)::int,
         coalesce((array_agg(id ORDER BY id))[1:10], ARRAY[]::text[])
  FROM recurring_transactions
  WHERE coalesce("businessId", "personalAccountId") IS NULL
  UNION ALL
  SELECT 'recurring transfers missing a side',
         count(*)::int,
         coalesce((array_agg(id ORDER BY id))[1:10], ARRAY[]::text[])
  FROM recurring_transfer_resolved
  WHERE from_entity IS NULL OR to_entity IS NULL
  UNION ALL
  SELECT 'reminder dispatches whose recurring item will not migrate',
         count(*)::int,
         coalesce((array_agg(d.id ORDER BY d.id))[1:10], ARRAY[]::text[])
  FROM reminder_dispatches d
  JOIN recurring_transactions r ON r.id = d."recurringTransactionId"
  WHERE coalesce(r."businessId", r."personalAccountId") IS NULL
  UNION ALL
  SELECT 'installments whose card was not mapped',
         count(*)::int,
         coalesce((array_agg(i.id ORDER BY i.id))[1:10], ARRAY[]::text[])
  FROM installments i
  LEFT JOIN credit_cards c ON c.id = i."creditCardId"
  WHERE c.id IS NULL OR coalesce(c."businessId", c."personalAccountId") IS NULL
  UNION ALL
  SELECT 'card statements whose card was not mapped',
         count(*)::int,
         coalesce((array_agg(s.id ORDER BY s.id))[1:10], ARRAY[]::text[])
  FROM credit_card_statements s
  LEFT JOIN credit_cards c ON c.id = s."creditCardId"
  WHERE c.id IS NULL OR coalesce(c."businessId", c."personalAccountId") IS NULL
  UNION ALL
  SELECT 'legacy bills whose card was not mapped',
         count(*)::int,
         coalesce((array_agg(b.id ORDER BY b.id))[1:10], ARRAY[]::text[])
  FROM credit_card_bills b
  LEFT JOIN credit_cards c ON c.id = b."creditCardId"
  WHERE c.id IS NULL OR coalesce(c."businessId", c."personalAccountId") IS NULL
  UNION ALL
  SELECT 'externalId collision',
         (SELECT count(*)::int FROM ext_groups),
         coalesce((SELECT (array_agg(label ORDER BY label))[1:10] FROM ext_groups), ARRAY[]::text[])
  UNION ALL
  SELECT format('missing exchange rate: %s %s %s', kind, currency, day),
         count(*)::int,
         coalesce((array_agg(id ORDER BY id))[1:10], ARRAY[]::text[])
  FROM fx_gaps
  GROUP BY kind, currency, day
) checks
ORDER BY category
-- END failures
;

\echo '== 2. Rows the new unambiguous rules will map'
-- BEGIN remaps
WITH ia_target AS (
  SELECT ia.id,
         coalesce(
           ia."businessId",
           ia."personalAccountId",
           (SELECT p.id FROM personal_accounts p WHERE p."userId" = ia."userId" LIMIT 1),
           CASE
             WHEN ia."entityType" = 'business'
              AND NOT EXISTS (SELECT 1 FROM personal_accounts p WHERE p."userId" = ia."userId")
              AND (SELECT count(*) FROM businesses b WHERE b."userId" = ia."userId") = 1
             THEN (SELECT min(b.id) FROM businesses b WHERE b."userId" = ia."userId")
           END
         ) AS entity_id
  FROM investment_accounts ia
),
transfer_resolved AS (
  SELECT tr.id,
         tr."fromInvestmentAccountId",
         tr."fromBusinessId",
         tr."fromPersonalAccountId",
         tr."toInvestmentAccountId",
         tr."toBusinessId",
         tr."toPersonalAccountId",
         CASE
           WHEN tr."fromInvestmentAccountId" IS NOT NULL THEN (
             SELECT t.entity_id FROM ia_target t WHERE t.id = tr."fromInvestmentAccountId"
           )
           ELSE coalesce(
             tr."fromBusinessId",
             tr."fromPersonalAccountId",
             (
               SELECT CASE tr."fromEntityType"
                 WHEN 'personal' THEN (
                   SELECT min(p.id) FROM personal_accounts p
                   WHERE p."userId" = ou.user_id
                     AND (SELECT count(*) FROM personal_accounts p2 WHERE p2."userId" = ou.user_id) = 1
                 )
                 WHEN 'business' THEN (
                   SELECT min(b.id) FROM businesses b
                   WHERE b."userId" = ou.user_id
                     AND (SELECT count(*) FROM businesses b2 WHERE b2."userId" = ou.user_id) = 1
                 )
               END
               FROM (
                 SELECT coalesce(
                   (SELECT b."userId" FROM businesses b WHERE b.id = tr."toBusinessId"),
                   (SELECT p."userId" FROM personal_accounts p WHERE p.id = tr."toPersonalAccountId"),
                   (SELECT ia."userId" FROM investment_accounts ia WHERE ia.id = tr."toInvestmentAccountId")
                 ) AS user_id
               ) ou
               WHERE tr."fromBusinessId" IS NULL
                 AND tr."fromPersonalAccountId" IS NULL
                 AND ou.user_id IS NOT NULL
             )
           )
         END AS from_entity,
         CASE
           WHEN tr."toInvestmentAccountId" IS NOT NULL THEN (
             SELECT t.entity_id FROM ia_target t WHERE t.id = tr."toInvestmentAccountId"
           )
           ELSE coalesce(
             tr."toBusinessId",
             tr."toPersonalAccountId",
             (
               SELECT CASE tr."toEntityType"
                 WHEN 'personal' THEN (
                   SELECT min(p.id) FROM personal_accounts p
                   WHERE p."userId" = ou.user_id
                     AND (SELECT count(*) FROM personal_accounts p2 WHERE p2."userId" = ou.user_id) = 1
                 )
                 WHEN 'business' THEN (
                   SELECT min(b.id) FROM businesses b
                   WHERE b."userId" = ou.user_id
                     AND (SELECT count(*) FROM businesses b2 WHERE b2."userId" = ou.user_id) = 1
                 )
               END
               FROM (
                 SELECT coalesce(
                   (SELECT b."userId" FROM businesses b WHERE b.id = tr."fromBusinessId"),
                   (SELECT p."userId" FROM personal_accounts p WHERE p.id = tr."fromPersonalAccountId"),
                   (SELECT ia."userId" FROM investment_accounts ia WHERE ia.id = tr."fromInvestmentAccountId")
                 ) AS user_id
               ) ou
               WHERE tr."toBusinessId" IS NULL
                 AND tr."toPersonalAccountId" IS NULL
                 AND ou.user_id IS NOT NULL
             )
           )
         END AS to_entity
  FROM transfers tr
),
recurring_transfer_resolved AS (
  SELECT rt.id,
         rt."fromBusinessId",
         rt."fromPersonalAccountId",
         rt."toBusinessId",
         rt."toPersonalAccountId",
         coalesce(
           rt."fromBusinessId",
           rt."fromPersonalAccountId",
           (
             SELECT CASE rt."fromEntityType"
               WHEN 'personal' THEN (
                 SELECT min(p.id) FROM personal_accounts p
                 WHERE p."userId" = ou.user_id
                   AND (SELECT count(*) FROM personal_accounts p2 WHERE p2."userId" = ou.user_id) = 1
               )
               WHEN 'business' THEN (
                 SELECT min(b.id) FROM businesses b
                 WHERE b."userId" = ou.user_id
                   AND (SELECT count(*) FROM businesses b2 WHERE b2."userId" = ou.user_id) = 1
               )
             END
             FROM (
               SELECT coalesce(
                 (SELECT b."userId" FROM businesses b WHERE b.id = rt."toBusinessId"),
                 (SELECT p."userId" FROM personal_accounts p WHERE p.id = rt."toPersonalAccountId")
               ) AS user_id
             ) ou
             WHERE rt."fromBusinessId" IS NULL
               AND rt."fromPersonalAccountId" IS NULL
               AND ou.user_id IS NOT NULL
           )
         ) AS from_entity,
         coalesce(
           rt."toBusinessId",
           rt."toPersonalAccountId",
           (
             SELECT CASE rt."toEntityType"
               WHEN 'personal' THEN (
                 SELECT min(p.id) FROM personal_accounts p
                 WHERE p."userId" = ou.user_id
                   AND (SELECT count(*) FROM personal_accounts p2 WHERE p2."userId" = ou.user_id) = 1
               )
               WHEN 'business' THEN (
                 SELECT min(b.id) FROM businesses b
                 WHERE b."userId" = ou.user_id
                   AND (SELECT count(*) FROM businesses b2 WHERE b2."userId" = ou.user_id) = 1
               )
             END
             FROM (
               SELECT coalesce(
                 (SELECT b."userId" FROM businesses b WHERE b.id = rt."fromBusinessId"),
                 (SELECT p."userId" FROM personal_accounts p WHERE p.id = rt."fromPersonalAccountId")
               ) AS user_id
             ) ou
             WHERE rt."toBusinessId" IS NULL
               AND rt."toPersonalAccountId" IS NULL
               AND ou.user_id IS NOT NULL
           )
         ) AS to_entity
  FROM recurring_transfers rt
)
SELECT category, row_count, sample_ids
FROM (
  SELECT 'transfers the new rule will map'::text AS category,
         count(*)::int AS row_count,
         coalesce((array_agg(tr.id ORDER BY tr.id))[1:10], ARRAY[]::text[]) AS sample_ids
  FROM transfer_resolved tr
  WHERE tr.from_entity IS NOT NULL
    AND tr.to_entity IS NOT NULL
    AND (
      (tr."fromInvestmentAccountId" IS NULL AND tr."fromBusinessId" IS NULL AND tr."fromPersonalAccountId" IS NULL)
      OR (tr."toInvestmentAccountId" IS NULL AND tr."toBusinessId" IS NULL AND tr."toPersonalAccountId" IS NULL)
    )
  UNION ALL
  SELECT 'recurring transfers the new rule will map',
         count(*)::int,
         coalesce((array_agg(rt.id ORDER BY rt.id))[1:10], ARRAY[]::text[])
  FROM recurring_transfer_resolved rt
  WHERE rt.from_entity IS NOT NULL
    AND rt.to_entity IS NOT NULL
    AND (
      (rt."fromBusinessId" IS NULL AND rt."fromPersonalAccountId" IS NULL)
      OR (rt."toBusinessId" IS NULL AND rt."toPersonalAccountId" IS NULL)
    )
  UNION ALL
  SELECT 'investment accounts the new rule will map',
         count(*)::int,
         coalesce((array_agg(ia.id ORDER BY ia.id))[1:10], ARRAY[]::text[])
  FROM investment_accounts ia
  WHERE ia."businessId" IS NULL
    AND ia."personalAccountId" IS NULL
    AND NOT EXISTS (SELECT 1 FROM personal_accounts p WHERE p."userId" = ia."userId")
    AND ia."entityType" = 'business'
    AND (SELECT count(*) FROM businesses b WHERE b."userId" = ia."userId") = 1
) checks
ORDER BY category
-- END remaps
;

\echo '== 3. Business brokerages that fall back to the personal entity'
-- BEGIN fallbacks
SELECT 'business brokerages mapped to the personal entity'::text AS category,
       count(*)::int AS row_count,
       coalesce((array_agg(ia.id ORDER BY ia.id))[1:10], ARRAY[]::text[]) AS sample_ids
FROM investment_accounts ia
WHERE ia."businessId" IS NULL
  AND ia."personalAccountId" IS NULL
  AND ia."entityType" = 'business'
  AND EXISTS (SELECT 1 FROM personal_accounts p WHERE p."userId" = ia."userId")
-- END fallbacks
;

\echo '== 4. Pre-migration totals (record these and compare with verify-ledger-migration.sql)'
\echo '-- 4a. Row counts. After migration, verify section 1 legacy counts must match.'
SELECT 'transactions'::text AS source, count(*) FROM transactions
UNION ALL SELECT 'bill_transactions', count(*) FROM bill_transactions
UNION ALL SELECT 'transfers', count(*) FROM transfers
UNION ALL SELECT 'investment_transactions', count(*) FROM investment_transactions;

\echo '-- 4b. Card purchases. verify section 3 legacy_n and legacy_sum must match.'
SELECT count(*) AS purchase_n,
       round(coalesce(sum(abs(amount)), 0)::numeric, 2) AS purchase_abs_sum
FROM bill_transactions;

\echo '-- 4c. Income/expense/investment per user, excluding bill payments that become card_payment transfers.'
\echo '--     verify section 4 legacy_sum must match amount, per user and type.'
WITH card_payments AS (
  SELECT s."billPaymentTransactionId" AS id
  FROM credit_card_statements s
  JOIN credit_cards c ON c.id = s."creditCardId"
  WHERE s."billPaymentTransactionId" IS NOT NULL
    AND coalesce(c."businessId", c."personalAccountId") IS NOT NULL
  UNION
  SELECT b."transactionId"
  FROM credit_card_bills b
  JOIN credit_cards c ON c.id = b."creditCardId"
  WHERE b."transactionId" IS NOT NULL
    AND coalesce(c."businessId", c."personalAccountId") IS NOT NULL
)
SELECT coalesce(bu."userId", pa."userId") AS user_id,
       t.type::text AS type,
       round(coalesce(sum(t.amount * coalesce(t."exchangeRate", 1)), 0)::numeric, 2) AS amount,
       count(*) AS n
FROM transactions t
LEFT JOIN businesses bu ON bu.id = t."businessId"
LEFT JOIN personal_accounts pa ON pa.id = t."personalAccountId"
WHERE NOT EXISTS (SELECT 1 FROM card_payments cp WHERE cp.id = t.id)
GROUP BY 1, 2
ORDER BY 1, 2;

\echo '-- 4d. Bill payments that become card_payment transfers. verify section 5 must match.'
WITH card_payments AS (
  SELECT s."billPaymentTransactionId" AS id
  FROM credit_card_statements s
  JOIN credit_cards c ON c.id = s."creditCardId"
  WHERE s."billPaymentTransactionId" IS NOT NULL
    AND coalesce(c."businessId", c."personalAccountId") IS NOT NULL
  UNION
  SELECT b."transactionId"
  FROM credit_card_bills b
  JOIN credit_cards c ON c.id = b."creditCardId"
  WHERE b."transactionId" IS NOT NULL
    AND coalesce(c."businessId", c."personalAccountId") IS NOT NULL
)
SELECT coalesce(bu."userId", pa."userId") AS user_id,
       count(*) AS n,
       round(coalesce(sum(t.amount * coalesce(t."exchangeRate", 1)), 0)::numeric, 2) AS amount
FROM transactions t
JOIN card_payments cp ON cp.id = t.id
LEFT JOIN businesses bu ON bu.id = t."businessId"
LEFT JOIN personal_accounts pa ON pa.id = t."personalAccountId"
GROUP BY 1
ORDER BY 1;

\echo '-- 4e. Transfers. verify section 6 ledger_legs must be twice this count.'
SELECT count(*) AS transfers FROM transfers;

ROLLBACK;
