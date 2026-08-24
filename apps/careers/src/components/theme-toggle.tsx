"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Sun, Moon } from "lucide-react";
import { cn } from "@/lib/utils";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  // Avoid a hydration mismatch: the server has no idea which theme the
  // client will resolve to (next-themes reads localStorage on mount), so
  // render a neutral placeholder until we know.
  if (!mounted) return <div className="h-[30px] w-full rounded-lg bg-muted" />;

  return (
    <div className="flex gap-0.5 rounded-lg border border-border bg-card p-0.5">
      <button
        type="button"
        onClick={() => setTheme("light")}
        className={cn(
          "flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs",
          theme === "light" ? "bg-secondary font-medium text-foreground" : "text-muted-foreground"
        )}
      >
        <Sun className="size-3.5" />
        Claro
      </button>
      <button
        type="button"
        onClick={() => setTheme("dark")}
        className={cn(
          "flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs",
          theme === "dark" ? "bg-secondary font-medium text-foreground" : "text-muted-foreground"
        )}
      >
        <Moon className="size-3.5" />
        Escuro
      </button>
    </div>
  );
}
