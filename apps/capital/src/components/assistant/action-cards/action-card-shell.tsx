import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface ActionCardShellProps {
  icon: ReactNode;
  title: string;
  eyebrow?: string;
  locked?: boolean;
  footer?: ReactNode;
  children: ReactNode;
}

export function ActionCardShell({ icon, title, eyebrow, locked, footer, children }: ActionCardShellProps) {
  return (
    <div
      className={cn(
        'w-full max-w-xl overflow-hidden rounded-2xl border bg-slate-900/60',
        locked ? 'border-slate-800' : 'border-emerald-500/25 shadow-[0_0_0_1px_rgba(16,185,129,0.06)]'
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <span className="text-emerald-400">{icon}</span>
          <h3 className="text-[15px] font-semibold text-white">{title}</h3>
        </div>
        {eyebrow && <span className="mono text-[11px] text-slate-500">{eyebrow}</span>}
      </div>
      <div className="px-5 py-4">{children}</div>
      {footer && <div className="border-t border-slate-800 bg-slate-950/40 px-5 py-3.5">{footer}</div>}
    </div>
  );
}
