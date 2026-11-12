import { Prisma } from "@/generated/prisma";

/**
 * Cash-flow category of a dividend or yield cash leg.
 *
 * The leg is booked as kind `investment` (so portfolio math keeps treating
 * it as the operation's cash, not as a second income row) and flowKind `in`.
 * With no category it lands in "Sem categoria". Proventos is fii_income,
 * dividend and jcp. Rendimentos is fixed_income_interest, and the older
 * `interest` value, and a yield that never stored an income type.
 *
 * The name comes from the category catalog, not a new label:
 * - Proventos: an income category named "Proventos" when the user has one
 *   (the name September's plain-income rows and the proventos matcher
 *   already use). Otherwise the system category `dividends`, which the
 *   pt-BR seed names "Dividendos" and the English seed names "Dividends".
 *   There is no seeded category literally called "Proventos".
 * - Rendimentos: an income category named "Rendimentos", otherwise the
 *   system category `interest`. That is the pt-BR seed name. It stays
 *   separate from Proventos: the product's Proventos are fii_income +
 *   dividend + jcp, and fixed-income interest is not one of them.
 *
 * A stored category always wins. This expression only fills a null one,
 * so a row someone categorized by hand is left alone. The same choice is
 * written by record_dividend / recordOperation / convert_income_to_dividend
 * and by the backfill in
 * prisma/migrations/20261109140000_dividend_cash_category_backfill.
 */

export const INCOME_CASH_CATEGORY = {
  proventos: { name: "proventos", systemKey: "dividends" },
  rendimentos: { name: "rendimentos", systemKey: "interest" },
} as const;

export type IncomeCashBucket = keyof typeof INCOME_CASH_CATEGORY;

/** Which cash-flow bucket an income operation belongs in. Null for buys, sales and the rest. */
export function incomeCashBucket(incomeType: string | null | undefined, operationType: string): IncomeCashBucket | null {
  if (operationType !== "dividend" && operationType !== "yield_payment") return null;
  if (incomeType === "fixed_income_interest" || incomeType === "interest") return "rendimentos";
  if (incomeType == null && operationType === "yield_payment") return "rendimentos";
  return "proventos";
}

export interface IncomeCashAliases {
  entry: string;
  operation: string;
}

const DEFAULT_ALIASES: IncomeCashAliases = { entry: "le", operation: "io" };

function alias(name: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`Invalid SQL alias "${name}"`);
  return Prisma.raw(name);
}

/**
 * `categoryId` as cash flow should read it. Needs `investment_operations`
 * joined the way flowKindJoins() joins it (cashEntryId = the entry).
 * COALESCE stops at a stored category, so the lookup runs only for a null one.
 */
export function effectiveCategoryIdSql(aliases: Partial<IncomeCashAliases> = {}): Prisma.Sql {
  const a = { ...DEFAULT_ALIASES, ...aliases };
  const e = alias(a.entry);
  const o = alias(a.operation);
  const rendimentos = Prisma.sql`(
    ${o}."incomeType" IN ('fixed_income_interest', 'interest')
    OR (${o}."incomeType" IS NULL AND ${o}.type = 'yield_payment')
  )`;
  const proventosName = INCOME_CASH_CATEGORY.proventos.name;
  const rendimentosName = INCOME_CASH_CATEGORY.rendimentos.name;
  return Prisma.sql`COALESCE(${e}."categoryId", (
    SELECT c.id
    FROM categories c
    WHERE ${o}.type IN ('dividend', 'yield_payment')
      AND c."userId" = ${e}."userId"
      AND c.type = 'income'
      AND c."isArchived" = false
      AND (
        CASE WHEN ${rendimentos}
          THEN lower(btrim(c.name)) = ${rendimentosName} OR c."systemKey" = ${INCOME_CASH_CATEGORY.rendimentos.systemKey}
          ELSE lower(btrim(c.name)) = ${proventosName} OR c."systemKey" = ${INCOME_CASH_CATEGORY.proventos.systemKey}
        END
      )
    ORDER BY
      CASE WHEN ${rendimentos}
        THEN CASE
          WHEN lower(btrim(c.name)) = ${rendimentosName} THEN 0
          WHEN c."systemKey" = ${INCOME_CASH_CATEGORY.rendimentos.systemKey} THEN 1
          ELSE 2
        END
        ELSE CASE
          WHEN lower(btrim(c.name)) = ${proventosName} THEN 0
          WHEN c."systemKey" = ${INCOME_CASH_CATEGORY.proventos.systemKey} THEN 1
          ELSE 2
        END
      END,
      c.id
    LIMIT 1
  ))`;
}
