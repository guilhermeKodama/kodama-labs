"use client";

import { useQueryState, parseAsStringLiteral, parseAsString } from "nuqs";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

const CHANNELS = ["all", "meta", "google"] as const;
const PRESETS = [7, 14, 30] as const;

// defaultTo is "today" in the idea's timezone — presets are computed off it so
// the date math stays in the idea's calendar, never the browser's.
function shiftDay(isoDay: string, deltaDays: number): string {
  const d = new Date(`${isoDay}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

// shallow: false → the server component re-aggregates on every change
// (sentinel's URL-driven listing pattern).
export function FunnelControls({
  defaultFrom,
  defaultTo,
}: {
  defaultFrom: string;
  defaultTo: string;
}) {
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

  const presetRange = (days: number) => ({
    from: shiftDay(defaultTo, -(days - 1)),
    to: defaultTo,
  });
  const activePreset = PRESETS.find((d) => {
    const r = presetRange(d);
    return from === r.from && to === r.to;
  });
  const isCustom = activePreset === undefined;

  const applyPreset = (days: number) => {
    const r = presetRange(days);
    void setFrom(r.from);
    void setTo(r.to);
  };
  // Custom seeds the full default range (since launch) and reveals the calendar.
  const applyCustom = () => {
    void setFrom(defaultFrom);
    void setTo(defaultTo);
  };

  const segBtn = (active: boolean) =>
    cn(
      "px-3 py-1 text-xs font-medium rounded-[5px] transition-colors",
      active
        ? "bg-primary text-primary-foreground"
        : "text-muted-foreground hover:text-foreground",
    );

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* channel */}
      <div className="inline-flex rounded-md border bg-card p-0.5">
        {CHANNELS.map((c) => (
          <button key={c} type="button" onClick={() => setChannel(c)} className={segBtn(channel === c)}>
            {t(`channels.${c}`)}
          </button>
        ))}
      </div>

      {/* period: presets + custom */}
      <div className="inline-flex rounded-md border bg-card p-0.5">
        {PRESETS.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => applyPreset(d)}
            className={segBtn(activePreset === d)}
          >
            {t("period.days", { count: d })}
          </button>
        ))}
        <button type="button" onClick={applyCustom} className={segBtn(isCustom)}>
          {t("period.custom")}
        </button>
      </div>

      {/* calendar — only while a non-preset (custom) range is active */}
      {isCustom && (
        <div className="flex items-center gap-1.5 text-xs">
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value || defaultFrom)}
            className="rounded-md border bg-card px-2 py-1 text-xs"
          />
          <span className="text-muted-foreground">→</span>
          <input
            type="date"
            value={to}
            min={from}
            max={defaultTo}
            onChange={(e) => setTo(e.target.value || defaultTo)}
            className="rounded-md border bg-card px-2 py-1 text-xs"
          />
        </div>
      )}
    </div>
  );
}
