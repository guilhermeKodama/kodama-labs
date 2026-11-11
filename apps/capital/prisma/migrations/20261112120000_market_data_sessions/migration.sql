-- Asset.market: the trading calendar an asset's price freshness is measured
-- against. Derived from the class, and for a plain "etf" from the ticker's
-- shape (B3 tickers end in a digit), the same rule as market-data/lib/calendar.ts.
ALTER TABLE "assets" ADD COLUMN "market" TEXT;

UPDATE "assets" SET "market" = CASE
  WHEN "assetClass" = 'crypto' THEN 'CRYPTO'
  WHEN "assetClass" IN ('international_stocks', 'international_etf') THEN 'US'
  WHEN "assetClass" = 'etf' AND "symbol" !~ '[0-9]$' THEN 'US'
  ELSE 'B3'
END;

-- The unique key moves from (symbol, assetClass, currency) to (market,
-- symbol, currency): one instrument held under two classes (BOVA11 as "etf"
-- and as "stocks") becomes one Asset. Keep the oldest, point every holding at
-- it; the duplicate's refs and prices go with it (ON DELETE CASCADE).
CREATE TEMP TABLE "_asset_keepers" AS
SELECT "id", first_value("id") OVER (PARTITION BY "market", "symbol", "currency" ORDER BY "createdAt", "id") AS "keeper"
FROM "assets";

UPDATE "investment_holdings" h
SET "assetId" = k."keeper"
FROM "_asset_keepers" k
WHERE h."assetId" = k."id" AND k."id" <> k."keeper";

DELETE FROM "assets" a
USING "_asset_keepers" k
WHERE a."id" = k."id" AND k."id" <> k."keeper";

DROP TABLE "_asset_keepers";

ALTER TABLE "assets" ALTER COLUMN "market" SET NOT NULL;

DROP INDEX "assets_symbol_assetClass_currency_key";
CREATE UNIQUE INDEX "assets_market_symbol_currency_key" ON "assets"("market", "symbol", "currency");

-- AssetPrice.kind / asOf: a live quote taken before the close is "intraday"
-- (the close overwrites it); asOf is the provider's own quote time.
ALTER TABLE "asset_prices" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'close',
ADD COLUMN "asOf" TIMESTAMP(3);
