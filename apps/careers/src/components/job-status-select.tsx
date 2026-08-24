"use client";

import { useTransition } from "react";
import { updateJobStatus } from "@/server/modules/jobs/actions";
import { STATUS_LABELS } from "@/lib/job-status";
import type { JobStatus } from "@/generated/prisma";
import { cn } from "@/lib/utils";

const OPTIONS: JobStatus[] = ["RADAR", "TRIAGEM", "SHORTLIST", "APLICADA", "ENTREVISTA", "OFERTA", "CONTRATADA", "DESCARTADA"];

export function JobStatusSelect({ jobId, status }: { jobId: string; status: JobStatus }) {
  const [isPending, startTransition] = useTransition();

  return (
    <select
      value={status}
      disabled={isPending}
      onChange={(e) => {
        const next = e.target.value as JobStatus;
        startTransition(() => {
          void updateJobStatus(jobId, next);
        });
      }}
      className={cn(
        "rounded-md border border-border bg-transparent px-2 py-0.5 text-xs text-muted-foreground outline-none",
        isPending && "opacity-50"
      )}
    >
      {OPTIONS.map((opt) => (
        <option key={opt} value={opt} className="bg-popover text-foreground">
          {STATUS_LABELS[opt]}
        </option>
      ))}
    </select>
  );
}
