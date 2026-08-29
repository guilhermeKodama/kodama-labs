import { cn } from '@/lib/utils';
import type { DuplicateConfidence } from '@/types/assistant';

const STYLES: Record<DuplicateConfidence, string> = {
  high: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  medium: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  low: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
};

interface ConfidenceBadgeProps {
  confidence: DuplicateConfidence;
  label: string;
}

export function ConfidenceBadge({ confidence, label }: ConfidenceBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
        STYLES[confidence]
      )}
    >
      {label}
    </span>
  );
}
