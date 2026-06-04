import { cn } from '@/lib/utils';

interface SectionHeaderProps {
  eyebrow: string;
  title: string;
  subtitle?: string;
  className?: string;
}

export function SectionHeader({
  eyebrow,
  title,
  subtitle,
  className,
}: SectionHeaderProps) {
  return (
    <div className={cn('mb-12 flex flex-col gap-3', className)}>
      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        — {eyebrow}
      </span>
      <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
        {title}
      </h2>
      {subtitle ? (
        <p className="max-w-2xl text-balance text-base leading-relaxed text-muted-foreground">
          {subtitle}
        </p>
      ) : null}
    </div>
  );
}
