-- Passive income types. Adds the fixed-income interest kind and the
-- dividend origin. Does not rewrite existing rows; the assistant links
-- historical income with convert_income_to_dividend after deploy.

ALTER TYPE "IncomeType" ADD VALUE 'fixed_income_interest';

CREATE TYPE "DividendOrigin" AS ENUM ('BR', 'BDR', 'EXTERIOR');

ALTER TABLE "investment_operations" ADD COLUMN "dividendOrigin" "DividendOrigin";
