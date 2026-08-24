"use client";

import { useTransition } from "react";
import { updateJobInterest } from "@/server/modules/jobs/actions";
import { cn } from "@/lib/utils";

export function JobInterestPicker({ jobId, interest }: { jobId: string; interest: number }) {
  const [isPending, startTransition] = useTransition();

  return (
    <div className={cn("flex items-center gap-2", isPending && "opacity-50")}>
      <div className="h-1 w-7 overflow-hidden rounded-full bg-secondary">
        <div className="h-1 bg-primary" style={{ width: `${interest * 20}%` }} />
      </div>
      <div className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            title={`Marcar interesse ${n}`}
            onClick={() => startTransition(() => void updateJobInterest(jobId, n))}
            className={cn("size-1.5 rounded-full", n <= interest ? "bg-primary" : "bg-secondary")}
          />
        ))}
      </div>
    </div>
  );
}
