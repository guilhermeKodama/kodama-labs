'use client';

import { useTranslations } from 'next-intl';

import { Wordmark } from '@/components/brand/wordmark';

export function Footer() {
  const t = useTranslations('footer');
  const year = 2026;

  return (
    <footer className="border-t border-border/40 px-6 py-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 sm:flex-row">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Wordmark size={18} />
          <span className="text-muted-foreground/60">·</span>
          <span>© {year}</span>
        </div>
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/60">
          {t('builtWith')}
        </p>
      </div>
    </footer>
  );
}
