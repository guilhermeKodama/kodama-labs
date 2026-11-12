import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { maybeGenerateConversationTitle } from "../generate-conversation-title";

/**
 * maybeGenerateConversationTitle against the real database with a scripted
 * model. It is best effort: whatever goes wrong, the turn it runs inside
 * must not, so every refusal here is "nothing changes and nothing throws".
 */

const model = vi.hoisted(() => ({
  available: true,
  create: vi.fn(),
}));

vi.mock("@capital/server/lib/anthropic", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@capital/server/lib/anthropic")>();
  return { ...actual, getAnthropicClient: () => (model.available ? { messages: { create: model.create } } : null) };
});

const USER = "test-user-assistant-title-001";

const answer = (...content: unknown[]) => ({ content });
const titleOf = async (id: string) => (await prisma.agentConversation.findUniqueOrThrow({ where: { id } })).title;
const newConversation = async (title: string | null = null) =>
  (await prisma.agentConversation.create({ data: { userId: USER, title }, select: { id: true } })).id;

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { id: USER } });
  await prisma.user.create({ data: { id: USER, email: `${USER}@example.com`, passwordHash: "x", name: USER } });
});

beforeEach(() => {
  model.available = true;
  model.create.mockReset();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: USER } });
});

describe("maybeGenerateConversationTitle", () => {
  it("asks the small model for a title from the message and the file names, and saves it", async () => {
    const id = await newConversation();
    model.create.mockResolvedValue(answer({ type: "text", text: "Importação do extrato de março" }));

    await maybeGenerateConversationTitle(id, "  importar o extrato  ", ["marco.ofx", "fatura.csv"]);

    expect(model.create).toHaveBeenCalledTimes(1);
    const request = model.create.mock.calls[0]![0] as { model: string; max_tokens: number; messages: Array<{ role: string; content: string }> };
    expect(request).toMatchObject({ model: "claude-haiku-4-5", max_tokens: 30 });
    expect(request.messages).toHaveLength(1);
    expect(request.messages[0]!.role).toBe("user");
    expect(request.messages[0]!.content).toContain("importar o extrato - marco.ofx - fatura.csv");
    expect(await titleOf(id)).toBe("Importação do extrato de março");
  });

  it("uses only the file names when there is no text", async () => {
    const id = await newConversation();
    model.create.mockResolvedValue(answer({ type: "text", text: "Fatura" }));

    await maybeGenerateConversationTitle(id, undefined, ["fatura.csv"]);

    expect((model.create.mock.calls[0]![0] as { messages: Array<{ content: string }> }).messages[0]!.content).toContain("starts with this message:\n\nfatura.csv\n\nReply");
  });

  it("strips the quotes the model puts around the title and keeps at most 60 characters", async () => {
    const quoted = await newConversation();
    model.create.mockResolvedValue(answer({ type: "text", text: '  "Contas de março"  ' }));
    await maybeGenerateConversationTitle(quoted, "oi", []);
    expect(await titleOf(quoted)).toBe("Contas de março");

    const long = await newConversation();
    model.create.mockResolvedValue(answer({ type: "text", text: `'${"palavra ".repeat(20)}'` }));
    await maybeGenerateConversationTitle(long, "oi", []);
    const title = (await titleOf(long))!;
    expect(title).toHaveLength(60);
    expect(title.startsWith("palavra palavra")).toBe(true);
  });

  it("takes the first text block, skipping other kinds", async () => {
    const id = await newConversation();
    model.create.mockResolvedValue(answer({ type: "thinking", thinking: "hm" }, { type: "text", text: "Título certo" }));
    await maybeGenerateConversationTitle(id, "oi", []);
    expect(await titleOf(id)).toBe("Título certo");
  });

  it("does nothing when the model is not configured", async () => {
    model.available = false;
    const id = await newConversation();

    await maybeGenerateConversationTitle(id, "oi", []);

    expect(model.create).not.toHaveBeenCalled();
    expect(await titleOf(id)).toBeNull();
  });

  it("does not ask when there is nothing to name the conversation after", async () => {
    const id = await newConversation();

    await maybeGenerateConversationTitle(id, "   ", []);
    await maybeGenerateConversationTitle(id, undefined, []);

    expect(model.create).not.toHaveBeenCalled();
    expect(await titleOf(id)).toBeNull();
  });

  it("leaves a conversation that already has a title alone", async () => {
    const id = await newConversation("Título do usuário");

    await maybeGenerateConversationTitle(id, "oi", []);

    expect(model.create).not.toHaveBeenCalled();
    expect(await titleOf(id)).toBe("Título do usuário");
  });

  it("does nothing for a conversation that does not exist", async () => {
    await expect(maybeGenerateConversationTitle("00000000-0000-0000-0000-000000000000", "oi", [])).resolves.toBeUndefined();
    expect(model.create).not.toHaveBeenCalled();
  });

  it("keeps the conversation untitled when the answer has no text or only quotes", async () => {
    const noText = await newConversation();
    model.create.mockResolvedValueOnce(answer({ type: "thinking", thinking: "hm" }));
    await maybeGenerateConversationTitle(noText, "oi", []);
    expect(await titleOf(noText)).toBeNull();

    const onlyQuotes = await newConversation();
    model.create.mockResolvedValueOnce(answer({ type: "text", text: '""' }));
    await maybeGenerateConversationTitle(onlyQuotes, "oi", []);
    expect(await titleOf(onlyQuotes)).toBeNull();

    const blank = await newConversation();
    model.create.mockResolvedValueOnce(answer({ type: "text", text: "   " }));
    await maybeGenerateConversationTitle(blank, "oi", []);
    expect(await titleOf(blank)).toBeNull();
  });

  it("swallows a failing model call, logs it and leaves the conversation untitled", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const id = await newConversation();
    const failure = new Error("overloaded");
    model.create.mockRejectedValue(failure);

    await expect(maybeGenerateConversationTitle(id, "oi", [])).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledWith("[assistant] title generation failed:", failure);
    expect(await titleOf(id)).toBeNull();
  });
});
