"use client";

import { useTranslations } from "next-intl";
import { LanguageSwitcher } from "./language-switcher";
import { NavLinks } from "./nav-links";

export function SidebarNav() {
  const tApp = useTranslations("app");
  const tCommon = useTranslations("common");

  return (
    <aside className="hidden md:flex w-56 flex-shrink-0 border-r bg-card flex-col overflow-y-auto">
      <div className="p-4 pb-6">
        <h1 className="text-lg font-bold tracking-tight">{tApp("name")}</h1>
        <p className="text-[11px] text-muted-foreground leading-tight">
          {tApp("tagline")}
        </p>
      </div>

      <NavLinks />

      <div className="p-4 pt-3 border-t mt-auto flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">{tCommon("version")}</p>
        <LanguageSwitcher />
      </div>
    </aside>
  );
}
