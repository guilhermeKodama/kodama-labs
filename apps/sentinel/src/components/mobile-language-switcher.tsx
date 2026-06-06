"use client";

import { useLocale, useTranslations } from "next-intl";
import { Languages } from "lucide-react";
import { useRouter, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { cn } from "@/lib/utils";

const LABELS: Record<(typeof routing.locales)[number], string> = {
  "pt-BR": "PT",
  en: "EN",
};

export function MobileLanguageSwitcher() {
  const t = useTranslations("common.languageSwitcher");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  function switchTo(next: (typeof routing.locales)[number]) {
    if (next === locale) return;
    router.replace(pathname, { locale: next });
  }

  return (
    <div className="flex items-center gap-2 w-full">
      <span
        className="flex items-center gap-1.5 text-xs text-muted-foreground flex-shrink-0"
        aria-label={t("label")}
      >
        <Languages className="h-3.5 w-3.5" />
        {t("label")}
      </span>
      <div className="ml-auto inline-flex rounded-md border bg-background p-0.5">
        {routing.locales.map((loc) => {
          const isActive = loc === locale;
          return (
            <button
              key={loc}
              type="button"
              onClick={() => switchTo(loc)}
              aria-pressed={isActive}
              className={cn(
                "px-2.5 py-1 text-[11px] font-medium rounded transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {LABELS[loc]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
