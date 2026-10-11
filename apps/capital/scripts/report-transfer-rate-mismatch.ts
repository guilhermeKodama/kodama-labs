/**
 * Read-only list of cross-currency transfer legs whose stored rate does not
 * reproduce amountBase (|amount × exchangeRate − amountBase| > 0.01).
 * Does not write. Never prints DATABASE_URL.
 *
 *   pnpm exec tsx scripts/report-transfer-rate-mismatch.ts [--user <userId or email>]
 */
import { prisma } from "../src/server/lib/prisma";

const TOLERANCE = 0.01;

function redact(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://***");
}

function num(value: { toString(): string }): number {
  return Number(value.toString());
}

async function resolveUserId(value: string): Promise<string> {
  if (!value.includes("@")) return value;
  const user = await prisma.user.findUnique({
    where: { email: value },
    select: { id: true },
  });
  if (!user) throw new Error("--user email was not found");
  return user.id;
}

async function main() {
  const userFlag = process.argv.indexOf("--user");
  const userArg = userFlag >= 0 ? process.argv[userFlag + 1] : undefined;
  if (userFlag >= 0 && !userArg) throw new Error("--user needs a user id or email");
  const userId = userArg ? await resolveUserId(userArg) : undefined;

  const legs = await prisma.ledgerEntry.findMany({
    where: {
      deletedAt: null,
      transferGroupId: { not: null },
      ...(userId ? { userId } : {}),
    },
    select: {
      id: true,
      date: true,
      amount: true,
      exchangeRate: true,
      amountBase: true,
      currency: true,
      account: { select: { name: true } },
      transferGroup: {
        select: { legs: { select: { currency: true, deletedAt: true } } },
      },
    },
    orderBy: [{ date: "asc" }, { id: "asc" }],
  });

  const mismatched = legs.filter((leg) => {
    const currencies = new Set(
      (leg.transferGroup?.legs ?? [])
        .filter((other) => other.deletedAt == null)
        .map((other) => other.currency),
    );
    if (currencies.size < 2) return false;
    const amount = num(leg.amount);
    const rate = num(leg.exchangeRate);
    const amountBase = num(leg.amountBase);
    return Math.abs(amount * rate - amountBase) > TOLERANCE;
  });

  const driftOf = (leg: (typeof mismatched)[number]) =>
    num(leg.amount) * num(leg.exchangeRate) - num(leg.amountBase);
  const total = mismatched.reduce((sum, leg) => sum + Math.abs(driftOf(leg)), 0);
  const lines = [
    `${mismatched.length} cross-currency transfer leg(s) where |amount × exchangeRate − amountBase| > ${TOLERANCE}`,
    "id\tdate\taccount\tamount\trate\tamountBase\tdrift",
    ...mismatched.map((leg) =>
      [
        leg.id,
        leg.date.toISOString().slice(0, 10),
        leg.account.name.replace(/[\t\r\n]/g, " "),
        num(leg.amount),
        num(leg.exchangeRate),
        num(leg.amountBase),
        driftOf(leg).toFixed(4),
      ].join("\t"),
    ),
    `total\t${total.toFixed(4)}`,
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

main()
  .catch((err) => {
    console.error(redact(err));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
