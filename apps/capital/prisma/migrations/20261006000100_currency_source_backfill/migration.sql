-- 20261006000000_new_ui labelled every existing currency rate 'manual', but
-- the hourly update-rates cron had always overwritten every user's rates
-- (Frankfurter), so none of them was really typed by its user. Now that the
-- cron skips 'manual' rates, keep them updating: label each with the
-- automatic source the cron uses from now on, PTAX on a BRL base and the
-- ECB otherwise (the first refresh relabels the few currencies PTAX does
-- not quote). Rows written by a user since then carry rateUpdatedAt and are
-- left alone.
UPDATE "currencies" AS c
SET "source" = CASE WHEN u."baseCurrency" = 'BRL' THEN 'ptax' ELSE 'ecb' END
FROM "users" AS u
WHERE u."id" = c."userId"
  AND c."source" = 'manual'
  AND c."rateUpdatedAt" IS NULL;
