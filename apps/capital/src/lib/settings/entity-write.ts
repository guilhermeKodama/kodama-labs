import { readBatchId } from "@/lib/api/undo-stack";

/**
 * A write to /v2/entities (create, edit, archive): the entity it returns
 * and the change batch the server recorded for it, which gives the toast
 * its "Desfazer". Reads the entity with `batchId` alongside its fields or
 * nested as `{ entity, batchId }`; without a batchId nothing can be undone
 * and the toast is a plain one.
 */
export function readEntityWrite<E extends { id: string; name: string }>(data: unknown): { entity: E; batchId: string | null } {
  const nested = typeof data === "object" && data !== null && "entity" in data ? (data as { entity: unknown }).entity : null;
  const entity = (typeof nested === "object" && nested !== null ? nested : data) as E;
  return { entity, batchId: readBatchId(data) };
}
