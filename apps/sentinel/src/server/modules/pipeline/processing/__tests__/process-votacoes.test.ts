import { describe, it, expect, vi } from "vitest";

// process-votacoes imports prisma/job-runner/politician-cache at module load —
// stub them so the pure normalizeVote helper imports without a database.
vi.mock("@sentinel/server/lib/prisma", () => ({ prisma: {} }));
vi.mock("@sentinel/server/lib/job-runner", () => ({
  runJob: vi.fn(),
  markProcessed: vi.fn(),
  markErrors: vi.fn(),
}));
vi.mock("@sentinel/server/lib/politician-cache", () => ({
  getExternalIdToPoliticianId: vi.fn(),
}));

import { normalizeVote } from "../process-votacoes";

describe("normalizeVote", () => {
  it("maps Câmara tipoVoto strings to stable codes", () => {
    expect(normalizeVote("Sim")).toBe("SIM");
    expect(normalizeVote("Não")).toBe("NAO");
    expect(normalizeVote("Nao")).toBe("NAO");
    expect(normalizeVote("Abstenção")).toBe("ABSTENCAO");
    expect(normalizeVote("Obstrução")).toBe("OBSTRUCAO");
    expect(normalizeVote("Artigo 17")).toBe("ART17");
    expect(normalizeVote("")).toBe("OUTRO");
  });

  it("is case-insensitive", () => {
    expect(normalizeVote("SIM")).toBe("SIM");
    expect(normalizeVote("não")).toBe("NAO");
    expect(normalizeVote("ABSTENÇÃO")).toBe("ABSTENCAO");
  });

  it("does not misclassify Abstenção/Obstrução as Sim", () => {
    // Regression guard: the SIM check must not swallow other directions.
    expect(normalizeVote("Abstenção")).not.toBe("SIM");
    expect(normalizeVote("Obstrução")).not.toBe("SIM");
  });
});
