import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import {
  defineTool,
  executeTool,
  toAnthropicTools,
  TOOL_MEDIA_KEY,
  type ToolContext,
} from "../registry";
import { AGENT_TOOLS } from "../index";

function fakeCtx(db: unknown = {}): ToolContext {
  return {
    userId: "user_1",
    conversationId: "conv_1",
    turnId: "turn_1",
    db: db as unknown as ToolContext["db"],
  };
}

const echoTool = defineTool({
  name: "echo_read",
  description: "Echoes the input back. Read-only, never audited.",
  inputSchema: z.object({ text: z.string().min(1) }),
  access: "read",
  handler: async (_ctx, input) => ({ text: input.text }),
});

const writeTool = defineTool({
  name: "write_thing",
  description: "Writes something and reports what it created.",
  inputSchema: z.object({ amount: z.number() }),
  access: "write_domain",
  handler: async (_ctx, input) => ({
    ok: true,
    createdRecords: [{ model: "Thing", id: `t_${input.amount}` }],
  }),
});

const mediaTool = defineTool({
  name: "media_tool",
  description: "Returns a file for Claude to look at, alongside a JSON summary.",
  inputSchema: z.object({}),
  access: "write_domain",
  handler: async () => ({
    loadedCount: 1,
    [TOOL_MEDIA_KEY]: [
      {
        attachmentId: "att_1",
        originalName: "recibo.png",
        blobUrl: "blob://recibo.png",
        mediaType: "image/png",
      },
    ],
  }),
});

const throwingTool = defineTool({
  name: "throwing_tool",
  description: "Always throws, for error-path testing.",
  inputSchema: z.object({}),
  access: "write_plan",
  handler: async () => {
    throw new Error("boom");
  },
});

describe("executeTool", () => {
  it("returns is_error for an unknown tool name without touching the db", async () => {
    const db = { agentAction: { create: vi.fn() } };
    const result = await executeTool([echoTool], fakeCtx(db), "call_1", "does_not_exist", {});
    expect(result.isError).toBe(true);
    expect(result.output).toMatchObject({ error: expect.stringContaining("Unknown tool") });
    expect(db.agentAction.create).not.toHaveBeenCalled();
  });

  it("returns is_error when input fails schema validation, without touching the db", async () => {
    const db = { agentAction: { create: vi.fn() } };
    const result = await executeTool([echoTool], fakeCtx(db), "call_1", "echo_read", { text: "" });
    expect(result.isError).toBe(true);
    expect(result.output).toMatchObject({ error: expect.stringContaining("Invalid input") });
    expect(db.agentAction.create).not.toHaveBeenCalled();
  });

  it("does not audit a successful read tool", async () => {
    const db = { agentAction: { create: vi.fn() } };
    const result = await executeTool([echoTool], fakeCtx(db), "call_1", "echo_read", { text: "hi" });
    expect(result.isError).toBe(false);
    expect(result.output).toEqual({ text: "hi" });
    expect(db.agentAction.create).not.toHaveBeenCalled();
  });

  it("audits a successful write tool with its createdRecords", async () => {
    const create = vi.fn().mockResolvedValue({});
    const db = { agentAction: { create } };
    const result = await executeTool([writeTool], fakeCtx(db), "call_1", "write_thing", { amount: 7 });
    expect(result.isError).toBe(false);
    expect(create).toHaveBeenCalledTimes(1);
    const args = create.mock.calls[0][0];
    expect(args.data.status).toBe("success");
    expect(args.data.toolName).toBe("write_thing");
    expect(args.data.createdRecords).toEqual([{ model: "Thing", id: "t_7" }]);
  });

  it("audits a failed write tool with the error message, not a thrown exception", async () => {
    const create = vi.fn().mockResolvedValue({});
    const db = { agentAction: { create } };
    const result = await executeTool([throwingTool], fakeCtx(db), "call_1", "throwing_tool", {});
    expect(result.isError).toBe(true);
    expect(result.output).toEqual({ error: "boom" });
    const args = create.mock.calls[0][0];
    expect(args.data.status).toBe("error");
    expect(args.data.error).toBe("boom");
  });
});

