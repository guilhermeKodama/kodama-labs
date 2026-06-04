'use client';

import { useTranslations } from 'next-intl';
import { motion } from 'framer-motion';
import { ArrowDown } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { GradientMesh } from '@/components/animated/gradient-mesh';
import { LogoMark } from '@/components/brand/logo-mark';

export function Hero() {
  const t = useTranslations('hero');
  const tLabels = useTranslations('common.labels');

  return (
    <section
      id="top"
      className="relative flex min-h-[100svh] items-center justify-center overflow-hidden px-6 pt-24"
    >
      <GradientMesh />

      {/* Watermark — the brand mark drifts behind the title. Decorative. */}
      <motion.div
        aria-hidden
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 0.06, scale: 1, rotate: [0, 360] }}
        transition={{
          opacity: { duration: 1.4, delay: 0.2 },
          scale: { duration: 1.4, delay: 0.2 },
          rotate: { duration: 120, repeat: Infinity, ease: 'linear' },
        }}
        className="pointer-events-none absolute left-1/2 top-1/2 -z-0 -translate-x-1/2 -translate-y-1/2"
      >
        <LogoMark size={520} className="text-emerald-300" />
      </motion.div>

      <div className="relative z-10 mx-auto flex max-w-4xl flex-col items-center text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="mb-8 inline-flex items-center gap-3 rounded-full border border-emerald-400/20 bg-background/50 px-4 py-1.5 backdrop-blur-sm"
        >
          <span
            style={{
              filter: 'drop-shadow(0 0 6px oklch(0.7 0.18 160 / 0.6))',
            }}
            className="inline-flex"
          >
            <LogoMark size={20} />
          </span>
          <span className="font-mono text-[11px] uppercase tracking-widest text-foreground/85">
            {t('tag')}
          </span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
          className="text-balance bg-gradient-to-b from-foreground via-foreground to-foreground/60 bg-clip-text text-5xl font-bold leading-[0.95] tracking-tight text-transparent sm:text-6xl md:text-7xl lg:text-8xl"
        >
          {t('title')}
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay: 0.3 }}
          className="mt-6 max-w-2xl text-balance text-base leading-relaxed text-muted-foreground sm:text-lg"
        >
          {t('subtitle')}
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay: 0.5 }}
          className="mt-10 flex flex-col items-center gap-3 sm:flex-row"
        >
          <Button asChild size="lg" variant="glow">
            <a href="#products">
              {t('cta')}
              <ArrowDown className="size-4" />
            </a>
          </Button>
          <Button asChild size="lg" variant="outline">
            <a href="#philosophy">{t('secondaryCta')}</a>
          </Button>
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 1 }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2"
      >
        <motion.div
          animate={{ y: [0, 8, 0] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          className="flex flex-col items-center gap-2 text-muted-foreground/60"
        >
          <span className="font-mono text-[10px] uppercase tracking-widest">
            {tLabels('scrollHint')}
          </span>
          <div className="h-8 w-px bg-gradient-to-b from-muted-foreground/60 to-transparent" />
        </motion.div>
      </motion.div>
    </section>
  );
}
