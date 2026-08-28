import { Loader2, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ToolActivityProps {
  label?: string;
  tool: string;
  status: 'running' | 'success' | 'error';
  summary?: string;
}

export function ToolActivity({ label, tool, status, summary }: ToolActivityProps) {
  return (
    <div className="flex items-center gap-2.5 text-[13px]">
      {status === 'running' && <Loader2 className="h-[15px] w-[15px] flex-shrink-0 animate-spin text-slate-500" />}
      {status === 'success' && <Check className="h-[15px] w-[15px] flex-shrink-0 text-emerald-400" />}
      {status === 'error' && <X className="h-[15px] w-[15px] flex-shrink-0 text-red-400" />}
      <span className={cn(status === 'running' ? 'text-slate-400' : 'text-slate-500')}>
        {summary ?? label ?? tool}
      </span>
    </div>
  );
}
