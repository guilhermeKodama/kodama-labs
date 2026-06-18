"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  LEAD_TRANSITIONS,
  type LeadStatusValue,
} from "@/lib/funnel/lead-status";

// Quiet by default — early funnel stays neutral, only the states that signal
// outcome (activated, paying, cold, lost) carry a desaturated status tint.
const STATUS_TONE: Record<LeadStatusValue, string> = {
  NEW: "bg-muted text-muted-foreground",
  ONBOARDING: "bg-muted text-foreground/75",
  QUALIFIED: "bg-muted text-foreground/85",
  ACTIVE: "bg-success/10 text-success",
  CUSTOMER: "bg-success/15 text-success",
  COLD: "bg-warning/10 text-warning",
  LOST: "bg-destructive/10 text-destructive",
};

// Inline status select offering only the transitions the state machine allows
// (the enum + map are imported from the same module the server enforces).
export function LeadStatusSelect({
  leadId,
  status,
}: {
  leadId: string;
  status: LeadStatusValue;
}) {
  const t = useTranslations("leads");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);

  const options = LEAD_TRANSITIONS[status];

  async function onChange(next: string) {
    if (!next || next === status) return;
    setSaving(true);
    const res = await fetch(`/api/v1/leads/${leadId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      toast.error(body?.message ?? t("updateFailed"));
      return;
    }
    toast.success(t("statusUpdated", { status: t(`status.${next}`) }));
    startTransition(() => router.refresh());
  }

  if (options.length === 0) {
    return (
      <span
        className={cn(
          "inline-flex rounded-md px-2 py-0.5 text-xs font-semibold",
          STATUS_TONE[status],
        )}
      >
        {t(`status.${status}`)}
      </span>
    );
  }

  return (
    <select
      value={status}
      disabled={saving || pending}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "rounded-md border-0 px-2 py-0.5 text-xs font-semibold cursor-pointer",
        STATUS_TONE[status],
        (saving || pending) && "opacity-50",
      )}
    >
      <option value={status}>{t(`status.${status}`)}</option>
      {options.map((next) => (
        <option key={next} value={next}>
          → {t(`status.${next}`)}
        </option>
      ))}
    </select>
  );
}
