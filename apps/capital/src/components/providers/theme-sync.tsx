"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";
import { useSession } from "@/lib/api/session";
import { parseThemePreference } from "@/lib/theme/preference";
import { TextSizeSync } from "./text-size-sync";

/**
 * Applies the signed-in user's theme (Ajustes → Aparência) once the session
 * loads and whenever it changes. next-themes keeps the last applied value in
 * localStorage, so later visits start in the right theme before /me answers.
 * The text size, the other display preference applied to the document,
 * comes with it (TextSizeSync).
 */
export function ThemeSync() {
  const session = useSession();
  const { setTheme } = useTheme();
  const preference = parseThemePreference(session.data?.theme);

  useEffect(() => {
    if (preference) setTheme(preference);
  }, [preference, setTheme]);

  return <TextSizeSync />;
}