describe("toAnthropicTools", () => {
  it("preserves declaration order (stable prompt-cache prefix)", () => {
    const tools = toAnthropicTools([writeTool, echoTool, throwingTool]);
    expect(tools.map((t) => t.name)).toEqual(["write_thing", "echo_read", "throwing_tool"]);
  });

  it("carries an object json schema and leaves strict unset (see registry.ts comment)", () => {
    const [tool] = toAnthropicTools([echoTool]);
    expect(tool!.strict).toBeUndefined();
    expect(tool!.input_schema.type).toBe("object");
  });

  // Anthropic's tool input_schema rejects bound/constraint keywords like
  // "minimum" (integer) and "maxItems" (array) with a 400 - confirmed live
  // against the real API. zod schemas keep .min()/.max()/.length() for
  // runtime validation; toAnthropicTools() must still scrub every one of
  // these out of what actually gets sent, however deeply nested.
  const UNSUPPORTED_KEYWORDS = [
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "multipleOf",
    "minLength",
    "maxLength",
    "pattern",
    "format",
    "minItems",
    "maxItems",
    "uniqueItems",
  ];

  function findKeys(node: unknown, keys: string[], path = "$"): string[] {
    const hits: string[] = [];
    if (Array.isArray(node)) {
      node.forEach((child, i) => hits.push(...findKeys(child, keys, `${path}[${i}]`)));
    } else if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        if (keys.includes(key)) hits.push(`${path}.${key}`);
        hits.push(...findKeys(value, keys, `${path}.${key}`));
      }
    }
    return hits;
  }

  it("strips bound keywords (minLength/maxItems/positive/etc) from a schema that uses them", () => {
    const boundedTool = defineTool({
      name: "bounded_tool",
      description: "Exercises every constraint keyword zod can emit.",
      inputSchema: z.object({
        text: z.string().min(1).max(10),
        count: z.number().int().min(1).max(50),
        amount: z.number().positive(),
        code: z.string().length(3),
        tags: z.array(z.string()).min(1).max(100),
      }),
      access: "read",
      handler: async () => ({}),
    });

    const [tool] = toAnthropicTools([boundedTool]);
    expect(findKeys(tool!.input_schema, UNSUPPORTED_KEYWORDS)).toEqual([]);
  });

  it("still parses/rejects out-of-range input at runtime despite the sanitized outbound schema", async () => {
    const boundedTool = defineTool({
      name: "bounded_tool",
      description: "Exercises every constraint keyword zod can emit.",
      inputSchema: z.object({ count: z.number().int().min(1).max(50) }),
      access: "read",
      handler: async (_ctx, input) => ({ count: input.count }),
    });

    const tooHigh = await executeTool([boundedTool], fakeCtx(), "c1", "bounded_tool", { count: 999 });
    expect(tooHigh.isError).toBe(true);

    const ok = await executeTool([boundedTool], fakeCtx(), "c2", "bounded_tool", { count: 5 });
    expect(ok.isError).toBe(false);
    expect(ok.output).toEqual({ count: 5 });
  });

  it("the real production tool registry never leaks a bound keyword to Anthropic", () => {
    const tools = toAnthropicTools(AGENT_TOOLS);
    for (const tool of tools) {
      const hits = findKeys(tool.input_schema, UNSUPPORTED_KEYWORDS);
      expect(hits, `tool "${tool.name}" leaked: ${hits.join(", ")}`).toEqual([]);
    }
  });

  // strict (constrained decoding) caps total optional parameters at 24
  // across every tool in the request combined - confirmed live via 400
  // ("too many optional parameters (75)") against this exact registry.
  // Re-enabling strict per-tool would silently reintroduce that cap.
  it("the real production tool registry never sets strict", () => {
    const tools = toAnthropicTools(AGENT_TOOLS);
    for (const tool of tools) {
      expect(tool.strict, `tool "${tool.name}" set strict`).toBeUndefined();
    }
  });
});

describe("executeTool - media escape hatch", () => {
  it("splits __media off the output so only the JSON summary is returned", async () => {
    const db = { agentAction: { create: vi.fn() } };
    const result = await executeTool([mediaTool], fakeCtx(db), "call_1", "media_tool", {});

    expect(result.isError).toBe(false);
    expect(result.output).toEqual({ loadedCount: 1 });
    expect(result.media).toEqual([
      {
        attachmentId: "att_1",
        originalName: "recibo.png",
        blobUrl: "blob://recibo.png",
        mediaType: "image/png",
      },
    ]);
  });

  it("never writes the media refs into the audit row", async () => {
    const create = vi.fn();
    const db = { agentAction: { create } };
    await executeTool([mediaTool], fakeCtx(db), "call_1", "media_tool", {});

    const audited = create.mock.calls[0]![0].data.output;
    expect(audited).toEqual({ loadedCount: 1 });
    expect(JSON.stringify(audited)).not.toContain(TOOL_MEDIA_KEY);
  });

  it("leaves media undefined for a tool that returns none", async () => {
    const result = await executeTool([echoTool], fakeCtx(), "call_1", "echo_read", { text: "hi" });
    expect(result.media).toBeUndefined();
    expect(result.output).toEqual({ text: "hi" });
  });
});
