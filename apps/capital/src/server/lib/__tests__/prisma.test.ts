import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../prisma";

type GlobalPrisma = { prisma: unknown };
const globals = globalThis as unknown as GlobalPrisma;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock("@/env");
  vi.resetModules();
});

describe("prisma client module", () => {
  it("outside production the one client is parked on globalThis, so hot reloads reuse it", () => {
    expect(globals.prisma).toBe(prisma);
  });

  it("reuses a client already parked on globalThis instead of creating another", async () => {
    const parked = { parked: true };
    const original = globals.prisma;
    globals.prisma = parked;
    try {
      vi.resetModules();
      const fresh = await import("../prisma");
      expect(fresh.prisma).toBe(parked);
    } finally {
      globals.prisma = original;
    }
  });

  it("in production it makes its own client and does not park it on globalThis", async () => {
    const original = globals.prisma;
    delete (globals as { prisma?: unknown }).prisma;
    vi.stubEnv("NODE_ENV", "production");
    try {
      vi.resetModules();
      const fresh = await import("../prisma");
      expect(fresh.prisma).toBeDefined();
      expect(fresh.prisma).not.toBe(original);
      expect(globals.prisma).toBeUndefined();
      await fresh.prisma.$disconnect();
    } finally {
      globals.prisma = original;
    }
  });

  it("in development it logs the queries it runs", async () => {
    const original = globals.prisma;
    delete (globals as { prisma?: unknown }).prisma;
    vi.stubEnv("NODE_ENV", "development");
    const logged: string[] = [];
    const capture = (chunk: unknown) => {
      logged.push(String(chunk));
      return true;
    };
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(capture);
    const info = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => void capture(args.join(" ")));
    try {
      vi.resetModules();
      const fresh = await import("../prisma");
      expect(globals.prisma).toBe(fresh.prisma);
      await fresh.prisma.$queryRaw`SELECT 1 AS dev_log_probe`;
      await fresh.prisma.$disconnect();
    } finally {
      stdout.mockRestore();
      info.mockRestore();
      globals.prisma = original;
    }
    expect(logged.join("\n")).toContain("dev_log_probe");
  });

  it("refuses to load when DATABASE_URL names a database that is not dev or test", async () => {
    const original = globals.prisma;
    delete (globals as { prisma?: unknown }).prisma;
    vi.doMock("@/env", () => ({ env: { DATABASE_URL: "postgresql://user:pass@localhost:5433/capital" } }));
    try {
      vi.resetModules();
      await expect(import("../prisma")).rejects.toThrow(/Refusing to connect: prisma client resolved the database "capital"/);
      expect(globals.prisma).toBeUndefined();
    } finally {
      globals.prisma = original;
    }
  });
});
