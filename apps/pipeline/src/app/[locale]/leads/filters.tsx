"use client";

import { parseAsString, useQueryState } from "nuqs";
import { useTranslations } from "next-intl";
import { LEAD_STATUSES } from "@/lib/funnel/lead-status";
import { Input } from "@/components/ui/input";

export function LeadFilters({ ideas }: { ideas: Array<{ slug: string; name: string }> }) {
  const t = useTranslations("leads");
  const opts = { shallow: false } as const;
  const [idea, setIdea] = useQueryState("idea", parseAsString.withDefault("").withOptions(opts));
  const [status, setStatus] = useQueryState("status", parseAsString.withDefault("").withOptions(opts));
  const [search, setSearch] = useQueryState("q", parseAsString.withDefault("").withOptions(opts));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={idea}
        onChange={(e) => setIdea(e.target.value || null)}
        className="rounded-md border bg-card px-2 py-1.5 text-xs"
      >
        <option value="">{t("filters.allIdeas")}</option>
        {ideas.map((i) => (
          <option key={i.slug} value={i.slug}>
            {i.name}
          </option>
        ))}
      </select>

      <select
        value={status}
        onChange={(e) => setStatus(e.target.value || null)}
        className="rounded-md border bg-card px-2 py-1.5 text-xs"
      >
        <option value="">{t("filters.allStatuses")}</option>
        {LEAD_STATUSES.map((s) => (
          <option key={s} value={s}>
            {t(`status.${s}`)}
          </option>
        ))}
      </select>

      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value || null)}
        placeholder={t("filters.searchPlaceholder")}
        className="h-8 w-56 text-xs"
      />
    </div>
  );
}
