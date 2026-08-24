import { z } from "zod";
import { prisma } from "../lib/prisma";
import { env } from "../../env";
import { displayName } from "../lib/display-name";
import { buildRecentContext } from "./chat-context";
import { chatJson } from "./ollama";
import { recordLlmCall } from "./cost";

const DRAFT_JSON_SCHEMA = {
  type: "object",
  properties: { texto: { type: "string" } },
  required: ["texto"],
};

const DraftSchema = z.object({ texto: z.string().min(1) });

const DRAFT_SYSTEM_PROMPT = `Você escreve rascunhos de resposta de WhatsApp no lugar do usuário. A resposta deve soar como se o próprio usuário tivesse escrito — use o estilo, comprimento e tom de voz das mensagens anteriores dele fornecidas como referência (formalidade, uso de emoji, gírias, tamanho das frases).

Regras:
- Responda diretamente ao que a mensagem pede, de forma natural e breve — como uma mensagem real de WhatsApp, não um e-mail.
- Não invente informações, compromissos ou fatos que não estão no contexto.
- Não assine com o nome do usuário.
- Se o contexto não for suficiente pra uma resposta específica, escreva algo genérico mas útil (ex: confirmar recebimento, dizer que vai verificar).

Responda apenas com o JSON pedido, com o texto da resposta em português.`;

async function buildStyleFewShot(chatId: string): Promise<string> {
  const outs = await prisma.message.findMany({
    where: { chatId, direction: "OUT", body: { not: null } },
    orderBy: { occurredAt: "desc" },
    take: 15,
    select: { body: true },
  });
  if (outs.length === 0) return "";
  return outs
    .reverse()
    .map((m) => `- ${(m.body ?? "").slice(0, 200)}`)
    .join("\n");
}

// Throws on failure instead of returning a fail-safe draft — unlike triage,
// "no draft yet" is a fine, already-handled UI state (/fila shows "Gerando
// sugestão..." + Regenerar), so the caller should let the job queue's normal
// retry/backoff handle it rather than persist an empty or garbage draft.
export async function draftReply(messageId: string): Promise<{ text: string }> {
  const message = await prisma.message.findUniqueOrThrow({
    where: { id: messageId },
    include: { chat: true, sender: true },
  });

  const [context, styleExamples] = await Promise.all([
    buildRecentContext(message.chatId, message.occurredAt),
    buildStyleFewShot(message.chatId),
  ]);

  const senderName = displayName({ chat: message.chat, sender: message.sender });
  const targetText = message.body ?? message.triageResumo ?? "[mensagem sem conteúdo disponível — responda de forma genérica]";
  const chatLabel = message.chat.isGroup
    ? `Grupo "${message.chat.name ?? "Grupo"}"`
    : "Conversa individual (1:1)";

  const userPrompt = [
    `Chat: ${chatLabel}`,
    `Remetente da mensagem: ${senderName}`,
    styleExamples ? `Exemplos de como o usuário costuma escrever neste chat:\n${styleExamples}` : null,
    context ? `Contexto recente da conversa:\n${context}` : null,
    `Mensagem para responder (${senderName} → você): "${targetText.slice(0, 1000)}"`,
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const { json, inputTokens, outputTokens, durationMs } = await chatJson({
      model: env.DRAFT_MODEL,
      system: DRAFT_SYSTEM_PROMPT,
      user: userPrompt,
      schema: DRAFT_JSON_SCHEMA,
    });
    const parsed = DraftSchema.safeParse(json);
    if (!parsed.success) throw new Error("rascunho fora do schema esperado");

    await recordLlmCall({
      purpose: "draft",
      model: env.DRAFT_MODEL,
      messageId,
      inputTokens,
      outputTokens,
      durationMs,
    });
    await prisma.replyDraft.create({
      data: { messageId, text: parsed.data.texto, model: env.DRAFT_MODEL },
    });
    return { text: parsed.data.texto };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await recordLlmCall({ purpose: "draft", model: env.DRAFT_MODEL, messageId, error: errorMessage });
    throw error;
  }
}
