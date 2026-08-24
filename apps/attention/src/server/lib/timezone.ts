const TZ = "America/Sao_Paulo";

// Derives the offset via Intl instead of hardcoding "-03:00" — SP has had a
// fixed offset since the 2019 DST repeal, but this stays correct if that
// ever changes again, with zero extra dependency.
function spDateAndOffset(reference: Date): { ymd: string; offset: string } {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(reference);

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    timeZoneName: "longOffset",
  }).formatToParts(reference);
  const offsetPart = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-03:00";
  const offset = offsetPart.replace("GMT", "");

  return { ymd, offset };
}

// The instant "HH:mm" occurs on reference's calendar day in America/Sao_Paulo.
export function spWindowInstant(hhmm: string, reference: Date = new Date()): Date {
  const { ymd, offset } = spDateAndOffset(reference);
  return new Date(`${ymd}T${hhmm}:00${offset}`);
}

export function spTodayStart(reference: Date = new Date()): Date {
  return spWindowInstant("00:00", reference);
}

export function spTomorrowAt(hhmm: string, reference: Date = new Date()): Date {
  const shifted = new Date(reference.getTime() + 24 * 60 * 60 * 1000);
  return spWindowInstant(hhmm, shifted);
}
