import type { DbClient } from "@capital/server/lib/prisma";

/** User messages a turn answers (not the tool results sent back to the model). */
const USER_AUTHORED = ["user_text", "card_response"];

/**
 * Whether "Tentar de novo" can re-run the conversation's last turn: that
 * turn failed, and the last thing the user wrote (saved by the failed
 * turn, or by an earlier failed one) was never answered by a turn that
 * completed or was stopped. The re-run answers that saved message instead
 * of saving the text again, so the thread and the model's history keep
 * one copy of it.
 */
export async function canRetryLastTurn(conversationId: string, db: DbClient): Promise<boolean> {
  const [latest, lastUser] = await Promise.all([
    db.agentTurn.findFirst({ where: { conversationId }, orderBy: { createdAt: "desc" }, select: { status: true } }),
    db.agentMessage.findFirst({
      where: { conversationId, role: "user", kind: { in: USER_AUTHORED } },
      orderBy: { createdAt: "desc" },
      select: { turnId: true, createdAt: true },
    }),
  ]);
  if (!latest || latest.status !== "failed" || !lastUser) return false;

  // The turn that saved the message starts just before it; later ones are re-runs.
  const answering = [{ createdAt: { gt: lastUser.createdAt } }, ...(lastUser.turnId ? [{ id: lastUser.turnId }] : [])];
  const answered = await db.agentTurn.count({
    where: { conversationId, status: { in: ["completed", "cancelled"] }, OR: answering },
  });
  return answered === 0;
}
