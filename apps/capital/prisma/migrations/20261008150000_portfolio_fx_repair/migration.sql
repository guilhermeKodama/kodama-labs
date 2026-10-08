-- Repair Avenue and Crypto rate-1 transfer legs, those two opening balances,
-- the detached BTC buy cash leg, and legacy adjustment replay.
--
-- Does not rewrite other USD investment cash legs (the 4.9687 snapshot),
-- the 2026-09-30 BTC sell, a deleted 2026-10-02 adjustment, or caixinha rows.
-- No network: PTAX closes are embedded below.
--
-- PTAX USD Fechamento (cotacaoVenda), BCB Olinda CotacaoMoedaPeriodo, fetched 2026-10-08.
-- Source: https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoMoedaPeriodo(moeda=@moeda,dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)?@moeda='USD'&@dataInicial='01-02-2026'&@dataFinalCotacao='10-08-2026'&$format=json&$select=cotacaoVenda,dataHoraCotacao,tipoBoletim
-- A flow on calendar day D uses the latest close strictly before D.
--   2026-08-12 -> 2026-08-11 = 5.1285
--   2026-09-16 -> 2026-09-15 = 5.1490
--   2026-08-20 -> 2026-08-19 = 5.1714
--   2026-09-01 -> 2026-08-31 = 5.1816
-- The Crypto deposit date is read from the row; its previous close comes from this series.

CREATE TABLE IF NOT EXISTS portfolio_fx_repair_entry (
    id TEXT PRIMARY KEY,
    amount DECIMAL(18, 4) NOT NULL,
    currency TEXT NOT NULL,
    "exchangeRate" DECIMAL(18, 8) NOT NULL,
    "amountBase" DECIMAL(18, 4) NOT NULL,
    "deletedAt" TIMESTAMP(3)
);

CREATE TABLE IF NOT EXISTS portfolio_fx_repair_account (
    id TEXT PRIMARY KEY,
    "initialBalance" DECIMAL(18, 4) NOT NULL
);

CREATE TABLE IF NOT EXISTS portfolio_fx_repair_operation (
    id TEXT PRIMARY KEY,
    "adjustmentMode" TEXT
);

