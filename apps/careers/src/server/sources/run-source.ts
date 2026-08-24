import { prisma } from "../lib/prisma";
import { getAdapter } from "./registry";
import type { Source, CompanyBoard } from "../../generated/prisma";
import crypto from "node:crypto";

// Persisted (not in-memory) backoff, same shape as the job queue's fail():
// 30s base, doubling, capped at 1h — except LinkedIn on a 429/999, which
// gets a multi-hour cooldown instead (see linkedin-guest.ts). This is the
// lesson from apps/attention's WhatsApp worker: an in-memory cooldown does
// not survive the process restarting, and a systemd Restart=always loop
// will happily retry a dead source every 5 seconds forever.
async function recordFailure(sourceKey: string, message: string, longCooldown = false): Promise<void> {
  const current = await prisma.source.findUnique({ where: { key: sourceKey } });
  const failures = (current?.consecutiveFailures ?? 0) + 1;
  const backoffMs = longCooldown
    ? 6 * 60 * 60 * 1000
    : Math.min(30_000 * 2 ** failures, 60 * 60 * 1000);

  await prisma.source.update({
    where: { key: sourceKey },
    data: {
      consecutiveFailures: failures,
      lastError: message,
      lastRunAt: new Date(),
      nextRetryAt: new Date(Date.now() + backoffMs),
    },
  });
}

async function recordBoardFailure(boardId: string, message: string): Promise<void> {
  const board = await prisma.companyBoard.findUnique({ where: { id: boardId } });
  const failures = (board?.consecutiveFailures ?? 0) + 1;
  const backoffMs = Math.min(30_000 * 2 ** failures, 60 * 60 * 1000);
  await prisma.companyBoard.update({
    where: { id: boardId },
    data: {
      consecutiveFailures: failures,
      lastError: message,
      lastFetchAt: new Date(),
      nextRetryAt: new Date(Date.now() + backoffMs),
    },
  });
}

async function recordSuccess(sourceKey: string, jobCount?: number): Promise<void> {
  await prisma.source.update({
    where: { key: sourceKey },
    data: { consecutiveFailures: 0, lastError: null, lastOkAt: new Date(), lastRunAt: new Date(), nextRetryAt: null },
  });
  void jobCount;
}

async function recordBoardSuccess(boardId: string, jobCount: number): Promise<void> {
  await prisma.companyBoard.update({
    where: { id: boardId },
    data: {
      consecutiveFailures: 0,
      lastError: null,
      lastOkAt: new Date(),
      lastFetchAt: new Date(),
      lastJobCount: jobCount,
      nextRetryAt: null,
    },
  });
}

function contentHash(input: { title: string; location: string; description: string; compensation: string }): string {
  const normalized = JSON.stringify(input);
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

/**
 * Runs one source (optionally against one board), writes a SourceRun row
 * either way, and NEVER throws — a failed fetch is data (a SourceRun with
 * status FAILED and an error string), not an exception that could take
 * down the discover fan-out. This is the isolation guarantee: one broken
 * board can never stop the rest of the run.
 */
export async function runSource(params: {
  runId: string;
  source: Source;
  board?: CompanyBoard;
}): Promise<{ status: "OK" | "PARTIAL" | "FAILED"; fetched: number; promoted: number }> {
  const { runId, source, board } = params;
  const adapter = getAdapter(source.key);
  const startedAt = new Date();

  const sourceRun = await prisma.sourceRun.create({
    data: {
      runId,
      sourceKey: source.key,
      boardId: board?.id,
      startedAt,
      status: "RUNNING",
    },
  });

  if (!adapter) {
    await prisma.sourceRun.update({
      where: { id: sourceRun.id },
      data: { status: "FAILED", finishedAt: new Date(), error: `no adapter registered for ${source.key}` },
    });
    return { status: "FAILED", fetched: 0, promoted: 0 };
  }

  const warnings: string[] = [];
  let httpStatus: number | undefined;
  let fetched = 0;

  try {
    const result = await adapter.fetch({ source, board, log: (msg) => warnings.push(msg) });
    httpStatus = result.meta.httpStatus;
    fetched = result.postings.length;
    warnings.push(...result.meta.warnings);

    const isFailure = fetched === 0 && result.meta.warnings.length > 0;

    for (const posting of result.postings) {
      const hash = contentHash({
        title: posting.title,
        location: posting.locationRaw,
        description: posting.descriptionText,
        compensation: posting.compensationRaw ?? "",
      });

      await prisma.rawPosting.upsert({
        where: { sourceKey_externalId: { sourceKey: source.key, externalId: posting.externalId } },
        create: {
          sourceKey: source.key,
          externalId: posting.externalId,
          url: posting.url,
          title: posting.title,
          companyName: posting.companyName,
          locationRaw: posting.locationRaw,
          descriptionText: posting.descriptionText,
          compensationRaw: posting.compensationRaw,
          postedAt: posting.postedAt,
          payload: posting.payload as object,
          contentHash: hash,
          needsEnrichment: posting.partial ?? false,
          decision: "PENDING",
        },
        update: {
          lastSeenAt: new Date(),
        },
      });

      // Only touch changedAt/decision when the content actually changed —
      // this is what makes a steady-state daily run nearly free: most
      // postings hash-match and this branch never fires.
      const existing = await prisma.rawPosting.findUnique({
        where: { sourceKey_externalId: { sourceKey: source.key, externalId: posting.externalId } },
      });
      if (existing && existing.contentHash !== hash) {
        await prisma.rawPosting.update({
          where: { id: existing.id },
          data: { contentHash: hash, changedAt: new Date(), decision: "PENDING" },
        });
      }
    }

    if (board) {
      if (isFailure) await recordBoardFailure(board.id, warnings.join("; ") || "0 postings returned");
      else await recordBoardSuccess(board.id, fetched);
    } else {
      if (isFailure) await recordFailure(source.key, warnings.join("; ") || "0 postings returned");
      else await recordSuccess(source.key, fetched);
    }

    const status = isFailure ? "FAILED" : warnings.length > 0 ? "PARTIAL" : "OK";
    await prisma.sourceRun.update({
      where: { id: sourceRun.id },
      data: {
        status,
        finishedAt: new Date(),
        httpStatus,
        fetched,
        durationMs: Date.now() - startedAt.getTime(),
        warnings,
      },
    });

    return { status, fetched, promoted: 0 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (board) await recordBoardFailure(board.id, message);
    else await recordFailure(source.key, message, source.key === "linkedin_guest");

    await prisma.sourceRun.update({
      where: { id: sourceRun.id },
      data: { status: "FAILED", finishedAt: new Date(), error: message, durationMs: Date.now() - startedAt.getTime() },
    });

    return { status: "FAILED", fetched: 0, promoted: 0 };
  }
}
