import type { PrismaClient } from "@/generated/prisma";
import { resolveLocale, type Locale } from "@capital/server/i18n";
import { ensureSystemCategories } from "@capital/server/modules/categories/lib/system-categories";
import { signupCurrencies } from "@capital/server/modules/currencies/lib/signup-currencies";
import { LedgerError } from "@capital/server/modules/ledger/lib/errors";
import { getPersonalEntity } from "@capital/server/modules/ledger/services/entities";
import { ensureBuiltinViews } from "@capital/server/modules/ledger/services/views";
import { hashPassword } from "./password";

interface SignupInput {
  email: string;
  password: string;
  name: string;
  baseCurrency?: string;
  /** The UI's language at signup; unset takes the schema default (pt-BR). */
  locale?: Locale;
}

/**
 * A new user starts with the PF entity and its main account, the system
 * categories and the "Todas" view, both named in the user's locale, and
 * BRL, USD and EUR with rates relative to the base currency.
 */
export async function signup(input: SignupInput, prisma: PrismaClient) {
  const existingUser = await prisma.user.findUnique({ where: { email: input.email } });
  if (existingUser) throw new LedgerError("User with this email already exists", 409, { code: "auth.email_taken" });
  const passwordHash = await hashPassword(input.password);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      // Unset preferences take the schema defaults (BRL, pt-BR, dd/MM/yyyy, light).
      data: {
        email: input.email,
        passwordHash,
        name: input.name,
        ...(input.baseCurrency && { baseCurrency: input.baseCurrency.toUpperCase() }),
        ...(input.locale && { locale: input.locale }),
      },
    });
    await getPersonalEntity(user.id, tx);
    const currencies = signupCurrencies(user.baseCurrency, resolveLocale(user.locale));
    await tx.currency.createMany({ data: currencies.map((c) => ({ userId: user.id, ...c })), skipDuplicates: true });
    await ensureSystemCategories(user.id, tx);
    await ensureBuiltinViews(user.id, tx);
    return user;
  });
}
