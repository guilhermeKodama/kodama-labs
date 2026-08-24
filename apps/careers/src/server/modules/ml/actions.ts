"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "../../lib/prisma";
import { enqueue } from "../../jobs/queue";

export async function triggerTraining(): Promise<void> {
  await enqueue("train-model", {}, { uniqueKey: `train-model:manual:${Date.now()}` });
  revalidatePath("/lab");
}

/**
 * Re-runs scoreJob() for every job still in the funnel — each call checks
 * the current ScoringModel before touching the LLM (see llm/score.ts), so
 * this is how an already-queued backlog gets evaluated against a model
 * trained after those jobs were first scored. Staggered by handleRescoreAll
 * itself to stay inside the daily LLM budget.
 */
export async function triggerRescoreAll(): Promise<void> {
  await enqueue("rescore-all", {}, { uniqueKey: `rescore-all:manual:${Date.now()}` });
  revalidatePath("/auto");
  revalidatePath("/triagem");
  revalidatePath("/");
}

export async function triggerDistillation(): Promise<void> {
  await enqueue("distill-rules", {}, { uniqueKey: `distill-rules:manual:${Date.now()}` });
  revalidatePath("/perfil");
}

/**
 * Flips the latest ScoringModel out of shadow mode — the one explicit,
 * user-initiated action the whole design gates real auto-discard behind
 * (see server/ml/train.ts). Refuses if the model never cleared the
 * cross-validated precision bar; the UI is expected to hide this action
 * in that case too, this is the backstop.
 *
 * Also re-enqueues scoring for every job still in the funnel: without this,
 * jobs the model flagged as "would discard" *before* activation (visible on
 * /auto as shadow predictions) just sit there — nothing re-evaluates them
 * once shadowMode flips, since scoreJob() only runs when a score task is
 * actually claimed for that job. Activating should act on the backlog it
 * was just shown, not silently leave it stale.
 */
export async function activateAutoTriage(): Promise<{ error?: string }> {
  const model = await prisma.scoringModel.findFirst({ orderBy: { version: "desc" } });
  if (!model) return { error: "Nenhum modelo treinado ainda." };
  if (model.precision < 0.95) return { error: `Precisão do modelo (${Math.round(model.precision * 100)}%) abaixo dos 95% exigidos.` };

  await prisma.scoringModel.update({
    where: { id: model.id },
    data: { shadowMode: false, activatedAt: new Date() },
  });
  await enqueue("rescore-all", {}, { uniqueKey: `rescore-all:activate:${model.id}` });
  revalidatePath("/lab");
  revalidatePath("/auto");
  revalidatePath("/triagem");
  revalidatePath("/");
  return {};
}

export async function revertToShadowMode(): Promise<void> {
  const model = await prisma.scoringModel.findFirst({ orderBy: { version: "desc" } });
  if (!model) return;
  await prisma.scoringModel.update({ where: { id: model.id }, data: { shadowMode: true, activatedAt: null } });
  revalidatePath("/lab");
  revalidatePath("/auto");
}
