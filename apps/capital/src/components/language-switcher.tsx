'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter, usePathname } from '@/i18n/navigation';
import { Globe } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { routing, type Locale } from '@/i18n/routing';
import { cn } from '@/lib/utils';

interface LanguageSwitcherProps {
  compact?: boolean;
}

export function LanguageSwitcher({ compact = false }: LanguageSwitcherProps) {
  const t = useTranslations('language');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  const handleLocaleChange = (newLocale: string) => {
    router.replace(pathname, { locale: newLocale as Locale });
  };

  return (
    <Select value={locale} onValueChange={handleLocaleChange}>
      <SelectTrigger
        className={cn(
          'border-slate-700 bg-slate-800/50 text-slate-300 hover:bg-slate-800 hover:text-white focus:ring-slate-600',
          compact ? 'w-[100px]' : 'w-[180px]'
        )}
      >
        <Globe className="mr-2 h-4 w-4 shrink-0" />
        <SelectValue placeholder={t('title')} />
      </SelectTrigger>
      <SelectContent className="border-slate-700 bg-slate-900">
        {routing.locales.map((loc) => (
          <SelectItem
            key={loc}
            value={loc}
            className="text-slate-300 focus:bg-slate-800 focus:text-white"
          >
            {compact ? loc.split('-')[0].toUpperCase() : t(loc)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
