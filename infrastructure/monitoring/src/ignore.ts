export const DEFAULT_IGNORE_SOURCES: readonly string[] = [
  // Prisma logs the error even though send-due-reminders catches P2002.
  "reminderDispatch\\.create\\([\\s\\S]{0,800}Unique constraint failed",
  "Unique constraint failed on the fields: \\(`recurringTransactionId`",
  // The push monitor already reports a failed cron. Don't page twice.
  "\\[Cron\\] \\[.*?\\] .* failed with status ",
];

export function compileIgnore(extraSources: readonly string[] = []): RegExp[] {
  const sources = [...DEFAULT_IGNORE_SOURCES, ...extraSources];
  return sources.map((source) => new RegExp(source, "i"));
}

export function ignoreSourcesFromEnv(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

export function isIgnored(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}
