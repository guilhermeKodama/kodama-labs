-- One row per UTC day: how many Alpha Vantage HTTP calls have been made.
-- The free tier allows 25 a day. Callers stop at 22 (see
-- alpha-vantage-budget.ts) so the daily close keeps a few in reserve.
-- A new day is a new row, which is the reset.

CREATE TABLE "alpha_vantage_call_days" (
    "day" DATE NOT NULL,
    "calls" INTEGER NOT NULL,

    CONSTRAINT "alpha_vantage_call_days_pkey" PRIMARY KEY ("day")
);
