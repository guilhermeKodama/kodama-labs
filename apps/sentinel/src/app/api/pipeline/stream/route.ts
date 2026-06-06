import { getPipelineState } from "@sentinel/server/modules/pipeline/get-pipeline-state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const INTERVAL_MS = 5_000;
const MAX_STREAM_DURATION_MS = 50_000;

export async function GET(request: Request) {
  const { signal } = request;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const startedAt = Date.now();

      const send = (data: string) => {
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };

      try {
        while (
          !signal.aborted &&
          Date.now() - startedAt < MAX_STREAM_DURATION_MS
        ) {
          const state = await getPipelineState();
          send(JSON.stringify(state));
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, INTERVAL_MS);
            signal.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                reject(new DOMException("Aborted", "AbortError"));
              },
              { once: true },
            );
          });
        }
      } catch {
        // Client disconnected or aborted — close stream gracefully
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
