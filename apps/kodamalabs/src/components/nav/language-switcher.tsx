'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter, usePathname } from '@/i18n/navigation';
import { Globe } from 'lucide-react';

import { type Locale } from '@/i18n/routing';
import { Button } from '@/components/ui/button';

export function LanguageSwitcher() {
  const t = useTranslations('language');
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();

  const nextLocale: Locale = locale === 'en' ? 'pt-BR' : 'en';

  const handleClick = () => {
    router.replace(pathname, { locale: nextLocale });
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleClick}
      aria-label={`${t('title')}: ${t(nextLocale)}`}
      className="gap-2 text-muted-foreground hover:text-foreground"
    >
      <Globe className="size-4" />
      <span className="font-mono text-xs uppercase tracking-wider">
        {locale === 'en' ? 'EN' : 'PT'}
      </span>
    </Button>
  );
}
