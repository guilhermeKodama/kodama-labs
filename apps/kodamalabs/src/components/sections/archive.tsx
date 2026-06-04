'use client';

import { useTranslations } from 'next-intl';

import { Card, CardContent } from '@/components/ui/card';
import { FadeInSection } from '@/components/animated/fade-in-section';
import { StaggerList, StaggerItem } from '@/components/animated/stagger-list';
import { archiveProjects } from '@/lib/projects';
import { ProjectCard } from '@/components/project-card';
import { SectionHeader } from './section-header';

const PLACEHOLDER_COUNT = 6;

export function Archive() {
  const t = useTranslations('archive');

  return (
    <section id="archive" className="relative px-6 py-32">
      <div className="mx-auto max-w-6xl">
        <FadeInSection>
          <SectionHeader
            eyebrow={t('eyebrow')}
            title={t('title')}
            subtitle={t('subtitle')}
          />
        </FadeInSection>

        <StaggerList
          stagger={0.05}
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {archiveProjects.length > 0
            ? archiveProjects.map((project) => (
                <StaggerItem key={project.slug}>
                  <ProjectCard project={project} variant="compact" />
                </StaggerItem>
              ))
            : Array.from({ length: PLACEHOLDER_COUNT }).map((_, i) => (
                <StaggerItem key={`placeholder-${i}`}>
                  <Card className="flex h-full min-h-[180px] items-center justify-center border-dashed border-border/40 bg-transparent shadow-none">
                    <CardContent className="flex flex-col items-center gap-1.5 text-center">
                      <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/50">
                        {t('placeholder')}
                      </span>
                      <p className="max-w-[200px] text-xs text-muted-foreground/60">
                        {t('placeholderDescription')}
                      </p>
                    </CardContent>
                  </Card>
                </StaggerItem>
              ))}
        </StaggerList>
      </div>
    </section>
  );
}
