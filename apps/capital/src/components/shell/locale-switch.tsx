"use client";

import { useLocale } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { Globe } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { routing, type Locale } from "@/i18n/routing";

const LABELS: Record<string, string> = { "pt-BR": "Português", en: "English" };

export function LocaleSwitch({ className }: { className?: string }) {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  return (
    <Select value={locale} onValueChange={(next) => router.replace(pathname, { locale: next as Locale })}>
      <SelectTrigger className={className ?? "w-[140px]"}>
        <Globe className="size-4" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {routing.locales.map((code) => (
          <SelectItem key={code} value={code}>
            {LABELS[code] ?? code}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
