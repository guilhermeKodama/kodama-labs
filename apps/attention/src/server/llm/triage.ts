import { z } from "zod";
import { prisma } from "../lib/prisma";
import { env } from "../../env";
import { displayName } from "../lib/display-name";
import { buildRecentContext, mediaLabel } from "./chat-context";
import { chatJson } from "./ollama";
import { recordLlmCall } from "./cost";

const TRIAGE_JSON_SCHEMA = {
  type: "object",
  properties: {
    nivel: { type: "string", enum: ["ignorar", "digest", "agora"] },
    precisa_resposta: { type: "boolean" },
    prazo: { type: ["string", "null"] },
    resumo_1_linha: { type: "string" },
  },
  required: ["nivel", "precisa_resposta", "prazo", "resumo_1_linha"],
};

const TriageSchema = z.object({
  nivel: z.enum(["ignorar", "digest", "agora"]),
  precisa_resposta: z.boolean(),
  prazo: z.string().nullable(),
  resumo_1_linha: z.string(),
});

export type TriageResult = z.infer<typeof TriageSchema>;

const TRIAGE_SYSTEM_PROMPT = `Você é o triador de notificações do WhatsApp do usuário. Cada mensagem chega com o contexto da conversa. Classifique em quatro campos:

- nivel: "ignorar" (spam, promoção, bot, notificação automática, grupo barulhento sem relevância pro usuário), "digest" (importa, mas pode esperar a próxima janela de resumo), "agora" (emergência real de uma pessoa real, precisa interromper o usuário AGORA — deve ser raro).
- precisa_resposta: true se a mensagem espera algum tipo de resposta do usuário.
- prazo: prazo mencionado na mensagem (string curta, ex: "sexta-feira", "hoje às 18h") ou null se não há prazo.
- resumo_1_linha: resumo da mensagem em português, no máximo 80 caracteres, direto ao ponto.

Regras:
- "agora" é raro — só emergência real (saúde, acidente, urgência crítica) de alguém próximo. Na dúvida, NUNCA use "agora".
- Grupo sem menção direta ao usuário e sem pergunta direcionada a ele → geralmente "ignorar" ou no máximo "digest".
- Promoção, propaganda, corrente, aviso automático, código de verificação, bot → "ignorar", e precisa_resposta=false.
- Na dúvida entre ignorar e digest → escolha digest.
- Se nivel="ignorar", precisa_resposta é sempre false.

Exemplos:
1. Grupo, mensagem: "🔥 SÓ HOJE! Picanha R$49,90/kg!" → {"nivel":"ignorar","precisa_resposta":false,"prazo":null,"resumo_1_linha":"Promoção de picanha no grupo."}
2. 1:1 com "Mãe", mensagem: "Filho, me liga quando puder, sem pressa" → {"nivel":"digest","precisa_resposta":true,"prazo":null,"resumo_1_linha":"Mãe pediu para ligar quando puder."}
3. 1:1, mensagem: "Consegue confirmar a renovação da apólice até quinta?" → {"nivel":"digest","precisa_resposta":true,"prazo":"quinta-feira","resumo_1_linha":"Confirmar renovação da apólice até quinta."}
4. 1:1 com contato próximo, mensagem: "Fui pro hospital, pode vir agora?" → {"nivel":"agora","precisa_resposta":true,"prazo":null,"resumo_1_linha":"Foi ao hospital, pediu para você ir agora."}
5. Grupo, mensagem menciona o usuário: "Você pode confirmar sua presença amanhã?" → {"nivel":"digest","precisa_resposta":true,"prazo":"amanhã","resumo_1_linha":"Confirmar presença na reunião de amanhã."}
6. 1:1, mensagem: "123456 é seu código de verificação" → {"nivel":"ignorar","precisa_resposta":false,"prazo":null,"resumo_1_linha":"Código de verificação automático."}

Responda apenas com o JSON no formato pedido, em português.`;

function failSafe(resumo: string): TriageResult {
  return { nivel: "digest", precisa_resposta: false, prazo: null, resumo_1_linha: resumo };
}

// ignorar never carries precisa_resposta=true, regardless of what the model said —
// cheaper and more reliable to enforce this in code than to hope the prompt holds.
function normalize(result: TriageResult): TriageResult {
  if (result.nivel === "ignorar" && result.precisa_resposta) {
    return { ...result, precisa_resposta: false };
  }
  return result;
}

async function attemptTriage(userPrompt: string): Promise<{
  result: TriageResult;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
} | null> {
  try {
    const { json, inputTokens, outputTokens, durationMs } = await chatJson({
      model: env.TRIAGE_MODEL,
      system: TRIAGE_SYSTEM_PROMPT,
      user: userPrompt,
      schema: TRIAGE_JSON_SCHEMA,
    });
    const parsed = TriageSchema.safeParse(json);
    if (!parsed.success) return null;
    return { result: normalize(parsed.data), inputTokens, outputTokens, durationMs };
  } catch {
    return null;
  }
}

export async function triageMessage(messageId: string): Promise<TriageResult> {
  const message = await prisma.message.findUniqueOrThrow({
    where: { id: messageId },
    include: { chat: true, sender: true },
  });

  // Media without a caption/transcript has nothing for the model to read —
  // classify locally without spending a call on it.
  if (!message.body) {
    return failSafe(mediaLabel(message.type));
  }

  const [context] = await Promise.all([buildRecentContext(message.chatId, message.occurredAt)]);
  const senderName = displayName({ chat: message.chat, sender: message.sender });
  const chatLabel = message.chat.isGroup
    ? `Grupo "${message.chat.name ?? "Grupo"}"`
    : "Conversa individual (1:1)";

  const userPrompt = [
    `Chat: ${chatLabel}`,
    `Remetente: ${senderName}`,
    message.mentionedMe ? "O usuário foi mencionado diretamente nesta mensagem." : null,
    context ? `Contexto recente da conversa:\n${context}` : null,
    `Mensagem a classificar (${senderName} → você): "${message.body.slice(0, 1000)}"`,
  ]
    .filter(Boolean)
    .join("\n\n");

  // One retry on timeout/parse/schema failure — never surfaces an error to
  // the caller, always resolves to a fail-safe "digest" so triage can never
  // silently drop a message.
  for (let attempt = 0; attempt < 2; attempt++) {
    const attemptResult = await attemptTriage(userPrompt);
    if (attemptResult) {
      await recordLlmCall({
        purpose: "triage",
        model: env.TRIAGE_MODEL,
        messageId,
        inputTokens: attemptResult.inputTokens,
        outputTokens: attemptResult.outputTokens,
        durationMs: attemptResult.durationMs,
      });
      return attemptResult.result;
    }
  }

  await recordLlmCall({
    purpose: "triage",
    model: env.TRIAGE_MODEL,
    messageId,
    error: "falhou após 2 tentativas (timeout, parse ou schema)",
  });
  return failSafe(message.body.slice(0, 80));
}
