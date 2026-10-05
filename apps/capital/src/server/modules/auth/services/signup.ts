import type { PrismaClient } from "@/generated/prisma";
import { ensureSystemCategories } from "@capital/server/modules/categories/lib/system-categories";
import { LedgerError } from "@capital/server/modules/ledger/lib/errors";
import { getPersonalEntity } from "@capital/server/modules/ledger/services/entities";
import { ensureBuiltinViews } from "@capital/server/modules/ledger/services/views";
import { hashPassword } from "./password";

interface SignupInput {
  email: string;
  password: string;
  name: string;
  baseCurrency?: string;
}

const DEFAULT_CURRENCIES = [
  { code: "USD", name: "US Dollar", symbol: "$", manualRate: 1 },
  { code: "EUR", name: "Euro", symbol: "€", manualRate: 0.92 },
  { code: "GBP", name: "British Pound", symbol: "£", manualRate: 0.79 },
  { code: "BRL", name: "Brazilian Real", symbol: "R$", manualRate: 4.97 },
  { code: "JPY", name: "Japanese Yen", symbol: "¥", manualRate: 149.5 },
];

/** A new user starts with the PF entity and its main account, the system categories, currencies and the "Todas" view. */
export async function signup(input: SignupInput, prisma: PrismaClient) {
  const existingUser = await prisma.user.findUnique({ where: { email: input.email } });
  if (existingUser) throw new LedgerError("User with this email already exists", 409);
  const passwordHash = await hashPassword(input.password);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email: input.email, passwordHash, name: input.name, baseCurrency: input.baseCurrency || "USD" },
    });
    await getPersonalEntity(user.id, tx);
    await tx.currency.createMany({ data: DEFAULT_CURRENCIES.map((c) => ({ userId: user.id, ...c })), skipDuplicates: true });
    await ensureSystemCategories(user.id, tx);
    await ensureBuiltinViews(user.id, tx);
    return user;
  });
}
