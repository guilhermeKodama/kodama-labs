'use client';

import { useTranslations } from 'next-intl';

import { FadeInSection } from '@/components/animated/fade-in-section';
import { StaggerList, StaggerItem } from '@/components/animated/stagger-list';
import { SectionHeader } from './section-header';

type Principle = { title: string; body: string };

export function Philosophy() {
  const t = useTranslations('philosophy');

  const paragraphs = t.raw('paragraphs') as string[];
  const principles = t.raw('principles') as Principle[];

  return (
    <section id="philosophy" className="relative px-6 py-32">
      <div className="mx-auto max-w-6xl">
        <FadeInSection>
          <SectionHeader eyebrow={t('eyebrow')} title={t('title')} />
        </FadeInSection>

        <div className="grid gap-16 lg:grid-cols-2 lg:gap-24">
          <FadeInSection delay={0.1} className="flex flex-col gap-6">
            {paragraphs.map((p, i) => (
              <p
                key={i}
                className="text-base leading-relaxed text-muted-foreground"
              >
                {p}
              </p>
            ))}
          </FadeInSection>

          <StaggerList stagger={0.1} className="flex flex-col gap-6">
            {principles.map((principle, i) => (
              <StaggerItem
                key={principle.title}
                className="flex gap-4 border-l border-border/60 pl-5 transition-colors hover:border-emerald-400/60"
              >
                <span className="mt-1 font-mono text-xs text-muted-foreground/60">
                  0{i + 1}
                </span>
                <div className="flex flex-col gap-1.5">
                  <h3 className="font-semibold tracking-tight">
                    {principle.title}
                  </h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {principle.body}
                  </p>
                </div>
              </StaggerItem>
            ))}
          </StaggerList>
        </div>
      </div>
    </section>
  );
}
