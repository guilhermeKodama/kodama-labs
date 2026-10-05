"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";
import { useSession } from "@/lib/session";
import { parseThemePreference } from "@/lib/theme/preference";

/**
 * Applies the signed-in user's theme (Ajustes → Aparência) once the session
 * loads and whenever it changes. next-themes keeps the last applied value in
 * localStorage, so later visits start in the right theme before /me answers.
 */
export function ThemeSync() {
  const session = useSession();
  const { setTheme } = useTheme();
  const preference = parseThemePreference(session.data?.theme);

  useEffect(() => {
    if (preference) setTheme(preference);
  }, [preference, setTheme]);

  return null;
}
