import { createRouter } from "@capital/server/lib/create-app";
import { prisma } from "@capital/server/lib/prisma";

const router = createRouter();

router.get("/health", async (c) => {
  try {
    await pingDatabase();
    return c.json({ status: "ok", db: "ok" });
  } catch {
    return c.json({ status: "error", db: "error" }, 503);
  }
});

async function pingDatabase(): Promise<void> {
  await Promise.race([
    prisma.$queryRaw`SELECT 1`,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error("timeout")), 3000);
    }),
  ]);
}

export default router;
