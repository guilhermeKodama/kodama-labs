/**
 * Ajustes navigation (mockup SETTINGS_NAV): sections and page keys, in
 * order. Titles and descriptions are messages settings.nav.<key>.{title,desc}
 * and settings.sections.<section>. ⌘K lists the same pages, linking with
 * settingsHref.
 */
export const SETTINGS_SECTIONS = [
  { section: "account", pages: ["prefs", "notif"] },
  { section: "finance", pages: ["ent", "bank", "card", "broker", "cat", "rules", "fx"] },
  { section: "data", pages: ["imports", "api"] },
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]["section"];
export type SettingsPage = (typeof SETTINGS_SECTIONS)[number]["pages"][number];

export const SETTINGS_PAGES: readonly SettingsPage[] = SETTINGS_SECTIONS.flatMap((s) => s.pages);

export const DEFAULT_SETTINGS_PAGE: SettingsPage = "prefs";

/** The page a ?page= value names; anything else (a removed page like "trash", a typo) opens the default. */
export function resolveSettingsPage(value: string | null | undefined): SettingsPage {
  return (SETTINGS_PAGES as readonly string[]).includes(value ?? "") ? (value as SettingsPage) : DEFAULT_SETTINGS_PAGE;
}

/** "/settings?page=cat", with `id` selecting a row of a list page ("/settings?page=card&id=…"). */
export function settingsHref(page: SettingsPage, id?: string | null): string {
  const params = new URLSearchParams({ page });
  if (id) params.set("id", id);
  return `/settings?${params.toString()}`;
}
