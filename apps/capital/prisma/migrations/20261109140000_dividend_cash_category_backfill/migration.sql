-- Cash legs of dividend and yield operations were booked with categoryId
-- null, so Fluxo de Caixa filed them as "Sem categoria" even though their
-- flow kind is income. Fill that category once.
--
-- Proventos (fii_income, dividend, jcp, and a dividend with no income type):
-- an income category named Proventos, else system key dividends
-- (seed name Dividendos / Dividends).
-- Rendimentos (fixed_income_interest, legacy interest, and a yield with no
-- income type): an income category named Rendimentos, else system key interest.
--
-- A row that already has a category is left alone, so a second run changes
-- nothing. A buy, sale or transfer is not a candidate. A user with neither
-- the named category nor the system key is skipped (the read side does the
-- same) rather than inventing a category in the wrong language.
-- Deleted legs are included so restoring one does not bring "Sem categoria" back.
--
-- How many rows this touches: the UPDATE count (Prisma migrate prints it,
-- and GET DIAGNOSTICS below is the same number). Before deploy, the same
-- predicate with SELECT count(*) is the preview. October 2026's fifteen
-- "Rendimentos XXXX11" rows are in that set when their category is null;
-- so is every other null dividend/yield cash leg.

DO $$
DECLARE
  touched integer;
BEGIN
  -- The category lookup is a LATERAL of the entry (le2), not of the
  -- operation alone: an UPDATE target cannot be referenced from a LATERAL
  -- joined only to another FROM item.
  UPDATE ledger_entries AS le
  SET "categoryId" = sub.category_id
  FROM (
    SELECT le2.id AS entry_id, picked.id AS category_id
    FROM ledger_entries AS le2
    JOIN investment_operations AS io ON io."cashEntryId" = le2.id
    JOIN LATERAL (
      SELECT c.id
      FROM categories AS c
      WHERE c."userId" = le2."userId"
        AND c.type = 'income'
        AND c."isArchived" = false
        AND (
          CASE
            WHEN io."incomeType" IN ('fixed_income_interest', 'interest')
              OR (io."incomeType" IS NULL AND io.type = 'yield_payment')
            THEN lower(btrim(c.name)) = 'rendimentos' OR c."systemKey" = 'interest'
            ELSE lower(btrim(c.name)) = 'proventos' OR c."systemKey" = 'dividends'
          END
        )
      ORDER BY
        CASE
          WHEN io."incomeType" IN ('fixed_income_interest', 'interest')
            OR (io."incomeType" IS NULL AND io.type = 'yield_payment')
          THEN CASE
            WHEN lower(btrim(c.name)) = 'rendimentos' THEN 0
            WHEN c."systemKey" = 'interest' THEN 1
            ELSE 2
          END
          ELSE CASE
            WHEN lower(btrim(c.name)) = 'proventos' THEN 0
            WHEN c."systemKey" = 'dividends' THEN 1
            ELSE 2
          END
        END,
        c.id
      LIMIT 1
    ) AS picked ON true
    WHERE le2."categoryId" IS NULL
      AND io.type IN ('dividend', 'yield_payment')
  ) AS sub
  WHERE le.id = sub.entry_id;

  GET DIAGNOSTICS touched = ROW_COUNT;
  RAISE NOTICE 'dividend_cash_category_backfill rows=%', touched;
END $$;
