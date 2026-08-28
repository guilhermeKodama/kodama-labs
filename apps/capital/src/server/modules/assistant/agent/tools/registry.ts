import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type Anthropic from "@anthropic-ai/sdk";
import type { PrismaClient } from "@/generated/prisma";
import { insertAgentAction, type CreatedRecordRef } from "../../data/commands/insert-agent-action";

/**
 * Everything a tool handler is allowed to see. userId ALWAYS comes from
 * the authenticated session that started the turn - it is never read
 * from model input, and no tool schema below accepts a userId field.
 * db is the top-level client (never a nested transaction client): tools
 * are never invoked from inside a pre-existing transaction, and
 * commit_plan/propose_revert_plan need to open their own ($transaction)
 * around the whole write.
 */
export interface ToolContext {
  userId: string;
  conversationId: string;
  turnId: string;
  db: PrismaClient;
}

export type ToolAccess = "read" | "write_plan" | "write_domain";

export interface ToolOutput {
  /** Present when a write tool created rows - powers the revert plan. */
  createdRecords?: CreatedRecordRef[];
  [key: string]: unknown;
}

export interface AgentToolDef<In extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  /** Include when-to-use guidance, not just a description of the shape. */
  description: string;
  inputSchema: In;
  access: ToolAccess;
  /** write_domain tools only: refuse unless the referenced plan is "confirmed". */
  requiresConfirmedPlan?: boolean;
  handler: (ctx: ToolContext, input: z.infer<In>) => Promise<ToolOutput>;
}

/**
 * Storing every tool in one array requires erasing each one's concrete
 * input type - defineTool() below still gives each tool file full
 * z.infer<In> inference at its own call site; only the shared registry
 * (this array's element type, and toAnthropicTools/executeTool's
 * parameter type) needs the erased form, since input is validated at
 * runtime via inputSchema.safeParse() regardless of what TS sees here.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- sole erasure point, see comment above
export type AnyAgentToolDef = AgentToolDef<any>;

/** Identity helper that keeps `z.infer<In>` inference intact at the call site. */
export function defineTool<In extends z.ZodTypeAny>(
  def: AgentToolDef<In>
): AgentToolDef<In> {
  return def;
}

/**
 * Anthropic's tool input_schema rejects a handful of standard JSON Schema
 * bound/constraint keywords outright - confirmed live via 400s on both
 * "minimum" (integer) and "maxItems" (array). The rest of this family
 * (exclusiveMinimum/maxLength/etc) is almost certainly the same story, so
 * all of it is stripped rather than discovering each one via another
 * failed turn. Zod schemas keep their full constraints - this only
 * sanitizes the outbound JSON Schema view; runtime validation in
 * executeTool() still calls the real (unstripped) def.inputSchema.
 */
const UNSUPPORTED_SCHEMA_KEYWORDS = new Set([
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
]);

function stripUnsupportedSchemaKeywords(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(stripUnsupportedSchemaKeywords);
  }
  if (node && typeof node === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (UNSUPPORTED_SCHEMA_KEYWORDS.has(key)) continue;
      result[key] = stripUnsupportedSchemaKeywords(value);
    }
    return result;
  }
  return node;
}

/**
 * Anthropic tool defs, in the registry's declared order (deterministic -
 * this is what keeps the prompt-cache prefix stable across turns; never
 * sort or filter this array per-request).
 *
 * strict (constrained decoding) is deliberately NOT set: it compiles one
 * grammar across every tool in the request and caps total optional
 * parameters at 24 across all of them combined - confirmed live via a
 * 400 ("Schemas contains too many optional parameters (75)") from this
 * registry's real 14 tools, well past that budget given how many
 * optional fields propose_import_plan's payload alone needs. Dropping
 * strict costs nothing safety-wise: input is still fully re-validated by
 * def.inputSchema.safeParse() in executeTool() below regardless of
 * whether the model's JSON was grammar-constrained on the way out.
 */
export function toAnthropicTools(defs: AnyAgentToolDef[]): Anthropic.Tool[] {
  return defs.map((def) => ({
    name: def.name,
    description: def.description,
    input_schema: stripUnsupportedSchemaKeywords(
      zodToJsonSchema(def.inputSchema, { $refStrategy: "none", target: "openApi3" })
    ) as Anthropic.Tool.InputSchema,
  }));
}

export interface ToolExecutionResult {
  toolUseId: string;
  toolName: string;
  output: unknown;
  isError: boolean;
  durationMs: number;
}

/**
 * The complete allowlist enforcement point: unknown tool names and
 * schema-invalid input both come back as a tool_result with is_error
 * (the model self-corrects on the next turn) rather than throwing past
 * the loop. Every write-access execution is audited regardless of
 * success/failure.
 */
export async function executeTool(
  defs: AnyAgentToolDef[],
  ctx: ToolContext,
  toolUseId: string,
  name: string,
  rawInput: unknown
): Promise<ToolExecutionResult> {
  const startedAt = Date.now();
  const def = defs.find((d) => d.name === name);

  if (!def) {
    return {
      toolUseId,
      toolName: name,
      output: { error: `Unknown tool "${name}". It is not in the allowlist.` },
      isError: true,
      durationMs: Date.now() - startedAt,
    };
  }

  const parsed = def.inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      toolUseId,
      toolName: name,
      output: { error: `Invalid input for ${name}: ${parsed.error.message}` },
      isError: true,
      durationMs: Date.now() - startedAt,
    };
  }

  try {
    const output = await def.handler(ctx, parsed.data);
    const durationMs = Date.now() - startedAt;
    if (def.access !== "read") {
      await insertAgentAction(
        {
          userId: ctx.userId,
          conversationId: ctx.conversationId,
          turnId: ctx.turnId,
          toolName: def.name,
          input: parsed.data,
          output,
          status: "success",
          createdRecords: output.createdRecords,
          durationMs,
        },
        ctx.db
      );
    }
    return { toolUseId, toolName: name, output, isError: false, durationMs };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : "Unknown error";
    if (def.access !== "read") {
      await insertAgentAction(
        {
          userId: ctx.userId,
          conversationId: ctx.conversationId,
          turnId: ctx.turnId,
          toolName: def.name,
          input: parsed.data,
          status: "error",
          error: message,
          durationMs,
        },
        ctx.db
      );
    }
    return { toolUseId, toolName: name, output: { error: message }, isError: true, durationMs };
  }
}
