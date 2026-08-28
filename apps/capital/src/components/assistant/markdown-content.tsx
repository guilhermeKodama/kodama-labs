import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownContentProps {
  text: string;
}

function MarkdownContentImpl({ text }: MarkdownContentProps) {
  return (
    <div className="space-y-3 text-[15px] leading-relaxed text-slate-200 [&_a]:text-emerald-400 [&_a:hover]:text-emerald-300 [&_code]:rounded [&_code]:bg-slate-800 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[13px] [&_li]:ml-4 [&_ol]:list-decimal [&_strong]:font-semibold [&_strong]:text-white [&_ul]:list-disc">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ children }) => (
            <div className="overflow-x-auto rounded-lg border border-slate-800">
              <table className="w-full text-sm">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b border-slate-800 bg-slate-800/50 px-3 py-2 text-left text-xs font-medium text-slate-400">
              {children}
            </th>
          ),
          td: ({ children }) => <td className="border-b border-slate-800/50 px-3 py-2">{children}</td>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

// Re-parses only when the text itself changes - the streaming token
// reducer replaces the whole string each delta, so this still re-renders
// every token, but avoids re-parsing when sibling blocks (tool/card
// updates) change and this text block didn't.
export const MarkdownContent = memo(MarkdownContentImpl, (prev, next) => prev.text === next.text);
