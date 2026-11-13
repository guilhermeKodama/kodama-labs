-- Yahoo Finance is gone. Its quote path (yahoo-finance2's crumb/cookie
-- scrape) failed in production; international listings are priced by
-- Alpha Vantage (source "alpha_vantage") instead.
--
-- Idempotent: a second run finds no source = 'yahoo' rows and does not
-- rewrite an externalId that is already VUAA.LON / CNDX.LON.
--
-- Holdings are not given a new updatedAt. portfolio-history.ts treats that
-- column as the moment a holding was removed, and this backfill must not
-- make every reclassified holding look like it was removed today.

DO $$
BEGIN
  -- An "etf" whose only vendor ref is Yahoo is an international listing
  -- (US or UCITS). A Yahoo ".SA" ref is the old B3 fallback, not an
  -- international listing, so it does not count. Brazilian ETFs that also
  -- have a brapi ref stay "etf".
  UPDATE assets a
  SET "assetClass" = 'international_etf',
      market = 'US',
      "updatedAt" = CURRENT_TIMESTAMP
  WHERE a."assetClass" = 'etf'
    AND EXISTS (
      SELECT 1 FROM asset_source_refs r
      WHERE r."assetId" = a.id AND r.source = 'yahoo' AND r."externalId" !~* '\.SA$'
    )
    AND NOT EXISTS (
      SELECT 1 FROM asset_source_refs r
      WHERE r."assetId" = a.id AND r.source <> 'yahoo'
    );

  UPDATE investment_holdings h
  SET "assetClass" = 'international_etf'
  FROM assets a
  WHERE h."assetId" = a.id
    AND h."assetClass" = 'etf'
    AND a."assetClass" = 'international_etf'
    AND EXISTS (
      SELECT 1 FROM asset_source_refs r
      WHERE r."assetId" = a.id AND r.source = 'yahoo' AND r."externalId" !~* '\.SA$'
    )
    AND NOT EXISTS (
      SELECT 1 FROM asset_source_refs r
      WHERE r."assetId" = a.id AND r.source <> 'yahoo'
    );

  -- Fold a Yahoo ref into an Alpha Vantage ref that already exists, except
  -- the B3 ".SA" fallback, which is not an Alpha Vantage symbol.
  UPDATE asset_source_refs av
  SET "externalId" = CASE
        WHEN upper(y."externalId") IN ('VUAA', 'VUAA.L', 'VUAA.LON') THEN 'VUAA.LON'
        WHEN upper(y."externalId") IN ('CNDX', 'CNDX.L', 'CNDX.LON') THEN 'CNDX.LON'
        WHEN upper(y."externalId") ~ '\.L$' THEN regexp_replace(upper(y."externalId"), '\.L$', '.LON')
        ELSE upper(y."externalId")
      END,
      "updatedAt" = CURRENT_TIMESTAMP
  FROM asset_source_refs y
  WHERE av.source = 'alpha_vantage'
    AND y.source = 'yahoo'
    AND av."assetId" = y."assetId"
    AND y."externalId" !~* '\.SA$';

  DELETE FROM asset_source_refs
  WHERE source = 'yahoo' AND "externalId" ~* '\.SA$';

  DELETE FROM asset_source_refs y
  USING asset_source_refs av
  WHERE y.source = 'yahoo'
    AND av.source = 'alpha_vantage'
    AND av."assetId" = y."assetId";

  UPDATE asset_source_refs
  SET source = 'alpha_vantage',
      "externalId" = CASE
        WHEN upper("externalId") IN ('VUAA', 'VUAA.L', 'VUAA.LON') THEN 'VUAA.LON'
        WHEN upper("externalId") IN ('CNDX', 'CNDX.L', 'CNDX.LON') THEN 'CNDX.LON'
        WHEN upper("externalId") ~ '\.L$' THEN regexp_replace(upper("externalId"), '\.L$', '.LON')
        ELSE upper("externalId")
      END,
      "updatedAt" = CURRENT_TIMESTAMP
  WHERE source = 'yahoo';

  UPDATE asset_source_refs
  SET "externalId" = CASE
        WHEN upper("externalId") IN ('VUAA', 'VUAA.L') THEN 'VUAA.LON'
        WHEN upper("externalId") IN ('CNDX', 'CNDX.L') THEN 'CNDX.LON'
        ELSE "externalId"
      END,
      "updatedAt" = CURRENT_TIMESTAMP
  WHERE source = 'alpha_vantage'
    AND upper("externalId") IN ('VUAA', 'VUAA.L', 'CNDX', 'CNDX.L');

  UPDATE asset_prices
  SET source = 'alpha_vantage'
  WHERE source = 'yahoo';
END $$;
