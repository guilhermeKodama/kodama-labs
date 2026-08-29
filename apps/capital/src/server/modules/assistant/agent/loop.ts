import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@capital/server/lib/prisma";
import { env } from "@/env";
import { getAnthropicClient, estimateCostUsd } from "@capital/server/lib/anthropic";
import { AGENT_TOOLS } from "./tools/index";
import { toAnthropicTools, executeTool } from "./tools/registry";
import { loadAgentKnowledge } from "./knowledge/index";
import { buildApiMessages, type CapitalFileRefBlock } from "./message-content";
import { insertAgentMessage, updateAgentMessageContent } from "../data/commands/insert-agent-message";
import { insertAgentTurn, updateAgentTurn, fetchAgentTurnStatus } from "../data/commands/manage-agent-turn";
import { fetchMessageHistory } from "../data/queries/fetch-message-history";
import { touchConversation } from "../data/commands/update-conversation";
import { maybeGenerateConversationTitle } from "./services/generate-conversation-title";
import { MAX_TOOL_ITERATIONS_DEFAULT, MAX_TURN_COST_USD_DEFAULT, MAX_WEB_SEARCHES_PER_TURN } from "../constants";
import type { EmitFn } from "./events";

export interface CardResponseInput {
  cardId: string;
  decisions: Array<{ pairId: string; label: string }>;
}

export interface RunAgentTurnInput {
  userId: string;
  conversationId: string;
  text?: string;
  cardResponse?: CardResponseInput;
  fileIds?: string[];
}

const TOOL_LABELS: Record<string, string> = {
  get_context_snapshot: "Consultando contas e categorias",
  list_statement_files: "Verificando arquivos da conversa",
  get_parsed_rows: "Lendo linhas do extrato",
  reconcile_statement: "Comparando com o histórico",
  search_transactions: "Buscando transações",
  search_transfers: "Buscando transferências",
  query_investment_holdings: "Consultando posições de investimento",
  list_import_batches: "Consultando importações anteriores",
  list_credit_card_bills: "Consultando faturas de cartão",
  search_bill_transactions: "Buscando lançamentos de fatura",
  propose_import_plan: "Montando o plano de importação",
  update_import_plan: "Atualizando o plano",
  propose_revert_plan: "Montando o plano de reversão",
  commit_plan: "Aplicando o plano",
  record_merchant_category: "Salvando categoria aprendida",
  update_transactions: "Atualizando transações",
  manage_investment_account: "Gerenciando conta de investimento",
  manage_investment_holding: "Gerenciando posição de investimento",
  record_investment_transaction: "Registrando movimento de investimento",
  fund_investment_account: "Movendo caixa da conta de investimento",
  manage_credit_card: "Gerenciando cartão de crédito",
  update_bill_transactions: "Atualizando lançamentos de fatura",
  link_bill_to_transaction: "Vinculando fatura ao lançamento",
  update_bill: "Corrigindo datas da fatura",
  present_card: "Preparando card de decisão",
};

function formatCardResponseText(cardResponse: CardResponseInput): string {
  const lines = cardResponse.decisions.map((d) => `- ${d.pairId}: ${d.label}`);
  return `[Resposta do usuário ao card duplicate_review, cardId=${cardResponse.cardId}]\n${lines.join("\n")}`;
}

function summarizeToolResult(toolName: string, output: unknown): string | undefined {
  const o = output as Record<string, unknown> | undefined;
  if (!o) return undefined;
  switch (toolName) {
    case "reconcile_statement": {
      const s = o.summary as Record<string, number> | undefined;
      if (!s) return undefined;
      return `${s.new} novas · ${s.duplicate} duplicadas · ${s.changed} mudaram · ${s.fuzzyMatch} para revisar`;
    }
    case "commit_plan":
      return typeof o.imported === "number" ? `${o.imported} transações importadas` : undefined;
    case "search_transactions":
    case "search_transfers":
      return typeof o.total === "number" ? `${o.total} encontradas` : undefined;
    default:
      return undefined;
  }
}

