"use server";

import { prisma } from "../../lib/prisma";
import type { TaskType } from "../../jobs/queue";

export type PipelineStatus = {
  pending: number; // QUEUED + RUNNING, across the watched types
  running: number; // RUNNING only — actively being worked, not just waiting
};

/**
 * Polled by TaskProgress (client component) so a "reavaliar fila" /
 * "treinar agora" / "gerar sugestões" click has visible feedback instead of
 * silently enqueueing work the user has no way to see finish.
 */
export async function getPipelineStatus(types: TaskType[]): Promise<PipelineStatus> {
  const [pending, running] = await Promise.all([
    prisma.task.count({ where: { type: { in: types }, status: { in: ["QUEUED", "RUNNING"] } } }),
    prisma.task.count({ where: { type: { in: types }, status: "RUNNING" } }),
  ]);
  return { pending, running };
}
