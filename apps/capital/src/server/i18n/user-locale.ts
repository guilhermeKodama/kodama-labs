import type { DbClient } from "@capital/server/lib/prisma";
import { resolveLocale, type Locale } from "./index";

/** The user's locale (User.locale), pt-BR when the user or the value is unknown. */
export async function loadUserLocale(userId: string, db: DbClient): Promise<Locale> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { locale: true } });
  return resolveLocale(user?.locale);
}
