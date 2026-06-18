"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { LogoMark, Wordmark } from "./brand";
import { LanguageSwitcher } from "./language-switcher";
import { NavLinks } from "./nav-links";

const STORAGE_KEY = "pipeline.sidebar.collapsed";
const EVENT = "pipeline:sidebar";

// Reads the collapse preference from localStorage as an external store — no
// setState-in-effect, hydration-safe (server snapshot = expanded).
function useCollapsed(): [boolean, () => void] {
  const collapsed = useSyncExternalStore(
    (cb) => {
      window.addEventListener(EVENT, cb);
      window.addEventListener("storage", cb);
      return () => {
        window.removeEventListener(EVENT, cb);
        window.removeEventListener("storage", cb);
      };
    },
    () => localStorage.getItem(STORAGE_KEY) === "1",
    () => false,
  );
  const toggle = useCallback(() => {
    const next = localStorage.getItem(STORAGE_KEY) === "1" ? "0" : "1";
    localStorage.setItem(STORAGE_KEY, next);
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [collapsed, toggle];
}

export function SidebarNav() {
  const tApp = useTranslations("app");
  const tCommon = useTranslations("common");
  const tNav = useTranslations("nav");
  const [collapsed, toggle] = useCollapsed();

  return (
    <aside
      className={cn(
        "relative hidden md:flex flex-shrink-0 border-r bg-sidebar flex-col",
        "transition-[width] duration-200 ease-out",
        collapsed ? "w-[68px]" : "w-60",
      )}
    >
      <button
        type="button"
        onClick={toggle}
        aria-label={collapsed ? tNav("expand") : tNav("collapse")}
        className={cn(
          "absolute -right-3 top-7 z-10 grid h-6 w-6 place-items-center rounded-full",
          "border bg-card text-muted-foreground shadow-md",
          "hover:text-foreground hover:border-primary/50 transition-colors",
        )}
      >
        {collapsed ? (
          <ChevronsRight className="h-3.5 w-3.5" />
        ) : (
          <ChevronsLeft className="h-3.5 w-3.5" />
        )}
      </button>

      <div className={cn("flex items-center gap-2.5 p-4 pb-6", collapsed && "justify-center px-0")}>
        <LogoMark className="h-7 w-7 shrink-0" />
        {!collapsed ? (
          <div className="min-w-0">
            <Wordmark className="text-lg leading-none" />
            <p className="text-[11px] text-muted-foreground leading-tight mt-0.5 truncate">
              {tApp("tagline")}
            </p>
          </div>
        ) : null}
      </div>

      <NavLinks collapsed={collapsed} />

      <div
        className={cn(
          "p-4 pt-3 border-t mt-auto flex items-center",
          collapsed ? "justify-center" : "justify-between",
        )}
      >
        {!collapsed ? (
          <p className="text-[11px] text-muted-foreground">{tCommon("version")}</p>
        ) : null}
        <LanguageSwitcher />
      </div>
    </aside>
  );
}
