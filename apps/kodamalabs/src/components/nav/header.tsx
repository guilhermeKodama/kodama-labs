'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { motion, useScroll, useTransform } from 'framer-motion';

import { LanguageSwitcher } from './language-switcher';
import { Wordmark } from '@/components/brand/wordmark';

const links = [
  { href: '#philosophy', key: 'philosophy' as const },
  { href: '#products', key: 'products' as const },
  { href: '#pipeline', key: 'pipeline' as const },
  { href: '#archive', key: 'archive' as const },
  { href: '#contact', key: 'contact' as const },
];

export function Header() {
  const t = useTranslations('nav');
  const { scrollY } = useScroll();
  const blur = useTransform(scrollY, [0, 80], [0, 12]);
  const opacity = useTransform(scrollY, [0, 80], [0, 1]);

  return (
    <motion.header
      style={{
        backdropFilter: blur.get() > 0 ? `blur(${blur.get()}px)` : undefined,
      }}
      className="fixed inset-x-0 top-0 z-50"
    >
      <motion.div
        style={{ opacity }}
        className="absolute inset-0 border-b border-border/40 bg-background/60 backdrop-blur-md"
        aria-hidden
      />
      <nav className="relative mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <a href="#top" aria-label="Kodama Labs — home">
          <Wordmark />
        </a>

        <div className="hidden items-center gap-7 md:flex">
          {links.map((link) => (
            <a
              key={link.key}
              href={link.href}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {t(link.key)}
            </a>
          ))}
        </div>

        <LanguageSwitcher />
      </nav>
    </motion.header>
  );
}
