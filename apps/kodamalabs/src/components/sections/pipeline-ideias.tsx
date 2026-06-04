'use client';

import { useTranslations } from 'next-intl';

import { ProjectCard } from '@/components/project-card';
import { FadeInSection } from '@/components/animated/fade-in-section';
import { StaggerList, StaggerItem } from '@/components/animated/stagger-list';
import { Card, CardContent } from '@/components/ui/card';
import { projectsByCategory } from '@/lib/projects';
import { SectionHeader } from './section-header';

const EMPTY_SLOTS = 2;

export function PipelineIdeias() {
  const t = useTranslations('pipeline');
  const ideas = projectsByCategory('pipeline');

  return (
    <section
      id="pipeline"
      className="relative border-t border-border/40 bg-muted/10 px-6 py-32"
    >
      <div className="mx-auto max-w-6xl">
        <FadeInSection>
          <SectionHeader
            eyebrow={t('eyebrow')}
            title={t('title')}
            subtitle={t('subtitle')}
          />
        </FadeInSection>

        <StaggerList
          stagger={0.08}
          className="grid gap-5 md:grid-cols-2 lg:grid-cols-3"
        >
          {ideas.map((project) => (
            <StaggerItem key={project.slug}>
              <ProjectCard project={project} variant="compact" />
            </StaggerItem>
          ))}
          {Array.from({ length: EMPTY_SLOTS }).map((_, i) => (
            <StaggerItem key={`empty-${i}`}>
              <Card className="flex h-full min-h-[260px] items-center justify-center border-dashed border-border/40 bg-transparent shadow-none">
                <CardContent className="flex flex-col items-center gap-2 text-center">
                  <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/60">
                    {t('emptySlot')}
                  </span>
                  <p className="max-w-[180px] text-sm text-muted-foreground/70">
                    {t('emptySlotDescription')}
                  </p>
                </CardContent>
              </Card>
            </StaggerItem>
          ))}
        </StaggerList>

        <FadeInSection delay={0.2}>
          <blockquote className="mx-auto mt-20 max-w-2xl border-l-2 border-violet-400/40 pl-6 text-balance text-lg italic leading-relaxed text-foreground/80">
            “{t('quote')}”
          </blockquote>
        </FadeInSection>
      </div>
    </section>
  );
}
