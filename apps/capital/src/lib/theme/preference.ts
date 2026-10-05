/** The user's theme setting (User.theme), as next-themes names it. */
export const THEME_PREFERENCES = ["light", "dark", "system"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

/** Validates a stored theme; anything unknown means "leave the theme alone". */
export function parseThemePreference(value: unknown): ThemePreference | null {
  return typeof value === "string" && (THEME_PREFERENCES as readonly string[]).includes(value) ? (value as ThemePreference) : null;
}
