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
         -- timestamp without time zone: the stored calendar date, not the session zone
         to_char(bt."transactionDate", 'YYYY-MM-DD') AS day
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
         to_char(it.date, 'YYYY-MM-DD') -- stored calendar date; see the purchase branch
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

\echo '== 3b. Foreign rows stored at exchangeRate 1 (informational; the migration keeps that rate)'
\echo 'A non-zero count does not block the migration.'
-- BEGIN flat-rates
SELECT 'transactions stored at exchangeRate 1'::text AS category,
       count(*)::int AS row_count,
       coalesce((array_agg(t.id ORDER BY t.id))[1:10], ARRAY[]::text[]) AS sample_ids
FROM transactions t
JOIN users u ON u.id = coalesce(
  (SELECT b."userId" FROM businesses b WHERE b.id = t."businessId"),
  (SELECT p."userId" FROM personal_accounts p WHERE p.id = t."personalAccountId")
)
WHERE t.currency <> u."baseCurrency"
  AND t."exchangeRate" = 1
UNION ALL
SELECT 'transfers stored at exchangeRate 1',
       count(*)::int,
       coalesce((array_agg(tr.id ORDER BY tr.id))[1:10], ARRAY[]::text[])
FROM transfers tr
JOIN users u ON u.id = coalesce(
  (SELECT b."userId" FROM businesses b WHERE b.id = tr."fromBusinessId"),
  (SELECT p."userId" FROM personal_accounts p WHERE p.id = tr."fromPersonalAccountId"),
  (SELECT ia."userId" FROM investment_accounts ia WHERE ia.id = tr."fromInvestmentAccountId"),
  (SELECT b."userId" FROM businesses b WHERE b.id = tr."toBusinessId"),
  (SELECT p."userId" FROM personal_accounts p WHERE p.id = tr."toPersonalAccountId"),
  (SELECT ia."userId" FROM investment_accounts ia WHERE ia.id = tr."toInvestmentAccountId")
)
WHERE tr.currency <> u."baseCurrency"
  AND tr."exchangeRate" = 1
-- END flat-rates
;

\echo '== 3c. Bill purchases whose bill payment is also a statement settlement (informational)'
\echo 'A non-zero count does not block. The backfill does not insert these as expenses.'
\echo 'verify section 3b skipped_n and skipped_abs_sum must match row_count and amount_abs_sum.'
-- BEGIN shadowed
SELECT 'bill purchases whose bill payment is also a statement settlement'::text AS category,
       count(*)::int AS row_count,
       coalesce((array_agg(id ORDER BY id))[1:10], ARRAY[]::text[]) AS sample_ids,
       round(coalesce(sum(abs(amount)), 0)::numeric, 2) AS amount_abs_sum
FROM (
-- BEGIN shadow-rows
SELECT bt.id, bt.amount
FROM bill_transactions bt
JOIN credit_card_bills b ON b.id = bt."billId"
WHERE bt."statementId" IS NULL
  AND EXISTS (
    SELECT 1 FROM credit_card_statements s
    WHERE s."billPaymentTransactionId" = b."transactionId"
  )
-- END shadow-rows
) shadowed
-- END shadowed
;
