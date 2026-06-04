'use client';

import { useTranslations } from 'next-intl';
import { motion } from 'framer-motion';
import { ArrowUpRight, Github } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { accentClasses, type Project } from '@/lib/projects';
import { cn } from '@/lib/utils';

interface ProjectCardProps {
  project: Project;
  /** Compact variant for pipeline grid; default is full flagship layout. */
  variant?: 'full' | 'compact';
}

export function ProjectCard({ project, variant = 'full' }: ProjectCardProps) {
  const t = useTranslations(`projects.${project.slug}`);
  const tStatus = useTranslations('common.status');
  const tLabels = useTranslations('common.labels');
  const accent = accentClasses[project.accent];

  const challenges =
    variant === 'full' ? (t.raw('challenges') as string[]) : [];

  return (
    <motion.div whileHover={{ y: -4 }} transition={{ duration: 0.25 }}>
      <Card
        className={cn(
          'group relative h-full overflow-hidden transition-all duration-300',
          'border-border/60',
          accent.ring,
          accent.glow
        )}
      >
        {/* Top accent line */}
        <span
          aria-hidden
          className={cn(
            'absolute inset-x-0 top-0 h-px opacity-50 transition-opacity group-hover:opacity-100',
            `bg-gradient-to-r from-transparent via-current to-transparent`,
            accent.text
          )}
        />

        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className={cn('size-1.5 rounded-full', accent.dot)} />
              <Badge variant={project.status}>{tStatus(project.status)}</Badge>
              {project.year ? (
                <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
                  {project.year}
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-1">
              {project.links?.repo && (
                <a
                  href={project.links.repo}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={tLabels('repository')}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Github className="size-4" />
                </a>
              )}
              {project.links?.live && (
                <a
                  href={project.links.live}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={tLabels('liveSite')}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ArrowUpRight className="size-4" />
                </a>
              )}
            </div>
          </div>
          <CardTitle className="text-2xl tracking-tight">{t('name')}</CardTitle>
          <p className={cn('text-sm font-medium', accent.text)}>{t('tagline')}</p>
        </CardHeader>

        <CardContent className="flex flex-col gap-6">
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t('description')}
          </p>

          {variant === 'full' && (
            <div>
              <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
                {tLabels('technicalChallenges')}
              </p>
              <ul className="flex flex-col gap-2.5">
                {challenges.map((challenge, i) => (
                  <li
                    key={i}
                    className="flex gap-3 text-sm leading-relaxed text-foreground/85"
                  >
                    <span
                      className={cn(
                        'mt-2 size-1 shrink-0 rounded-full',
                        accent.dot
                      )}
                    />
                    <span>{challenge}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {variant === 'full' && (
            <div className="rounded-lg border border-border/60 bg-muted/30 p-4">
              <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
                {tLabels('impact')}
              </p>
              <p className="text-sm leading-relaxed text-foreground/90">
                {t('impact')}
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-1.5">
            {project.stack.map((tech) => (
              <Badge key={tech} variant="muted" className="font-mono text-[10px]">
                {tech}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
