import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineProofConfig, proofSuite } from "../config";

describe("proof suites", () => {
  afterEach(() => vi.unstubAllEnvs());

  const config = () => defineProofConfig({ dir: "/app/proof", baseURL: "http://localhost:1" });

  it("plays flows/ by default, writing to out/", () => {
    vi.stubEnv("PROOF_ONCE", "");
    vi.stubEnv("PROOF_PACKAGE", "");
    expect(proofSuite()).toBe("flows");
    expect(config().testDir).toBe(path.join("/app/proof", "flows"));
    expect(config().outputDir).toBe(path.join("/app/proof", "out", "runs"));
  });

  it("plays the validation-package tour from package/, with its results apart", () => {
    vi.stubEnv("PROOF_ONCE", "");
    vi.stubEnv("PROOF_PACKAGE", "1");
    expect(proofSuite()).toBe("package");
    expect(config().testDir).toBe(path.join("/app/proof", "package"));
    expect(config().outputDir).toBe(path.join("/app/proof", "out", "package", "runs"));
  });

  it("keeps once/ as it was", () => {
    vi.stubEnv("PROOF_ONCE", "1");
    vi.stubEnv("PROOF_PACKAGE", "");
    expect(proofSuite()).toBe("once");
    expect(config().testDir).toBe(path.join("/app/proof", "once"));
  });
});
