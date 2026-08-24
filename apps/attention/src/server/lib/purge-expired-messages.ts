import { prisma } from "./prisma";
import { env } from "../../env";

export async function purgeExpiredMessages(): Promise<{ purged: number }> {
  const cutoff = new Date(Date.now() - env.RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const { count } = await prisma.message.updateMany({
    where: { occurredAt: { lt: cutoff }, body: { not: null } },
    data: { body: null },
  });

  return { purged: count };
}
