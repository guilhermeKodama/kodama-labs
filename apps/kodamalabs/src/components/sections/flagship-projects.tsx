'use client';

import { useTranslations } from 'next-intl';

import { ProjectCard } from '@/components/project-card';
import { FadeInSection } from '@/components/animated/fade-in-section';
import { StaggerList, StaggerItem } from '@/components/animated/stagger-list';
import { projectsByCategory } from '@/lib/projects';
import { SectionHeader } from './section-header';

export function FlagshipProjects() {
  const t = useTranslations('flagship');
  const flagship = projectsByCategory('flagship');

  return (
    <section id="products" className="relative px-6 py-32">
      <div className="mx-auto max-w-6xl">
        <FadeInSection>
          <SectionHeader
            eyebrow={t('eyebrow')}
            title={t('title')}
            subtitle={t('subtitle')}
          />
        </FadeInSection>

        <StaggerList stagger={0.12} className="grid gap-6 md:grid-cols-2">
          {flagship.map((project) => (
            <StaggerItem key={project.slug}>
              <ProjectCard project={project} />
            </StaggerItem>
          ))}
        </StaggerList>
      </div>
    </section>
  );
}
