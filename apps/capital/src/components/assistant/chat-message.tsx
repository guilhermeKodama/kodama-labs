import { Sparkles } from 'lucide-react';
import type { ChatMessage as ChatMessageData } from '@/types/assistant';
import { MarkdownContent } from './markdown-content';
import { ToolActivity } from './tool-activity';
import { CardResponseChip } from './card-response-chip';
import { MessageAttachments } from './message-attachments';
import { ImportPlanCard } from './action-cards/import-plan-card';
import { DuplicateReviewCard } from './action-cards/duplicate-review-card';
import { PlanResultCard } from './action-cards/plan-result-card';

interface ChatMessageProps {
  conversationId: string;
  message: ChatMessageData;
}

export function ChatMessage({ conversationId, message }: ChatMessageProps) {
  if (message.role === 'user') {
    const block = message.blocks[0];
    if (block?.kind === 'card_response') {
      return <CardResponseChip text={block.text} />;
    }
    const text = block?.kind === 'text' ? block.text : '';
    const attachments = message.blocks.find((b) => b.kind === 'attachments');
    return (
      <div
        className="flex flex-col items-end"
        style={{ opacity: message.status === 'sending' ? 0.6 : 1 }}
      >
        {text && (
          <div className="max-w-[520px] rounded-2xl bg-slate-800 px-4 py-3 text-[14px] text-slate-100">
            {text}
          </div>
        )}
        {attachments && <MessageAttachments files={attachments.files} />}
      </div>
    );
  }

  return (
    <div className="flex max-w-2xl gap-3.5">
      <div className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-cyan-500">
        <Sparkles className="h-4 w-4 text-white" />
      </div>
      <div className="min-w-0 flex-1 space-y-3.5">
        {message.blocks.length === 0 && message.status === 'streaming' && (
          <span className="inline-block h-[17px] w-2 animate-pulse bg-emerald-400 align-middle" />
        )}
        {message.blocks.map((block, i) => {
          switch (block.kind) {
            case 'text':
              return <MarkdownContent key={i} text={block.text} />;
            case 'tool':
              return (
                <ToolActivity
                  key={block.toolCallId}
                  tool={block.tool}
                  label={block.label}
                  status={block.status}
                  summary={block.summary}
                />
              );
            case 'plan':
              return (
                <ImportPlanCard
                  key={i}
                  conversationId={conversationId}
                  planId={block.planId}
                  planKind={block.planKind}
                  summary={block.summary}
                  payloadHash={block.payloadHash}
                  warnings={block.warnings}
                  status={block.status}
                />
              );
            case 'plan_result':
              return <PlanResultCard key={i} conversationId={conversationId} result={block.result} />;
            case 'card':
              return <DuplicateReviewCard key={block.card.cardId || i} conversationId={conversationId} card={block.card} />;
            default:
              return null;
          }
        })}
      </div>
    </div>
  );
}
