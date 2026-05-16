"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useRouter, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { Languages, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export function LanguageSwitcher() {
  const t = useTranslations("common.languageSwitcher");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  function switchTo(next: string) {
    if (next === locale) {
      setOpen(false);
      return;
    }
    router.replace(pathname, { locale: next as (typeof routing.locales)[number] });
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={t("switchTo")}
        className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <Languages className="h-3.5 w-3.5" />
        <span className="uppercase">{locale === "pt-BR" ? "PT" : "EN"}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 mb-1 z-50 w-40 rounded-md border bg-popover shadow-lg overflow-hidden">
            <div className="p-1">
              {routing.locales.map((loc) => (
                <button
                  key={loc}
                  onClick={() => switchTo(loc)}
                  className={cn(
                    "flex items-center justify-between w-full px-2 py-1.5 text-xs rounded-sm hover:bg-muted transition-colors text-left",
                    loc === locale && "font-medium",
                  )}
                >
                  <span>{t(loc)}</span>
                  {loc === locale && <Check className="h-3 w-3" />}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
