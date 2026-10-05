import type { Readable } from "node:stream";
import { demuxDockerFrames, MAX_DOCKER_FRAME_BYTES } from "./docker-frames.js";
import type { ListedContainer } from "./docker.js";

/** Idle gap that closes a burst. Reset on every chunk. */
export const IDLE_MS = 500;
/** Flush even when chunks never pause, measured from the first pending byte. */
export const MAX_WAIT_MS = 2_000;
/** Retained text. A longer burst is flushed in slices instead of held. */
export const PENDING_CAP = 64 * 1024;
/** Incomplete demux tail. A larger buffer is dropped; a frame above 1 MiB is corrupt. */
export const MAX_LOG_BUFFER_BYTES = MAX_DOCKER_FRAME_BYTES + 8;

export const SKIP_TAIL = new Set([
  "log-watcher",
  "uptime-kuma",
  "docker-socket-proxy",
  "uptime-kuma-provision",
]);

export function containersToFollow(
  listed: readonly ListedContainer[],
  following: ReadonlyMap<string, unknown>,
  starting: ReadonlySet<string>,
): ListedContainer[] {
  return listed.filter(
    (container) =>
      container.State === "running" &&
      !SKIP_TAIL.has(container.service) &&
      !container.service.endsWith("-migrate") &&
      !following.has(container.Id) &&
      !starting.has(container.Id),
  );
}

/** Drop inspect bookkeeping for containers Docker no longer lists. */
export function pruneContainerMaps(
  knownIds: ReadonlySet<string>,
  restartCounts: Map<string, number>,
  migrateSeen: Set<string>,
): void {
  for (const id of restartCounts.keys()) {
    if (!knownIds.has(id)) restartCounts.delete(id);
  }
  for (const key of migrateSeen) {
    const splitAt = key.indexOf(":");
    const id = splitAt === -1 ? key : key.slice(0, splitAt);
    if (!knownIds.has(id)) migrateSeen.delete(key);
  }
}

export function forgetMeta<T>(meta: Map<string, T>, keys: readonly string[]): void {
  for (const key of keys) meta.delete(key);
}

/** Drop an oversized demux tail instead of holding it until a frame completes. */
export function boundLogBuffer(buf: Buffer): { buf: Buffer; dropped: boolean } {
  if (buf.length <= MAX_LOG_BUFFER_BYTES) return { buf, dropped: false };
  return { buf: Buffer.alloc(0), dropped: true };
}

/**
 * Demux a followed log stream into `onChunk` calls.
 * The stream is removed from `following` on end, error, or close so the next
 * tick can follow again. error+close (or end+close) only finishes once.
 */
export function attachLogFollow(options: {
  stream: Readable;
  container: ListedContainer;
  following: Map<string, Readable>;
  onChunk: (container: ListedContainer, text: string) => void;
}): void {
  const { stream, container, following, onChunk } = options;
  following.set(container.Id, stream);

  let buf = Buffer.alloc(0);
  let pending = "";
  let idle: ReturnType<typeof setTimeout> | null = null;
  let max: ReturnType<typeof setTimeout> | null = null;
  let finished = false;

  const clearIdle = (): void => {
    if (!idle) return;
    clearTimeout(idle);
    idle = null;
  };
  const clearMax = (): void => {
    if (!max) return;
    clearTimeout(max);
    max = null;
  };
  const flush = (): void => {
    clearIdle();
    clearMax();
    const text = pending;
    pending = "";
    if (text.trim()) onChunk(container, text);
  };
  const finish = (): void => {
    if (finished) return;
    finished = true;
    flush();
    following.delete(container.Id);
  };

  stream.on("data", (chunk: Buffer) => {
    if (finished) return;
    buf = Buffer.concat([buf, chunk]);
    const demuxed = demuxDockerFrames(buf);
    if (demuxed.corrupted) {
      console.error(
        `[log-watcher] corrupt docker frame from ${container.service}; dropping ${buf.length} bytes`,
      );
      buf = Buffer.alloc(0);
    } else {
      const rest = Buffer.from(demuxed.rest);
      const bounded = boundLogBuffer(rest);
      if (bounded.dropped) {
        console.error(
          `[log-watcher] dropping ${rest.length} buffered log bytes from ${container.service}`,
        );
      }
      buf = Buffer.from(bounded.buf);
    }
    if (demuxed.frames.length === 0) return;

    const fromEmpty = pending.length === 0;
    pending += demuxed.frames.map((frame) => frame.text).join("");
    while (pending.length >= PENDING_CAP) {
      const slice = pending.slice(0, PENDING_CAP);
      pending = pending.slice(PENDING_CAP);
      if (slice.trim()) onChunk(container, slice);
    }
    if (!pending) {
      clearIdle();
      clearMax();
      return;
    }
    clearIdle();
    idle = setTimeout(flush, IDLE_MS);
    if (fromEmpty && !max) max = setTimeout(flush, MAX_WAIT_MS);
  });
  stream.on("error", finish);
  stream.on("end", finish);
  stream.on("close", finish);
}
