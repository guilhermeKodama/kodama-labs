-- One-off data fix, 2026-10-13.
--
-- One personal "Conta principal" is labelled USD, and so is its entity,
-- but the account holds reais: every row on it is in BRL with rate 1,
-- and the user's base currency is BRL. The label came from the ledger v2
-- backfill. It matters now: a transfer written into the account follows
-- the label, so its leg is stored as dollars at the day's rate, and the
-- account's balance then adds dollars to reais.
--
-- What this does, in one transaction:
--   1. turns each leg that was written in the wrong currency back into
--      reais (amount = its base amount, rate 1);
--   2. relabels the account and its entity as BRL.
--
-- It refuses to run when a row in another currency is anything but the
-- leg of a transfer whose other leg is in BRL for the same base amount:
-- such a row needs a person to decide what it meant.
--
-- Running it twice is safe: the second run changes nothing.
-- See README.md in this folder for backup, verification and reversal.

\set ON_ERROR_STOP on
\pset pager off

BEGIN;

\echo == before
SELECT a.currency AS account_currency, e."defaultCurrency" AS entity_currency, u."baseCurrency" AS user_base
FROM accounts a
JOIN entities e ON e.id = a."entityId"
JOIN users u ON u.id = a."userId"
WHERE a.id = 'd0255afb-2a52-a1bb-2d3c-fe76d1ddadba';

SELECT currency, count(*) AS rows, sum(amount) AS amount, sum("amountBase") AS amount_base
FROM ledger_entries
WHERE "accountId" = 'd0255afb-2a52-a1bb-2d3c-fe76d1ddadba'
GROUP BY currency
ORDER BY currency;

\echo == rows on the account that are not in BRL, with the other leg of their transfer
SELECT l.id, l.date::date AS day, l.kind, l.currency, l.amount, l."exchangeRate" AS rate, l."amountBase" AS amount_base,
       other.currency AS other_currency, other."amountBase" AS other_base
FROM ledger_entries l
LEFT JOIN ledger_entries other ON other."transferGroupId" = l."transferGroupId" AND other.id <> l.id
WHERE l."accountId" = 'd0255afb-2a52-a1bb-2d3c-fe76d1ddadba' AND l.currency <> 'BRL'
ORDER BY l.date;

DO $$
DECLARE
  target constant text := 'd0255afb-2a52-a1bb-2d3c-fe76d1ddadba';
  base text;
  unexplained integer;
  foreign_accounts integer;
BEGIN
  SELECT u."baseCurrency" INTO base
  FROM accounts a JOIN users u ON u.id = a."userId"
  WHERE a.id = target;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account % does not exist in this database.', target;
  END IF;
  IF base <> 'BRL' THEN
    RAISE EXCEPTION 'The account''s user has base currency %, not BRL: this fix does not apply.', base;
  END IF;

  SELECT count(*) INTO unexplained
  FROM ledger_entries l
  WHERE l."accountId" = target
    AND l.currency <> 'BRL'
    AND NOT EXISTS (
      SELECT 1
      FROM ledger_entries other
      WHERE other."transferGroupId" = l."transferGroupId"
        AND other.id <> l.id
        AND other.currency = 'BRL'
        AND other."amountBase" = -l."amountBase"
    );
  IF unexplained > 0 THEN
    RAISE EXCEPTION '% row(s) on the account are not in BRL and are not the leg of a BRL transfer. Decide each one by hand before running this.', unexplained;
  END IF;

  SELECT count(*) INTO foreign_accounts
  FROM accounts sibling
  WHERE sibling."entityId" = (SELECT "entityId" FROM accounts WHERE id = target)
    AND sibling.id <> target
    AND sibling.currency <> 'BRL';
  IF foreign_accounts > 0 THEN
    RAISE EXCEPTION 'The entity has % other account(s) in another currency: its default currency should not be changed blindly.', foreign_accounts;
  END IF;
END $$;

\echo == to reverse this run, keep the statements below (none means nothing will change)
SELECT format(
  'UPDATE ledger_entries SET amount = %s, currency = %L, "exchangeRate" = %s WHERE id = %L;',
  amount, currency, "exchangeRate", id
) AS reverse
FROM ledger_entries
WHERE "accountId" = 'd0255afb-2a52-a1bb-2d3c-fe76d1ddadba' AND currency <> 'BRL'
UNION ALL
SELECT format('UPDATE accounts SET currency = %L WHERE id = %L;', currency, id)
FROM accounts
WHERE id = 'd0255afb-2a52-a1bb-2d3c-fe76d1ddadba' AND currency <> 'BRL'
UNION ALL
SELECT format('UPDATE entities SET "defaultCurrency" = %L WHERE id = %L;', e."defaultCurrency", e.id)
FROM entities e
JOIN accounts a ON a."entityId" = e.id
WHERE a.id = 'd0255afb-2a52-a1bb-2d3c-fe76d1ddadba' AND e."defaultCurrency" <> 'BRL';

UPDATE ledger_entries
SET amount = "amountBase", currency = 'BRL', "exchangeRate" = 1, "updatedAt" = now()
WHERE "accountId" = 'd0255afb-2a52-a1bb-2d3c-fe76d1ddadba' AND currency <> 'BRL';

UPDATE accounts
SET currency = 'BRL', "updatedAt" = now()
WHERE id = 'd0255afb-2a52-a1bb-2d3c-fe76d1ddadba' AND currency <> 'BRL';

UPDATE entities
SET "defaultCurrency" = 'BRL', "updatedAt" = now()
WHERE id = (SELECT "entityId" FROM accounts WHERE id = 'd0255afb-2a52-a1bb-2d3c-fe76d1ddadba')
  AND "defaultCurrency" <> 'BRL';

DO $$
DECLARE
  target constant text := 'd0255afb-2a52-a1bb-2d3c-fe76d1ddadba';
  mismatched integer;
  unbalanced integer;
BEGIN
  SELECT count(*) INTO mismatched
  FROM ledger_entries
  WHERE "accountId" = target AND (currency <> 'BRL' OR "exchangeRate" <> 1 OR amount <> "amountBase");
  IF mismatched > 0 THEN
    RAISE EXCEPTION 'After the fix % row(s) on the account still disagree with BRL at rate 1.', mismatched;
  END IF;

  SELECT count(*) INTO unbalanced
  FROM (
    SELECT g."transferGroupId"
    FROM ledger_entries g
    WHERE g."deletedAt" IS NULL
      AND g."transferGroupId" IN (SELECT "transferGroupId" FROM ledger_entries WHERE "accountId" = target AND "transferGroupId" IS NOT NULL)
    GROUP BY g."transferGroupId"
    HAVING sum(g."amountBase") <> 0
  ) groups;
  IF unbalanced > 0 THEN
    RAISE EXCEPTION 'After the fix % transfer(s) touching the account do not net to zero.', unbalanced;
  END IF;
END $$;

\echo == after
SELECT a.currency AS account_currency, e."defaultCurrency" AS entity_currency
FROM accounts a JOIN entities e ON e.id = a."entityId"
WHERE a.id = 'd0255afb-2a52-a1bb-2d3c-fe76d1ddadba';

SELECT currency, count(*) AS rows, sum(amount) AS amount, sum("amountBase") AS amount_base
FROM ledger_entries
WHERE "accountId" = 'd0255afb-2a52-a1bb-2d3c-fe76d1ddadba'
GROUP BY currency
ORDER BY currency;

COMMIT;
