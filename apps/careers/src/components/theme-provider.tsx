"use client";

import * as React from "react";

export type Theme = "light" | "dark";

const THEME_COOKIE = "careers_theme";

const ThemeContext = React.createContext<{ theme: Theme; setTheme: (theme: Theme) => void } | null>(null);

// Replaces next-themes: that library injects its FOUC-prevention snippet as
// a raw <script> element via React.createElement, which a recent React
// 19.2.x release now flags with "Encountered a script tag while rendering
// React component" (a real, currently-unpatched next-themes/React
// incompatibility, not a hydration-mismatch false alarm). This avoids the
// problem at the root: the theme is resolved server-side from a cookie
// (same pattern the sidebar's collapsed state already uses) and applied
// directly to the server-rendered <html> class, so there's no FOUC and
// no script tag needed at all — client and server always agree on the
// first paint.
export function ThemeProvider({ children, initialTheme }: { children: React.ReactNode; initialTheme: Theme }) {
  const [theme, setThemeState] = React.useState<Theme>(initialTheme);

  const setTheme = React.useCallback((next: Theme) => {
    setThemeState(next);
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.classList.add(next);
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  }, []);

  const value = React.useMemo(() => ({ theme, setTheme }), [theme, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
