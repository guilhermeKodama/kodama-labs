"use client";

import { useTheme } from "@/components/theme-provider";
import { Sun, Moon } from "lucide-react";
import { cn } from "@/lib/utils";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

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
