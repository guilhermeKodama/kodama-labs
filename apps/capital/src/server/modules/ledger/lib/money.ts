import { Prisma } from "@/generated/prisma";
import type { LedgerKind } from "@/generated/prisma";

export type DecimalLike = Prisma.Decimal | number | string;

export function toDecimal(value: DecimalLike): Prisma.Decimal {
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
}

export function toNumber(value: DecimalLike | null | undefined): number {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  return Number(value.toString());
}

export function round(value: number, places = 4): number {
  const f = 10 ** places;
  return Math.round((value + Number.EPSILON) * f) / f;
}

/**
 * Sign applied to a user-facing amount to get the stored, account-signed
 * amount: income is an inflow, expense and investment are outflows. A
 * negative user amount on an expense is a refund (stored positive).
 */
export function kindSign(kind: LedgerKind): 1 | -1 {
  return kind === "income" ? 1 : -1;
}

/** User-facing magnitude of a stored entry (inverse of `kindSign`). */
export function displayAmount(kind: LedgerKind, stored: DecimalLike): number {
  return kind === "transfer" ? Math.abs(toNumber(stored)) : kindSign(kind) * toNumber(stored);
}

/** Split `total` into `count` parts rounded to cents; the last part absorbs the remainder. */
export function splitAmount(total: number, count: number): number[] {
  const base = Math.floor((total / count) * 100) / 100;
  const parts = Array.from({ length: count }, () => base);
  parts[count - 1] = round(total - base * (count - 1), 2);
  return parts;
}
