"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// API-failure insurance: hand-typed daily numbers from the ads panels.
// Re-submitting the same idea/channel/day edits it (server upserts).
export function ManualSpendForm({ ideas }: { ideas: Array<{ slug: string; name: string }> }) {
  const t = useTranslations("ops.manual");
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setSubmitting(true);

    const res = await fetch("/api/v1/ad-spend/manual", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ideaSlug: data.get("ideaSlug"),
        channel: data.get("channel"),
        date: data.get("date"),
        spend: Number(data.get("spend")),
        impressions: Number(data.get("impressions")),
        clicks: Number(data.get("clicks")),
      }),
    });
    setSubmitting(false);

    if (!res.ok) {
      toast.error(t("failed"));
      return;
    }
    const body = (await res.json()) as { overlapsApi: boolean };
    if (body.overlapsApi) {
      toast.warning(t("overlapWarning"));
    } else {
      toast.success(t("saved"));
    }
    form.reset();
    startTransition(() => router.refresh());
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-2 sm:grid-cols-6 items-end">
      <label className="text-xs space-y-1 sm:col-span-2">
        <span className="text-muted-foreground">{t("idea")}</span>
        <select name="ideaSlug" required className="w-full rounded-md border bg-card px-2 py-1.5 text-xs">
          {ideas.map((i) => (
            <option key={i.slug} value={i.slug}>
              {i.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs space-y-1">
        <span className="text-muted-foreground">{t("channel")}</span>
        <select name="channel" required className="w-full rounded-md border bg-card px-2 py-1.5 text-xs">
          <option value="META">Meta</option>
          <option value="GOOGLE">Google</option>
        </select>
      </label>
      <label className="text-xs space-y-1">
        <span className="text-muted-foreground">{t("date")}</span>
        <Input name="date" type="date" required className="h-8 text-xs" />
      </label>
      <label className="text-xs space-y-1">
        <span className="text-muted-foreground">{t("spend")}</span>
        <Input name="spend" type="number" step="0.01" min="0" required className="h-8 text-xs" />
      </label>
      <label className="text-xs space-y-1">
        <span className="text-muted-foreground">{t("impressions")}</span>
        <Input name="impressions" type="number" min="0" required className="h-8 text-xs" />
      </label>
      <label className="text-xs space-y-1">
        <span className="text-muted-foreground">{t("clicks")}</span>
        <Input name="clicks" type="number" min="0" required className="h-8 text-xs" />
      </label>
      <Button type="submit" size="sm" disabled={submitting} className="sm:col-span-6 sm:w-fit">
        {submitting ? t("saving") : t("save")}
      </Button>
    </form>
  );
}
