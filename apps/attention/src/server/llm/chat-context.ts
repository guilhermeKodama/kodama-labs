import { prisma } from "../lib/prisma";
import { displayName } from "../lib/display-name";

// Last ~N messages in the chat before the target, formatted as "HH:mm Nome: texto".
// Only messages with a surviving body (within retention) can appear here — that's
// the same window the triage/draft prompts are allowed to see.
export async function buildRecentContext(
  chatId: string,
  beforeOccurredAt: Date,
  take = 10
): Promise<string> {
  const recent = await prisma.message.findMany({
    where: { chatId, occurredAt: { lt: beforeOccurredAt }, body: { not: null } },
    orderBy: { occurredAt: "desc" },
    take,
    include: { sender: true, chat: true },
  });

  return recent
    .reverse()
    .map((m) => {
      const time = new Intl.DateTimeFormat("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "America/Sao_Paulo",
      }).format(m.occurredAt);
      const who = m.direction === "OUT" ? "Você" : displayName({ chat: m.chat, sender: m.sender });
      return `${time} ${who}: ${(m.body ?? "").slice(0, 200)}`;
    })
    .join("\n");
}

export function mediaLabel(type: string): string {
  switch (type) {
    case "imageMessage":
      return "[imagem]";
    case "videoMessage":
      return "[vídeo]";
    case "audioMessage":
      return "[áudio]";
    case "documentMessage":
      return "[documento]";
    case "stickerMessage":
      return "[figurinha]";
    default:
      return "[mídia]";
  }
}
