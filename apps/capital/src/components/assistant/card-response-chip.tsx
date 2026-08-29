import { Check } from 'lucide-react';

interface CardResponseChipProps {
  text: string;
}

export function CardResponseChip({ text }: CardResponseChipProps) {
  return (
    <div className="flex justify-end">
      <div className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">
        <Check className="h-3 w-3" />
        {text}
      </div>
    </div>
  );
}
