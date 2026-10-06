/** A whole local hour as Ajustes writes it: "09:00" (pt-BR), "9:00 AM" (en). */
export function hourLabel(hour: number, locale: string): string {
  const h = ((Math.trunc(hour) % 24) + 24) % 24;
  if (locale.startsWith("en")) return `${h % 12 || 12}:00 ${h < 12 ? "AM" : "PM"}`;
  return `${String(h).padStart(2, "0")}:00`;
}
