"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "../../lib/prisma";
import { enqueue } from "../../jobs/queue";

export async function triggerTraining(): Promise<void> {
  await enqueue("train-model", {}, { uniqueKey: `train-model:manual:${Date.now()}` });
  revalidatePath("/lab");
}

/**
 * Flips the latest ScoringModel out of shadow mode — the one explicit,
 * user-initiated action the whole design gates real auto-discard behind
 * (see server/ml/train.ts). Refuses if the model never cleared the
 * cross-validated precision bar; the UI is expected to hide this action
 * in that case too, this is the backstop.
 */
export async function activateAutoTriage(): Promise<{ error?: string }> {
  const model = await prisma.scoringModel.findFirst({ orderBy: { version: "desc" } });
  if (!model) return { error: "Nenhum modelo treinado ainda." };
  if (model.precision < 0.95) return { error: `Precisão do modelo (${Math.round(model.precision * 100)}%) abaixo dos 95% exigidos.` };

  await prisma.scoringModel.update({
    where: { id: model.id },
    data: { shadowMode: false, activatedAt: new Date() },
  });
  revalidatePath("/lab");
  revalidatePath("/auto");
  return {};
}

export async function revertToShadowMode(): Promise<void> {
  const model = await prisma.scoringModel.findFirst({ orderBy: { version: "desc" } });
  if (!model) return;
  await prisma.scoringModel.update({ where: { id: model.id }, data: { shadowMode: true, activatedAt: null } });
  revalidatePath("/lab");
  revalidatePath("/auto");
}
