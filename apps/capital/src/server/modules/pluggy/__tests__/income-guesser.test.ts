import { beforeEach, describe, expect, it, vi } from "vitest";

const envMock = vi.hoisted(() => ({ ANTHROPIC_API_KEY: "test-key" as string | undefined }));
vi.mock("@/env", () => ({ env: envMock }));

const create = vi.hoisted(() => vi.fn());
const getAnthropicClient = vi.hoisted(() => vi.fn());
vi.mock("@capital/server/lib/anthropic", () => ({ getAnthropicClient }));

import { anthropicIncomeGuesser } from "../lib/guesser";

const INPUT = { type: "INTEREST", amount: 25, description: "Rendimento do CDB", ticker: "CDB123", assetType: "FIXED_INCOME", assetSubtype: "CDB", assetName: "CDB Banco X", incomeTax: 3 };

const reply = (text: string) => ({ content: [{ type: "text", text }] });

beforeEach(() => {
  envMock.ANTHROPIC_API_KEY = "test-key";
  create.mockReset();
  getAnthropicClient.mockReset();
  getAnthropicClient.mockReturnValue({ messages: { create } });
});

describe("anthropicIncomeGuesser", () => {
  it("makes no call without an API key", async () => {
    envMock.ANTHROPIC_API_KEY = undefined;
    await expect(anthropicIncomeGuesser()(INPUT)).resolves.toBeNull();
    expect(getAnthropicClient).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("returns null when the client cannot be built", async () => {
    getAnthropicClient.mockReturnValue(null);
    await expect(anthropicIncomeGuesser()(INPUT)).resolves.toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it("asks Haiku with the redacted facts and a timeout, and returns the parsed guess", async () => {
    create.mockResolvedValue(reply('{"incomeType":"jcp","origin":"BR","confidence":0.9}'));

    const guess = await anthropicIncomeGuesser()({ ...INPUT, description: "JCP cpf 123.456.789-00 conta 987654321" });

    expect(guess).toEqual({ incomeType: "jcp", origin: "BR", confidence: 0.9 });
    expect(create).toHaveBeenCalledTimes(1);
    const [params, options] = create.mock.calls[0]!;
    expect(options).toEqual({ timeout: 20_000 });
    expect(params).toMatchObject({ model: "claude-haiku-4-5", max_tokens: 200 });
    const prompt: string = params.messages[0].content;
    const facts = JSON.parse(prompt.split("\n").pop()!);
    expect(facts).toEqual({
      description: "JCP cpf •••• conta ••••",
      ticker: "CDB123",
      assetType: "FIXED_INCOME",
      assetSubtype: "CDB",
      name: "CDB Banco X",
      incomeTax: 3,
      amount: 25,
    });
    expect(prompt).not.toContain("123.456.789-00");
    expect(prompt).not.toContain("987654321");
  });

  it("sends zero tax and an empty description when the transaction has none", async () => {
    create.mockResolvedValue(reply('{"incomeType":"dividend","origin":"BDR","confidence":0.5}'));
    await anthropicIncomeGuesser()({ type: "INTEREST", amount: 10 });
    const facts = JSON.parse((create.mock.calls[0]![0].messages[0].content as string).split("\n").pop()!);
    expect(facts).toMatchObject({ description: "", incomeTax: 0, amount: 10 });
  });

  it("reads a reply wrapped in a code fence", async () => {
    create.mockResolvedValue(reply('```json\n{"incomeType":"fii_income","origin":null,"confidence":0.7}\n```'));
    await expect(anthropicIncomeGuesser()(INPUT)).resolves.toEqual({ incomeType: "fii_income", origin: null, confidence: 0.7 });
    create.mockResolvedValue(reply('```\n{"incomeType":"fixed_income_interest","confidence":1}\n```'));
    await expect(anthropicIncomeGuesser()(INPUT)).resolves.toEqual({ incomeType: "fixed_income_interest", origin: null, confidence: 1 });
  });

  it("normalises the origin's case, drops an unknown one and defaults a missing confidence to zero", async () => {
    create.mockResolvedValue(reply('{"incomeType":"dividend","origin":"exterior","confidence":0.6}'));
    expect((await anthropicIncomeGuesser()(INPUT))?.origin).toBe("EXTERIOR");
    create.mockResolvedValue(reply('{"incomeType":"dividend","origin":"bdr","confidence":0.6}'));
    expect((await anthropicIncomeGuesser()(INPUT))?.origin).toBe("BDR");
    create.mockResolvedValue(reply('{"incomeType":"dividend","origin":"MARS","confidence":0.6}'));
    expect((await anthropicIncomeGuesser()(INPUT))?.origin).toBeNull();
    create.mockResolvedValue(reply('{"incomeType":"dividend","origin":"BR"}'));
    expect(await anthropicIncomeGuesser()(INPUT)).toEqual({ incomeType: "dividend", origin: "BR", confidence: 0 });
    create.mockResolvedValue(reply('{"incomeType":"dividend","origin":"BR","confidence":"high"}'));
    expect((await anthropicIncomeGuesser()(INPUT))?.confidence).toBe(0);
  });

  it("returns null for a reply it cannot use", async () => {
    const guesser = anthropicIncomeGuesser();
    for (const bad of [
      { content: [] },
      { content: [{ type: "tool_use", id: "t", name: "x", input: {} }] },
      reply("I think it is a dividend"),
      reply('{"origin":"BR","confidence":0.9}'),
      reply('{"incomeType":"salary","confidence":0.9}'),
      reply("null"),
    ]) {
      create.mockResolvedValue(bad);
      await expect(guesser(INPUT)).resolves.toBeNull();
    }
  });

  it("returns null when the call fails instead of throwing", async () => {
    create.mockRejectedValue(new Error("timeout"));
    await expect(anthropicIncomeGuesser()(INPUT)).resolves.toBeNull();
  });
});
