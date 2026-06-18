"use client";

import { useQueryState, parseAsStringLiteral, parseAsString } from "nuqs";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

const CHANNELS = ["all", "meta", "google"] as const;

// shallow: false → the server component re-aggregates on every change
// (sentinel's URL-driven listing pattern).
export function FunnelControls({ defaultFrom, defaultTo }: { defaultFrom: string; defaultTo: string }) {
  const t = useTranslations("idea");
  const [channel, setChannel] = useQueryState(
    "channel",
    parseAsStringLiteral(CHANNELS).withDefault("all").withOptions({ shallow: false }),
  );
  const [from, setFrom] = useQueryState(
    "from",
    parseAsString.withDefault(defaultFrom).withOptions({ shallow: false }),
  );
  const [to, setTo] = useQueryState(
    "to",
    parseAsString.withDefault(defaultTo).withOptions({ shallow: false }),
  );

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="inline-flex rounded-md border bg-card p-0.5">
        {CHANNELS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setChannel(c)}
            className={cn(
              "px-3 py-1 text-xs font-medium rounded-[5px] transition-colors",
              channel === c
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(`channels.${c}`)}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1.5 text-xs">
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value || defaultFrom)}
          className="rounded-md border bg-card px-2 py-1 text-xs"
        />
        <span className="text-muted-foreground">→</span>
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value || defaultTo)}
          className="rounded-md border bg-card px-2 py-1 text-xs"
        />
      </div>
    </div>
  );
}