/**
 * web_search is a server-executed tool - by the time we see it in
 * message.content, Anthropic has already run the search and attached the
 * results, unlike our own tools which round-trip through executeTool().
 * This just surfaces that activity to the UI with the same
 * tool_call_started/tool_call_result pair our tools use, so the chat
 * shows what was searched instead of an unexplained pause.
 */
function emitWebSearchActivity(
  content: Anthropic.ContentBlock[],
  messageId: string,
  emit: EmitFn
): void {
  const searches = content.filter(
    (b): b is Anthropic.ServerToolUseBlock => b.type === "server_tool_use" && b.name === "web_search"
  );
  const results = content.filter(
    (b): b is Anthropic.WebSearchToolResultBlock => b.type === "web_search_tool_result"
  );

  for (const search of searches) {
    const query = (search.input as { query?: string } | undefined)?.query;
    emit({
      type: "tool_call_started",
      messageId,
      toolCallId: search.id,
      tool: "web_search",
      label: query ? `Pesquisando: ${query}` : "Pesquisando na web",
    });

    const result = results.find((r) => r.tool_use_id === search.id);
    const isError = !!result && !Array.isArray(result.content);
    const summary =
      result && Array.isArray(result.content) ? `${result.content.length} resultados` : undefined;
    emit({
      type: "tool_call_result",
      messageId,
      toolCallId: search.id,
      tool: "web_search",
      status: isError ? "error" : "success",
      summary,
    });
  }
}

/**
 * Runs one full agent turn: persists the user message, streams the
 * model's response (and any tool calls) to `emit`, and persists every
 * assistant/tool_result message as it happens - so a killed serverless
 * function loses nothing durable, the next turn just continues from
 * whatever was last saved.
 */
