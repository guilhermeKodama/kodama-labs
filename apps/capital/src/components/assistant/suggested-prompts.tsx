'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { FileUp, CreditCard, LineChart } from 'lucide-react';

interface PromptOption {
  icon: typeof FileUp;
  key: 'sendStatement' | 'reconcileCard' | 'importInvestments';
  accept: string;
}

const PROMPTS: PromptOption[] = [
  { icon: FileUp, key: 'sendStatement', accept: '.ofx' },
  { icon: CreditCard, key: 'reconcileCard', accept: '.csv' },
  { icon: LineChart, key: 'importInvestments', accept: '.pdf' },
];

interface SuggestedPromptsProps {
  /** Fires once the user actually picked a file for one of the prompts. */
  onFilePicked: (file: File) => void;
}

// Each shortcut's whole point is "I have a file of this kind" - clicking
// it should open the OS file picker directly (scoped to the relevant
// extension), not just drop text into the composer that still leaves
// attaching the file as a separate manual step.
export function SuggestedPrompts({ onFilePicked }: SuggestedPromptsProps) {
  const t = useTranslations('assistant.prompts');
  const inputRef = useRef<HTMLInputElement>(null);
  const [pendingAccept, setPendingAccept] = useState('.ofx,.csv,.pdf');

  const openPicker = (accept: string) => {
    setPendingAccept(accept);
    // The accept attribute update above only takes effect on next
    // render - defer the click so the input reflects it first.
    requestAnimationFrame(() => inputRef.current?.click());
  };

  return (
    <div className="grid gap-2.5 sm:grid-cols-3">
      <input
        ref={inputRef}
        type="file"
        accept={pendingAccept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFilePicked(file);
          e.target.value = '';
        }}
      />
      {PROMPTS.map(({ icon: Icon, key, accept }) => (
        <button
          key={key}
          type="button"
          onClick={() => openPicker(accept)}
          className="flex items-center gap-2.5 rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3 text-left text-sm text-slate-300 transition-colors hover:border-slate-700 hover:bg-slate-800/50"
        >
          <Icon className="h-4 w-4 flex-shrink-0 text-emerald-400" />
          {t(key)}
        </button>
      ))}
    </div>
  );
}