CREATE TABLE IF NOT EXISTS portfolio_fx_repair_holding (
    id TEXT PRIMARY KEY,
    "currentQuantity" DOUBLE PRECISION NOT NULL,
    "averageCost" DOUBLE PRECISION NOT NULL,
    "totalInvested" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS portfolio_fx_repair_frozen (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    snapshot JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS portfolio_fx_repair_run (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fxLegs" INTEGER NOT NULL,
    "btcDetached" INTEGER NOT NULL,
    modes INTEGER NOT NULL,
    holdings INTEGER NOT NULL
);

-- Mirrors replayPosition / nextIsActive. Dropped at the end of this migration.
CREATE OR REPLACE FUNCTION pg_temp.portfolio_fx_replay(holding_id TEXT, stored_active BOOLEAN, stored_qty DOUBLE PRECISION, stored_cost DOUBLE PRECISION)
RETURNS TABLE (quantity DOUBLE PRECISION, cost DOUBLE PRECISION, average_cost DOUBLE PRECISION, is_active BOOLEAN)
LANGUAGE plpgsql AS $fn$
DECLARE
    op RECORD;
    qty DOUBLE PRECISION := 0;
    cost_basis DOUBLE PRECISION := 0;
    realized DOUBLE PRECISION := 0;
    closed BOOLEAN := false;
    q DOUBLE PRECISION;
    p DOUBLE PRECISION;
    fees DOUBLE PRECISION;
    gross DOUBLE PRECISION;
    sold DOUBLE PRECISION;
    sold_cost DOUBLE PRECISION;
    proceeds DOUBLE PRECISION;
    taken DOUBLE PRECISION;
    next_qty DOUBLE PRECISION;
    had BOOLEAN;
    has_pos BOOLEAN;
BEGIN
    FOR op IN
        SELECT * FROM investment_operations
        WHERE "holdingId" = holding_id
        ORDER BY date ASC, "createdAt" ASC
    LOOP
        q := coalesce(op.quantity, 0);
        p := coalesce(op."pricePerUnit", 0);
        fees := coalesce(op.fees, 0);
        IF op.type IN ('buy', 'deposit') THEN
            gross := CASE WHEN op."totalAmount" > 0 THEN op."totalAmount" ELSE q * p END;
            qty := qty + q;
            cost_basis := cost_basis + gross + fees;
            closed := false;
        ELSIF op.type IN ('sell', 'withdrawal') THEN
            IF q > 0 THEN
                sold := q;
                IF sold > qty + 1e-9 THEN
                    sold := greatest(0, qty);
                END IF;
                sold_cost := CASE WHEN qty > 1e-9 THEN cost_basis * (sold / qty) ELSE 0 END;
                proceeds := (CASE WHEN op."totalAmount" > 0 THEN op."totalAmount" ELSE q * p END) * (CASE WHEN q <> 0 THEN sold / q ELSE 0 END);
                realized := realized + proceeds - fees - sold_cost;
                qty := qty - sold;
                cost_basis := cost_basis - sold_cost;
                IF qty <= 1e-9 THEN
                    qty := 0;
                    cost_basis := 0;
                END IF;
            ELSE
                taken := least(cost_basis, op."totalAmount");
                realized := realized + op."totalAmount" - fees - taken;
                cost_basis := cost_basis - taken;
            END IF;
            IF qty <= 1e-9 AND cost_basis <= 1e-9 THEN
                closed := true;
            END IF;
        ELSIF op.type = 'split' THEN
            qty := qty + q;
        ELSIF op.type = 'adjustment' THEN
            IF op."adjustmentMode" = 'delta' AND op.quantity IS NOT NULL THEN
                next_qty := greatest(0, qty + q);
                cost_basis := CASE WHEN qty > 1e-9 THEN cost_basis * (next_qty / qty) ELSE 0 END;
                qty := next_qty;
                closed := qty <= 1e-9 AND cost_basis <= 1e-9;
            ELSIF op.quantity IS NOT NULL AND op."pricePerUnit" IS NOT NULL THEN
                qty := greatest(0, q);
                cost_basis := qty * p;
                closed := qty <= 1e-9;
            ELSE
                cost_basis := greatest(0, cost_basis + op."totalAmount");
                closed := false;
            END IF;
        END IF;
    END LOOP;
    qty := greatest(0, qty);
    cost_basis := greatest(0, cost_basis);
    IF closed THEN
        is_active := false;
    ELSE
        had := stored_qty > 1e-9 OR stored_cost > 1e-9;
        has_pos := qty > 1e-9 OR cost_basis > 1e-9;
        IF had AND NOT has_pos THEN
            is_active := false;
        ELSIF (NOT stored_active) AND (NOT had) AND has_pos THEN
            is_active := true;
        ELSE
            is_active := stored_active;
        END IF;
    END IF;
    quantity := qty;
    cost := cost_basis;
    average_cost := CASE WHEN qty > 1e-9 THEN cost_basis / qty ELSE 0 END;
    RETURN NEXT;
END
$fn$;

DO $repair$
DECLARE
    rec RECORD;
    replay RECORD;
    legacy_ending NUMERIC;
    corrected_sum NUMERIC;
    entry_min NUMERIC;
    min_prefix NUMERIC;
    base_initial NUMERIC;
    new_initial NUMERIC;
    deficit NUMERIC;
    projected_cash NUMERIC;
    fx_count INTEGER := 0;
    detach_count INTEGER := 0;
    mode_count INTEGER := 0;
    holding_count INTEGER := 0;
    legacy_ok BOOLEAN;
BEGIN
    PERFORM set_config('TimeZone', 'UTC', true);

    CREATE TEMP TABLE _ptax (day DATE PRIMARY KEY, brl NUMERIC) ON COMMIT DROP;
    INSERT INTO _ptax (day, brl) VALUES
    (DATE '2026-01-02', 5.4372),
    (DATE '2026-01-05', 5.4351),
    (DATE '2026-01-06', 5.3797),
    (DATE '2026-01-07', 5.388),
    (DATE '2026-01-08', 5.386),
    (DATE '2026-01-09', 5.3707),
    (DATE '2026-01-12', 5.376),
    (DATE '2026-01-13', 5.3764),
    (DATE '2026-01-14', 5.3795),
    (DATE '2026-01-15', 5.3846),
    (DATE '2026-01-16', 5.3798),
    (DATE '2026-01-19', 5.3653),
    (DATE '2026-01-20', 5.379),
    (DATE '2026-01-21', 5.3368),
    (DATE '2026-01-22', 5.3118),
    (DATE '2026-01-23', 5.2879),
    (DATE '2026-01-26', 5.276),
    (DATE '2026-01-27', 5.2392),
    (DATE '2026-01-28', 5.1838),
    (DATE '2026-01-29', 5.1956),
    (DATE '2026-01-30', 5.2301),
    (DATE '2026-02-02', 5.2587),
    (DATE '2026-02-03', 5.2236),
    (DATE '2026-02-04', 5.2359),
    (DATE '2026-02-05', 5.258),
    (DATE '2026-02-06', 5.2341),
    (DATE '2026-02-09', 5.1943),
    (DATE '2026-02-10', 5.2021),
    (DATE '2026-02-11', 5.1836),
    (DATE '2026-02-12', 5.1674),
    (DATE '2026-02-13', 5.2288),
    (DATE '2026-02-18', 5.2349),
    (DATE '2026-02-19', 5.2257),
    (DATE '2026-02-20', 5.2006),
    (DATE '2026-02-23', 5.1635),
    (DATE '2026-02-24', 5.1682),
    (DATE '2026-02-25', 5.144),
    (DATE '2026-02-26', 5.1382),
    (DATE '2026-02-27', 5.1495),
    (DATE '2026-03-02', 5.2001),
    (DATE '2026-03-03', 5.287),
    (DATE '2026-03-04', 5.2091),
    (DATE '2026-03-05', 5.2447),
    (DATE '2026-03-06', 5.2878),
    (DATE '2026-03-09', 5.2139),
    (DATE '2026-03-10', 5.1622),
    (DATE '2026-03-11', 5.1596),
    (DATE '2026-03-12', 5.2051),
    (DATE '2026-03-13', 5.2541),
    (DATE '2026-03-16', 5.2647),
    (DATE '2026-03-17', 5.2022),
    (DATE '2026-03-18', 5.2112),
    (DATE '2026-03-19', 5.2587),
    (DATE '2026-03-20', 5.28),
    (DATE '2026-03-23', 5.244),
    (DATE '2026-03-24', 5.2599),
    (DATE '2026-03-25', 5.2275),
    (DATE '2026-03-26', 5.2308),
    (DATE '2026-03-27', 5.2376),
    (DATE '2026-03-30', 5.2353),
    (DATE '2026-03-31', 5.2194),
    (DATE '2026-04-01', 5.1606),
    (DATE '2026-04-02', 5.1655),
    (DATE '2026-04-06', 5.1532),
    (DATE '2026-04-07', 5.1625),
    (DATE '2026-04-08', 5.0899),
    (DATE '2026-04-09', 5.0821),
    (DATE '2026-04-10', 5.0229),
    (DATE '2026-04-13', 5.0244),
    (DATE '2026-04-14', 4.9806),
    (DATE '2026-04-15', 4.9928),
    (DATE '2026-04-16', 5.0007),
    (DATE '2026-04-17', 4.9695),
    (DATE '2026-04-20', 4.9844),
    (DATE '2026-04-22', 4.9653),
    (DATE '2026-04-23', 4.9539),
    (DATE '2026-04-24', 5.0083),
    (DATE '2026-04-27', 4.97),
    (DATE '2026-04-28', 4.9878),
    (DATE '2026-04-29', 4.9985),
    (DATE '2026-04-30', 4.9886),
    (DATE '2026-05-04', 4.9587),
    (DATE '2026-05-05', 4.9242),
    (DATE '2026-05-06', 4.9274),
    (DATE '2026-05-07', 4.917),
    (DATE '2026-05-08', 4.8999),
    (DATE '2026-05-11', 4.8973),
    (DATE '2026-05-12', 4.8977),
    (DATE '2026-05-13', 4.9118),
    (DATE '2026-05-14', 4.9809),
    (DATE '2026-05-15', 5.0654),
    (DATE '2026-05-18', 5.0093),
    (DATE '2026-05-19', 5.0378),
    (DATE '2026-05-20', 5.0301),
    (DATE '2026-05-21', 5.0077),
    (DATE '2026-05-22', 5.014),
    (DATE '2026-05-25', 5.0072),
    (DATE '2026-05-26', 5.0211),
    (DATE '2026-05-27', 5.0579),
    (DATE '2026-05-28', 5.0517),
    (DATE '2026-05-29', 5.0569),
    (DATE '2026-06-01', 5.0303),
    (DATE '2026-06-02', 5.016),
    (DATE '2026-06-03', 5.0415),
    (DATE '2026-06-05', 5.1244),
    (DATE '2026-06-08', 5.1695),
    (DATE '2026-06-09', 5.1693),
    (DATE '2026-06-10', 5.1763),
    (DATE '2026-06-11', 5.1478),
    (DATE '2026-06-12', 5.0827),
    (DATE '2026-06-15', 5.043),
    (DATE '2026-06-16', 5.078),
    (DATE '2026-06-17', 5.0641),
    (DATE '2026-06-18', 5.1613),
    (DATE '2026-06-19', 5.1442),
    (DATE '2026-06-22', 5.1395),
    (DATE '2026-06-23', 5.1743),
    (DATE '2026-06-24', 5.2098),
    (DATE '2026-06-25', 5.1892),
    (DATE '2026-06-26', 5.1695),
    (DATE '2026-06-29', 5.1717),
    (DATE '2026-06-30', 5.1766),
    (DATE '2026-07-01', 5.195),
    (DATE '2026-07-02', 5.1945),
    (DATE '2026-07-03', 5.1717),
    (DATE '2026-07-06', 5.167),
    (DATE '2026-07-07', 5.1458),
    (DATE '2026-07-08', 5.1552),
    (DATE '2026-07-09', 5.1329),
    (DATE '2026-07-10', 5.1088),
    (DATE '2026-07-13', 5.1183),
    (DATE '2026-07-14', 5.0742),
    (DATE '2026-07-15', 5.0727),
    (DATE '2026-07-16', 5.0975),
    (DATE '2026-07-17', 5.1176),
    (DATE '2026-07-20', 5.0894),
    (DATE '2026-07-21', 5.078),
    (DATE '2026-07-22', 5.0638),
    (DATE '2026-07-23', 5.0807),
    (DATE '2026-07-24', 5.0666),
    (DATE '2026-07-27', 5.1005),
    (DATE '2026-07-28', 5.1177),
    (DATE '2026-07-29', 5.1217),
    (DATE '2026-07-30', 5.0739),
    (DATE '2026-07-31', 5.0773),
    (DATE '2026-08-03', 5.0723),
    (DATE '2026-08-04', 5.1053),
    (DATE '2026-08-05', 5.1154),
    (DATE '2026-08-06', 5.1017),
    (DATE '2026-08-07', 5.0908),
    (DATE '2026-08-10', 5.0963),
    (DATE '2026-08-11', 5.1285),
    (DATE '2026-08-12', 5.1639),
    (DATE '2026-08-13', 5.1859),
    (DATE '2026-08-14', 5.2236),
    (DATE '2026-08-17', 5.2014),
    (DATE '2026-08-18', 5.2043),
    (DATE '2026-08-19', 5.1714),
    (DATE '2026-08-20', 5.1862),
    (DATE '2026-08-21', 5.1625),
    (DATE '2026-08-24', 5.1512),
    (DATE '2026-08-25', 5.149),
    (DATE '2026-08-26', 5.1604),
    (DATE '2026-08-27', 5.1642),
    (DATE '2026-08-28', 5.2005),
    (DATE '2026-08-31', 5.1816),
    (DATE '2026-09-01', 5.157),
    (DATE '2026-09-02', 5.1273),
    (DATE '2026-09-03', 5.0962),
    (DATE '2026-09-04', 5.1253),
    (DATE '2026-09-08', 5.0856),
    (DATE '2026-09-09', 5.0979),
    (DATE '2026-09-10', 5.1149),
    (DATE '2026-09-11', 5.0918),
    (DATE '2026-09-14', 5.1696),
    (DATE '2026-09-15', 5.149),
    (DATE '2026-09-16', 5.1527),
    (DATE '2026-09-17', 5.1521),
    (DATE '2026-09-18', 5.1575),
    (DATE '2026-09-21', 5.1117),
    (DATE '2026-09-22', 5.1161),
    (DATE '2026-09-23', 5.1414),
    (DATE '2026-09-24', 5.1795),
    (DATE '2026-09-25', 5.1991),
    (DATE '2026-09-28', 5.2132),
    (DATE '2026-09-29', 5.2204),
    (DATE '2026-09-30', 5.1809),
    (DATE '2026-10-01', 5.2079),
    (DATE '2026-10-02', 5.2238),
    (DATE '2026-10-05', 4.9859),
    (DATE '2026-10-06', 4.9698),
    (DATE '2026-10-07', 4.9935);

    CREATE TEMP TABLE _fx ON COMMIT DROP AS
    SELECT b.id AS entry_id,
           b."accountId" AS account_id,
           b.amount AS broker_amount,
           b.date AS entry_date,
           o.amount AS other_amount,
           a.currency AS account_currency
    FROM ledger_entries b
    JOIN accounts a ON a.id = b."accountId" AND a.type = 'brokerage' AND a."archivedAt" IS NULL
    JOIN ledger_entries o ON o."transferGroupId" = b."transferGroupId" AND o.id <> b.id AND o."deletedAt" IS NULL
    JOIN accounts oa ON oa.id = o."accountId"
    WHERE b."deletedAt" IS NULL
      AND b."transferGroupId" IS NOT NULL
      AND b."exchangeRate" = 1
      AND o."exchangeRate" = 1
      AND abs(abs(b.amount) - abs(o.amount)) < 0.01
      AND a.currency <> oa.currency
      AND b.currency IS DISTINCT FROM a.currency
      AND abs(b.amount + o.amount) < 0.01
      AND (SELECT count(*) FROM ledger_entries x WHERE x."transferGroupId" = b."transferGroupId" AND x."deletedAt" IS NULL) = 2;

    IF EXISTS (SELECT entry_id FROM _fx GROUP BY entry_id HAVING count(*) <> 1) THEN
        RAISE EXCEPTION 'portfolio fx repair: a broker leg matches more than one counterpart';
    END IF;

    ALTER TABLE _fx ADD COLUMN signature TEXT;
    UPDATE _fx SET signature = CASE
        WHEN (entry_date AT TIME ZONE 'UTC')::date = DATE '2026-08-12' AND abs(broker_amount - (-168800.12)) < 0.01 THEN 'avenue_out'
        WHEN (entry_date AT TIME ZONE 'UTC')::date = DATE '2026-09-16' AND abs(broker_amount - 2575) < 0.01 THEN 'avenue_in'
        WHEN abs(broker_amount - 10000) < 0.01 AND (
            SELECT count(*) FROM investment_operations op
            JOIN investment_holdings h ON h.id = op."holdingId"
            WHERE h."accountId" = _fx.account_id
              AND h.ticker = 'BTC'
              AND op.type = 'buy'
              AND abs(op.quantity - 0.3667) < 0.000001
              AND abs(op."pricePerUnit" - 60000) < 0.01
              AND abs(op."totalAmount" - 22002) < 0.01
        ) = 1 THEN 'crypto_deposit'
        ELSE 'unexpected'
    END;

    IF EXISTS (SELECT 1 FROM _fx WHERE signature = 'unexpected') THEN
        RAISE EXCEPTION 'portfolio fx repair: unexpected rate-1 cross-currency broker leg(s): %',
            (SELECT string_agg(entry_id || ' ' || account_id || ' ' || broker_amount::text, ', ') FROM _fx WHERE signature = 'unexpected');
    END IF;
    IF (SELECT count(*) FROM _fx WHERE signature = 'avenue_out') > 1 THEN
        RAISE EXCEPTION 'portfolio fx repair: more than one Avenue 2026-08-12 leg';
    END IF;
    IF (SELECT count(*) FROM _fx WHERE signature = 'avenue_in') > 1 THEN
        RAISE EXCEPTION 'portfolio fx repair: more than one Avenue 2026-09-16 leg';
    END IF;
    IF (SELECT count(DISTINCT account_id) FROM _fx WHERE signature IN ('avenue_out', 'avenue_in')) > 1 THEN
        RAISE EXCEPTION 'portfolio fx repair: Avenue legs are on different accounts';
    END IF;
    IF EXISTS (
        SELECT 1 FROM _fx c
        JOIN _fx a ON a.account_id = c.account_id AND a.signature IN ('avenue_out', 'avenue_in')
        WHERE c.signature = 'crypto_deposit'
    ) THEN
        RAISE EXCEPTION 'portfolio fx repair: Crypto deposit is on the Avenue account';
    END IF;
    IF EXISTS (SELECT account_id FROM _fx WHERE signature = 'crypto_deposit' GROUP BY account_id HAVING count(*) > 1) THEN
        RAISE EXCEPTION 'portfolio fx repair: more than one Crypto deposit on an account';
    END IF;

    CREATE TEMP TABLE _btc ON COMMIT DROP AS
    SELECT op.id AS op_id, op."cashEntryId" AS cash_id, h."accountId" AS account_id
    FROM investment_operations op
    JOIN investment_holdings h ON h.id = op."holdingId"
    JOIN accounts a ON a.id = h."accountId" AND a.type = 'brokerage' AND a."archivedAt" IS NULL
    WHERE h.ticker = 'BTC'
      AND op.type = 'buy'
      AND abs(op.quantity - 0.3667) < 0.000001
      AND abs(op."pricePerUnit" - 60000) < 0.01
      AND abs(op."totalAmount" - 22002) < 0.01;

    IF EXISTS (SELECT account_id FROM _btc GROUP BY account_id HAVING count(*) > 1) THEN
        RAISE EXCEPTION 'portfolio fx repair: more than one opening BTC buy on an account';
    END IF;
    IF EXISTS (
        SELECT 1 FROM _btc b
        JOIN _fx f ON f.account_id = b.account_id AND f.signature IN ('avenue_out', 'avenue_in')
    ) THEN
        RAISE EXCEPTION 'portfolio fx repair: opening BTC buy is on the Avenue account';
    END IF;

    ALTER TABLE _fx ADD COLUMN rate NUMERIC;
    UPDATE _fx f SET rate = (
        SELECT p.brl FROM _ptax p
        WHERE p.day < (f.entry_date AT TIME ZONE 'UTC')::date
        ORDER BY p.day DESC
        LIMIT 1
    );
    IF EXISTS (SELECT 1 FROM _fx WHERE rate IS NULL) THEN
        RAISE EXCEPTION 'portfolio fx repair: no embedded PTAX close before a leg date';
    END IF;
    IF EXISTS (SELECT 1 FROM _fx WHERE signature = 'avenue_out' AND rate <> 5.1285) THEN
        RAISE EXCEPTION 'portfolio fx repair: 2026-08-12 previous close is %, expected 5.1285 (2026-08-11)',
            (SELECT rate FROM _fx WHERE signature = 'avenue_out' LIMIT 1);
    END IF;
    IF EXISTS (SELECT 1 FROM _fx WHERE signature = 'avenue_in' AND rate <> 5.1490) THEN
        RAISE EXCEPTION 'portfolio fx repair: 2026-09-16 previous close is %, expected 5.1490 (2026-09-15)',
            (SELECT rate FROM _fx WHERE signature = 'avenue_in' LIMIT 1);
    END IF;

    CREATE TEMP TABLE _touch (account_id TEXT PRIMARY KEY, rule TEXT NOT NULL) ON COMMIT DROP;
    INSERT INTO _touch (account_id, rule)
    SELECT DISTINCT account_id, 'avenue' FROM _fx WHERE signature IN ('avenue_out', 'avenue_in');
    INSERT INTO _touch (account_id, rule)
    SELECT DISTINCT account_id, 'crypto' FROM _fx WHERE signature = 'crypto_deposit'
    ON CONFLICT (account_id) DO NOTHING;
    INSERT INTO _touch (account_id, rule)
    SELECT b.account_id, 'crypto'
    FROM _btc b
    JOIN ledger_entries e ON e.id = b.cash_id AND e."deletedAt" IS NULL
    ON CONFLICT (account_id) DO NOTHING;

    CREATE TEMP TABLE _legacy (account_id TEXT PRIMARY KEY, ending NUMERIC NOT NULL) ON COMMIT DROP;
    INSERT INTO _legacy (account_id, ending)
    SELECT a.id, a."initialBalance" + coalesce((
        SELECT sum(e.amount) FROM ledger_entries e WHERE e."accountId" = a.id AND e."deletedAt" IS NULL
    ), 0)
    FROM accounts a
    JOIN _touch t ON t.account_id = a.id;

    INSERT INTO portfolio_fx_repair_entry (id, amount, currency, "exchangeRate", "amountBase", "deletedAt")
    SELECT e.id, e.amount, e.currency, e."exchangeRate", e."amountBase", e."deletedAt"
    FROM ledger_entries e
    WHERE e.id IN (
        SELECT entry_id FROM _fx
        UNION
        SELECT cash_id FROM _btc WHERE cash_id IS NOT NULL
    )
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO portfolio_fx_repair_account (id, "initialBalance")
    SELECT a.id, a."initialBalance"
    FROM accounts a
    JOIN _touch t ON t.account_id = a.id
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO portfolio_fx_repair_frozen (id, kind, snapshot)
    SELECT op.id, 'operation', to_jsonb(op)
    FROM investment_operations op
    JOIN investment_holdings h ON h.id = op."holdingId"
    WHERE h.ticker = 'BTC'
      AND (
        (op.type = 'buy' AND abs(op.quantity - 0.3667) < 0.000001 AND abs(op."pricePerUnit" - 60000) < 0.01 AND abs(op."totalAmount" - 22002) < 0.01)
        OR (op.type = 'sell' AND (op.date AT TIME ZONE 'UTC')::date = DATE '2026-09-30' AND abs(op.quantity - 0.0782) < 0.000001)
      )
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO portfolio_fx_repair_frozen (id, kind, snapshot)
    SELECT op.id, 'adjustment', to_jsonb(op)
    FROM investment_operations op
    JOIN investment_holdings h ON h.id = op."holdingId"
    WHERE h.ticker = 'BTC'
      AND op.type = 'adjustment'
      AND (op.date AT TIME ZONE 'UTC')::date = DATE '2026-10-02'
    ON CONFLICT (id) DO NOTHING;

    UPDATE ledger_entries e
    SET currency = f.account_currency,
        amount = round((-f.other_amount) / f.rate, 4),
        "exchangeRate" = round(f.rate, 8),
        "amountBase" = round(-f.other_amount, 4),
        "updatedAt" = CURRENT_TIMESTAMP
    FROM _fx f
    WHERE e.id = f.entry_id;
    GET DIAGNOSTICS fx_count = ROW_COUNT;

    UPDATE ledger_entries e
    SET "deletedAt" = CURRENT_TIMESTAMP,
        "updatedAt" = CURRENT_TIMESTAMP
    FROM _btc b
    WHERE e.id = b.cash_id AND e."deletedAt" IS NULL;
    GET DIAGNOSTICS detach_count = ROW_COUNT;

    FOR rec IN SELECT * FROM _touch LOOP
        SELECT l.ending INTO legacy_ending FROM _legacy l WHERE l.account_id = rec.account_id;
        SELECT coalesce(sum(amount), 0) INTO corrected_sum
        FROM ledger_entries WHERE "accountId" = rec.account_id AND "deletedAt" IS NULL;
        SELECT min(prefix) INTO entry_min FROM (
            SELECT sum(amount) OVER (ORDER BY date, "createdAt", id) AS prefix
            FROM ledger_entries
            WHERE "accountId" = rec.account_id AND "deletedAt" IS NULL
        ) s;
        min_prefix := least(0, coalesce(entry_min, 0));
        IF rec.rule = 'crypto' THEN
            new_initial := greatest(0, -min_prefix);
            projected_cash := new_initial + corrected_sum;
            IF EXISTS (
                SELECT 1 FROM investment_operations op
                JOIN investment_holdings h ON h.id = op."holdingId"
                JOIN ledger_entries e ON e.id = op."cashEntryId" AND e."deletedAt" IS NULL
                WHERE h."accountId" = rec.account_id
                  AND op.type = 'sell'
                  AND (op.date AT TIME ZONE 'UTC')::date = DATE '2026-09-30'
                  AND abs(op.quantity - 0.0782) < 0.000001
                  AND e.amount >= 6757.74
            ) AND projected_cash < 6757.745 THEN
                new_initial := new_initial + (6757.75 - projected_cash);
            END IF;
        ELSE
            base_initial := legacy_ending - corrected_sum;
            deficit := -(base_initial + min_prefix);
            IF deficit > 0.0001 THEN
                new_initial := base_initial + deficit;
            ELSE
                new_initial := base_initial;
            END IF;
        END IF;
        new_initial := round(new_initial, 4);
        UPDATE accounts
        SET "initialBalance" = new_initial, "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = rec.account_id AND abs("initialBalance" - new_initial) >= 0.00005;
    END LOOP;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'legacy' AND table_name = 'investment_transactions'
    ) INTO legacy_ok;

    CREATE TEMP TABLE _delta (id TEXT PRIMARY KEY, holding_id TEXT NOT NULL) ON COMMIT DROP;
    IF legacy_ok THEN
        INSERT INTO _delta (id, holding_id)
        SELECT o.id, o."holdingId"
        FROM investment_operations o
        WHERE o.type = 'adjustment'
          AND o."adjustmentMode" IS DISTINCT FROM 'delta'
          AND o.quantity IS NOT NULL
          AND o."pricePerUnit" IS NOT NULL
          AND EXISTS (SELECT 1 FROM legacy.investment_transactions t WHERE t.id = o.id);
    END IF;
    INSERT INTO _delta (id, holding_id)
    SELECT o.id, o."holdingId"
    FROM investment_operations o
    WHERE o.type = 'adjustment'
      AND o."adjustmentMode" IS DISTINCT FROM 'delta'
      AND o.quantity IS NOT NULL
      AND o.quantity < 0
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO portfolio_fx_repair_operation (id, "adjustmentMode")
    SELECT o.id, o."adjustmentMode"::text
    FROM investment_operations o
    JOIN _delta d ON d.id = o.id
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO portfolio_fx_repair_holding (id, "currentQuantity", "averageCost", "totalInvested", "isActive", "updatedAt")
    SELECT h.id, h."currentQuantity", h."averageCost", h."totalInvested", h."isActive", h."updatedAt"
    FROM investment_holdings h
    WHERE h.id IN (SELECT holding_id FROM _delta)
    ON CONFLICT (id) DO NOTHING;

    UPDATE investment_operations o
    SET "adjustmentMode" = 'delta', "updatedAt" = CURRENT_TIMESTAMP
    FROM _delta d
    WHERE o.id = d.id AND o."adjustmentMode" IS DISTINCT FROM 'delta';
    GET DIAGNOSTICS mode_count = ROW_COUNT;

    FOR rec IN
        SELECT h.id, h."isActive", h."currentQuantity", h."totalInvested", h."averageCost"
        FROM investment_holdings h
        WHERE h.id IN (SELECT DISTINCT "holdingId" FROM investment_operations WHERE "adjustmentMode" = 'delta')
    LOOP
        SELECT * INTO replay FROM pg_temp.portfolio_fx_replay(rec.id, rec."isActive", rec."currentQuantity", rec."totalInvested");
        IF rec."isActive" IS DISTINCT FROM replay.is_active
           OR abs(rec."currentQuantity" - replay.quantity) > 1e-6
           OR abs(rec."totalInvested" - replay.cost) > 0.005
           OR abs(rec."averageCost" - replay.average_cost) > 1e-6
        THEN
            UPDATE investment_holdings
            SET "currentQuantity" = replay.quantity,
                "averageCost" = replay.average_cost,
                "totalInvested" = replay.cost,
                "isActive" = replay.is_active,
                "updatedAt" = CURRENT_TIMESTAMP
            WHERE id = rec.id;
            holding_count := holding_count + 1;
        END IF;
    END LOOP;

    IF EXISTS (
        SELECT 1
        FROM portfolio_fx_repair_frozen f
        JOIN investment_operations op ON op.id = f.id
        WHERE f.kind = 'operation' AND to_jsonb(op) IS DISTINCT FROM f.snapshot
    ) THEN
        RAISE EXCEPTION 'portfolio fx repair: a frozen BTC buy or sell changed';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM portfolio_fx_repair_frozen f
        JOIN investment_operations op ON op.id = f.id
        WHERE f.kind = 'adjustment'
          AND (to_jsonb(op) - 'adjustmentMode' - 'updatedAt') IS DISTINCT FROM (f.snapshot - 'adjustmentMode' - 'updatedAt')
    ) THEN
        RAISE EXCEPTION 'portfolio fx repair: the 2026-10-02 BTC adjustment changed beyond its mode';
    END IF;

    INSERT INTO portfolio_fx_repair_run ("fxLegs", "btcDetached", modes, holdings)
    VALUES (fx_count, detach_count, mode_count, holding_count);
END
$repair$;

DROP FUNCTION IF EXISTS pg_temp.portfolio_fx_replay(TEXT, BOOLEAN, DOUBLE PRECISION, DOUBLE PRECISION);