export async function runAgentTurn(input: RunAgentTurnInput, emit: EmitFn): Promise<void> {
  // Checked again just before the first API call (below) - resolved
  // here only to decide the model name for the turn row, so the user's
  // message still gets persisted even when the key is missing.
  const anthropic = getAnthropicClient();
  const model = env.CAPITAL_AGENT_MODEL;
  const maxIterations = env.ASSISTANT_MAX_TOOL_ITERATIONS ?? MAX_TOOL_ITERATIONS_DEFAULT;
  const maxCostUsd = env.ASSISTANT_MAX_TURN_COST_USD ?? MAX_TURN_COST_USD_DEFAULT;

  const turn = await insertAgentTurn(input.conversationId, model, prisma);
  emit({ type: "turn_started", turnId: turn.id });

  const startedAt = Date.now();
  let status: "completed" | "failed" | "cancelled" = "completed";
  let turnError: string | undefined;
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheCreate = 0;
  let totalCacheRead = 0;
  let totalCost = 0;

  try {
    // ---- Build and persist the new user message ----
    const userBlocks: unknown[] = [];
    if (input.text) userBlocks.push({ type: "text", text: input.text });
    if (input.cardResponse) {
      userBlocks.push({ type: "text", text: formatCardResponseText(input.cardResponse) });
      userBlocks.push({
        type: "capital_card_response",
        cardId: input.cardResponse.cardId,
        decisions: input.cardResponse.decisions,
      });
      emit({ type: "card_locked", cardId: input.cardResponse.cardId, decision: input.cardResponse.decisions });
    }
    const attachedNonPdfNames: string[] = [];
    if (input.fileIds?.length) {
      const files = await prisma.conversationFile.findMany({
        where: { id: { in: input.fileIds }, conversationId: input.conversationId, userId: input.userId },
        select: { id: true, fileType: true, originalName: true, blobUrl: true },
      });
      for (const f of files) {
        if (f.fileType === "pdf") {
          const ref: CapitalFileRefBlock = {
            type: "capital_file_ref",
            fileId: f.id,
            originalName: f.originalName,
            blobUrl: f.blobUrl,
          };
          userBlocks.push(ref);
        } else {
          // OFX/CSV never go in as a content block (they're read via
          // get_parsed_rows, never transcribed) - but the model still
          // needs a text cue that something was just attached, or a
          // file-only send with no PDF would otherwise leave userBlocks
          // empty going into the "no message at all" fallback below.
          attachedNonPdfNames.push(f.originalName);
        }
      }
    }
    if (userBlocks.length === 0 && attachedNonPdfNames.length > 0) {
      userBlocks.push({
        type: "text",
        text: `[Anexei ${attachedNonPdfNames.length === 1 ? "o arquivo" : "os arquivos"} ${attachedNonPdfNames.join(", ")} à conversa - veja list_statement_files.]`,
      });
    }
    if (userBlocks.length === 0) {
      userBlocks.push({ type: "text", text: "(mensagem vazia)" });
    }

    const userMessage = await insertAgentMessage(
      {
        conversationId: input.conversationId,
        turnId: turn.id,
        role: "user",
        content: userBlocks,
        kind: input.cardResponse ? "card_response" : "user_text",
      },
      prisma
    );
    emit({
      type: "message_created",
      message: {
        id: userMessage.id,
        role: "user",
        kind: userMessage.kind,
        createdAt: userMessage.createdAt.toISOString(),
      },
    });
    await touchConversation(input.conversationId, prisma);
    if (!input.cardResponse) {
      await maybeGenerateConversationTitle(input.conversationId, input.text, attachedNonPdfNames);
    }

    if (!anthropic) {
      // Thrown, not returned: the shared catch block below still needs
      // to run so the turn gets finalized (status, turn_completed
      // event) instead of being stuck at "running" forever.
      throw new Error("ANTHROPIC_API_KEY não configurada neste ambiente.");
    }

    // ---- Rebuild full history for the API call ----
    const history = await fetchMessageHistory(input.conversationId, prisma);
    let apiMessages = await buildApiMessages(history);

    const knowledge = loadAgentKnowledge();
    const today = new Date().toISOString().split("T")[0];
    const system: Anthropic.TextBlockParam[] = [
      { type: "text", text: knowledge, cache_control: { type: "ephemeral" } },
      { type: "text", text: `Data de hoje: ${today}. conversationId: ${input.conversationId}.` },
    ];

    // web_search is a server-executed tool - Anthropic runs the search and
    // feeds results back into the same response, never a client tool_use
    // round trip through executeTool(). Used to identify unfamiliar
    // merchants/companies for auto-categorization; see
    // 25-categorization.md for when it's appropriate to reach for it.
    const webSearchTool: Anthropic.WebSearchTool20250305 = {
      type: "web_search_20250305",
      name: "web_search",
      max_uses: MAX_WEB_SEARCHES_PER_TURN,
    };
    const tools: Anthropic.ToolUnion[] = [...toAnthropicTools(AGENT_TOOLS), webSearchTool];
    const ctx = { userId: input.userId, conversationId: input.conversationId, turnId: turn.id, db: prisma };

    let iterations = 0;
    let budgetExceeded = false;

    iterationLoop: while (iterations < maxIterations) {
      iterations++;

      const currentStatus = await fetchAgentTurnStatus(turn.id, prisma);
      if (currentStatus === "cancelled") {
        status = "cancelled";
        break;
      }

      // Placeholder row so token events have a stable messageId to
      // stream against before the response is complete.
      const assistantMessage = await insertAgentMessage(
        { conversationId: input.conversationId, turnId: turn.id, role: "assistant", content: [], kind: "assistant" },
        prisma
      );
      emit({
        type: "message_created",
        message: {
          id: assistantMessage.id,
          role: "assistant",
          kind: "assistant",
          createdAt: assistantMessage.createdAt.toISOString(),
        },
      });

      const stream = anthropic.messages.stream({
        model,
        max_tokens: 8192,
        thinking: { type: "adaptive" },
        system,
        messages: apiMessages,
        tools,
      });

      stream.on("text", (delta) => {
        emit({ type: "token", messageId: assistantMessage.id, delta });
      });

      const message = await stream.finalMessage();

      totalInput += message.usage.input_tokens;
      totalOutput += message.usage.output_tokens;
      totalCacheCreate += message.usage.cache_creation_input_tokens ?? 0;
      totalCacheRead += message.usage.cache_read_input_tokens ?? 0;
      totalCost += estimateCostUsd(model, message.usage);

      await updateAgentMessageContent(assistantMessage.id, message.content, prisma);
      emit({ type: "message_complete", messageId: assistantMessage.id });
      emitWebSearchActivity(message.content, assistantMessage.id, emit);

      apiMessages = [
        ...apiMessages,
        { role: "assistant", content: message.content as unknown as Anthropic.ContentBlockParam[] },
      ];

      const toolUseBlocks = message.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );

      if (toolUseBlocks.length === 0) {
        // end_turn, max_tokens, stop_sequence, refusal - nothing more to do.
        break;
      }

      const toolResultBlocks: Anthropic.ToolResultBlockParam[] = [];

      for (const block of toolUseBlocks) {
        emit({
          type: "tool_call_started",
          messageId: assistantMessage.id,
          toolCallId: block.id,
          tool: block.name,
          label: TOOL_LABELS[block.name] ?? `Executando ${block.name}`,
        });

        const result = await executeTool(AGENT_TOOLS, ctx, block.id, block.name, block.input);

        emit({
          type: "tool_call_result",
          messageId: assistantMessage.id,
          toolCallId: block.id,
          tool: block.name,
          status: result.isError ? "error" : "success",
          summary: result.isError ? undefined : summarizeToolResult(block.name, result.output),
        });

        if (!result.isError) {
          if (block.name === "propose_import_plan" || block.name === "update_import_plan" || block.name === "propose_revert_plan") {
            const o = result.output as {
              planId: string;
              kind: "import" | "revert";
              summary: unknown;
              payloadHash: string;
              warnings: string[];
            };
            emit({
              type: "plan_proposed",
              messageId: assistantMessage.id,
              planId: o.planId,
              kind: o.kind,
              summary: o.summary,
              payloadHash: o.payloadHash,
              warnings: o.warnings,
            });
          } else if (block.name === "commit_plan") {
            const o = result.output as { planId: string };
            emit({
              type: "plan_committed",
              messageId: assistantMessage.id,
              planId: o.planId,
              kind: "import",
              result: result.output,
            });
          } else if (block.name === "present_card") {
            emit({ type: "action_card", messageId: assistantMessage.id, card: result.output });
          }
        }

        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result.output),
          is_error: result.isError,
        });
      }

      const toolResultMessage = await insertAgentMessage(
        {
          conversationId: input.conversationId,
          turnId: turn.id,
          role: "user",
          content: toolResultBlocks,
          kind: "tool_results",
        },
        prisma
      );
      emit({
        type: "message_created",
        message: {
          id: toolResultMessage.id,
          role: "user",
          kind: "tool_results",
          createdAt: toolResultMessage.createdAt.toISOString(),
        },
      });

      apiMessages = [...apiMessages, { role: "user", content: toolResultBlocks }];

      if (totalCost >= maxCostUsd) {
        budgetExceeded = true;
        break iterationLoop;
      }
    }

    if (budgetExceeded) {
      turnError = "Orçamento do turno atingido - envie outra mensagem para continuar.";
    } else if (iterations >= maxIterations) {
      turnError = "Limite de iterações do turno atingido - envie outra mensagem para continuar.";
    }
  } catch (error) {
    status = "failed";
    turnError = error instanceof Error ? error.message : "Erro desconhecido no turno do agente";
    emit({ type: "error", code: "TURN_FAILED", message: turnError, retryable: true });
  }

  await updateAgentTurn(
    turn.id,
    {
      status,
      inputTokens: totalInput,
      outputTokens: totalOutput,
      cacheCreationInputTokens: totalCacheCreate,
      cacheReadInputTokens: totalCacheRead,
      costUsd: totalCost,
      durationMs: Date.now() - startedAt,
      error: turnError,
      completedAt: new Date(),
    },
    prisma
  );

  emit({
    type: "turn_completed",
    turnId: turn.id,
    status,
    inputTokens: totalInput,
    outputTokens: totalOutput,
    costUsd: totalCost,
  });
}
