import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const buildIdPath = () => join(process.cwd(), ".next", "BUILD_ID");

async function loadWith(readFileSync: ReturnType<typeof vi.fn>) {
  vi.doMock("node:fs", () => ({ readFileSync, default: { readFileSync } }));
  const { getBuildId } = await import("../build-id");
  return getBuildId;
}

describe("getBuildId", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("reads .next/BUILD_ID and trims it", async () => {
    const readFileSync = vi.fn().mockReturnValue("abc123\n");
    const getBuildId = await loadWith(readFileSync);

    expect(getBuildId()).toBe("abc123");
    expect(readFileSync).toHaveBeenCalledWith(buildIdPath(), "utf8");
  });

  it("falls back to 'dev' when the file is missing", async () => {
    const readFileSync = vi.fn().mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const getBuildId = await loadWith(readFileSync);

    expect(getBuildId()).toBe("dev");
  });

  it("reads the file only once across calls", async () => {
    const readFileSync = vi.fn().mockReturnValue("abc123\n");
    const getBuildId = await loadWith(readFileSync);

    expect(getBuildId()).toBe("abc123");
    expect(getBuildId()).toBe("abc123");
    expect(readFileSync).toHaveBeenCalledTimes(1);
  });

  it("caches the 'dev' fallback even if the file appears later", async () => {
    const readFileSync = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("ENOENT");
      })
      .mockReturnValue("late-id");
    const getBuildId = await loadWith(readFileSync);

    expect(getBuildId()).toBe("dev");
    expect(getBuildId()).toBe("dev");
    expect(readFileSync).toHaveBeenCalledTimes(1);
  });
});
