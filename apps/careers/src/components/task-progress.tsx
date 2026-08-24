"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { getPipelineStatus, type PipelineStatus } from "@/server/modules/ml/queries";
import type { TaskType } from "@/server/jobs/queue";

const POLL_MS = 3000;

/**
 * Small live badge for background work triggered by a button click
 * (rescore-all, train-model, distill-rules) — without this, clicking one of
 * those buttons gives no feedback at all until the user manually refreshes,
 * which reads as "did that even do anything?"
 */
export function TaskProgress({ types, label }: { types: TaskType[]; label: string }) {
  const router = useRouter();
  const [status, setStatus] = React.useState<PipelineStatus | null>(null);
  const wasPending = React.useRef(false);

  React.useEffect(() => {
    let cancelled = false;

    async function poll() {
      const next = await getPipelineStatus(types);
      if (cancelled) return;
      setStatus(next);
      if (next.pending > 0) {
        wasPending.current = true;
      } else if (wasPending.current) {
        // just finished — refresh the page's server data (new scores, model, proposals...)
        wasPending.current = false;
        router.refresh();
      }
    }

    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `types` is a literal array from the caller, re-subscribing per render would just restart the same poll
  }, [router]);

  if (!status || status.pending === 0) return null;

  return (
    <div className="flex items-center gap-1.5 rounded-lg bg-secondary px-2.5 py-1.5 text-xs text-secondary-foreground">
      <Loader2 className="size-3.5 animate-spin" />
      {label} — {status.running > 0 ? `${status.running} rodando` : `${status.pending} na fila`}
    </div>
  );
}
