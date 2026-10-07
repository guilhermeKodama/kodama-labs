"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Paperclip } from "lucide-react";
import { Btn, Callout, Popover, PopoverClose } from "@/components/cap";
import { ApiError } from "@/lib/api/client";
import { keys } from "@/lib/api/keys";
import { useErrorMessage } from "@/lib/api/use-app-mutation";
import { listConversations } from "@/lib/assistant/api";
import { ASSISTANT_FILE_ACCEPT } from "@/lib/assistant/constants";
import { isTurnLimit, type AssistantError } from "@/lib/assistant/reducer";
import { useFmt } from "@/lib/format/provider";
import { cn } from "@/lib/utils";
import { Thread } from "./thread";
import type { AssistantController } from "./use-assistant";

/**
 * The assistant inside ⌘K: header (← Voltar, conversations, Nova
 * conversa), the thread and the composer (text, files by button, paste or
 * drop; Enviar or Parar).
 */
export function AssistantPanel({ controller, onBack, onNavigate }: { controller: AssistantController; onBack: () => void; onNavigate: () => void }) {
  const t = useTranslations("assistant");
  const { state } = controller;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  // Reopens this browser's last conversation the first time the assistant shows.
  const { resume } = controller;
  useEffect(() => resume(), [resume]);

  // Follows the reply as it streams.
  const lastBlocks = state.messages.at(-1)?.blocks;
  const lastSize = lastBlocks?.reduce((size, block) => size + (block.kind === "text" ? block.text.length : 1), 0) ?? 0;
  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [state.messages.length, lastSize, state.error, controller.uploading]);

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length) controller.addFiles(Array.from(event.dataTransfer.files));
  };

  const last = state.messages.at(-1);
  const thinking = controller.preparing || (controller.busy && (!last || last.role === "user" || last.blocks.length === 0));

  return (
    <div
      className="relative flex h-[min(560px,calc(100dvh-56px))] flex-col"
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setDragging(false);
      }}
      onDrop={onDrop}
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-stroke-3 px-2.5">
        <Btn ghost onClick={onBack}>
          {t("back")}
        </Btn>
        <DialogPrimitive.Title className="text-body-lg font-semibold">{t("title")}</DialogPrimitive.Title>
        {state.title ? <span className="min-w-0 truncate text-body-sm text-fg-3">· {state.title}</span> : null}
        <span className="flex-1" />
        <Conversations controller={controller} />
        <Btn ghost disabled={controller.busy || (!state.conversationId && !state.messages.length)} onClick={controller.newConversation}>
          {t("newConversation")}
        </Btn>
      </div>

      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3.5 py-3">
        {controller.loading ? <span className="text-body-sm text-fg-3">{t("status.loading")}</span> : null}
        {!controller.loading && !state.messages.length && !state.error ? (
          <div className="flex flex-col gap-1 pt-6 text-center">
            <span className="text-body-lg font-semibold">{t("empty.title")}</span>
            <span className="mx-auto max-w-[420px] text-body-sm text-fg-3">{t("empty.hint")}</span>
          </div>
        ) : null}
        <Thread controller={controller} onNavigate={onNavigate} />
        {controller.uploading ? <Status text={t("status.uploading")} /> : thinking ? <Status text={t("status.thinking")} /> : null}
        {!controller.busy && state.lastTurn === "cancelled" ? <span className="text-label text-fg-3">{t("status.stopped")}</span> : null}
        {state.error ? <ErrorNotice error={state.error} canRetry={controller.canRetry} onRetry={controller.retry} /> : null}
      </div>

      <Composer controller={controller} />

      {dragging ? (
        <div className="pointer-events-none absolute inset-1 flex items-center justify-center rounded-[10px] border border-dashed border-stroke-1 bg-editor/90 text-body text-fg-2">
          {t("composer.drop")}
        </div>
      ) : null}
    </div>
  );
}

function Status({ text }: { text: string }) {
  return (
    <span className="animate-pulse text-label text-fg-3" aria-live="polite">
      {text}
    </span>
  );
}

function ErrorNotice({ error, canRetry, onRetry }: { error: AssistantError; canRetry: boolean; onRetry: () => void }) {
  const t = useTranslations("assistant");
  const errorText = useErrorMessage();
  const limit = isTurnLimit(error);
  const text =
    error.kind === "request"
      ? errorText(new ApiError({ status: error.status, code: error.code, params: error.params, message: "" }))
      : t(limit ? "errors.turnLimit" : "errors.turnFailed");
  return (
    <Callout tone={limit ? "warning" : "danger"}>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1">{text}</span>
        {canRetry ? (
          <Btn className="bg-editor" onClick={onRetry}>
            {t("errors.retry")}
          </Btn>
        ) : null}
      </div>
    </Callout>
  );
}

/** The recent conversations, to reopen one. */
function Conversations({ controller }: { controller: AssistantController }) {
  const t = useTranslations("assistant");
  const fmt = useFmt();
  const [open, setOpen] = useState(false);
  const list = useQuery({ queryKey: keys.assistantConversations(), queryFn: () => listConversations(20), enabled: open });
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      width={300}
      trigger={
        <Btn ghost disabled={controller.busy}>
          {t("conversations")}
        </Btn>
      }
    >
      {list.isPending ? <span className="px-1 text-body-sm text-fg-3">{t("status.loading")}</span> : null}
      {list.isError ? <span className="px-1 text-body-sm text-neg">{t("errors.listFailed")}</span> : null}
      {list.data && !list.data.length ? <span className="px-1 text-body-sm text-fg-3">{t("noConversations")}</span> : null}
      {list.data?.length ? (
        <div className="-m-1 flex flex-col">
          {list.data.map((conversation) => (
            <PopoverClose key={conversation.id}>
              <button
                type="button"
                onClick={() => controller.open(conversation.id)}
                className={cn(
                  "flex h-(--cap-menu-row-h) w-full items-center gap-2 rounded-[5px] px-2 text-left text-control outline-none hover:bg-fill-3 focus-visible:bg-fill-3",
                  conversation.id === controller.state.conversationId && "bg-fill-2 font-medium",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{conversation.title || t("untitled")}</span>
                <span className="shrink-0 text-caption text-fg-3">{fmt.relative(conversation.lastMessageAt)}</span>
              </button>
            </PopoverClose>
          ))}
        </div>
      ) : null}
    </Popover>
  );
}

function Composer({ controller }: { controller: AssistantController }) {
  const t = useTranslations("assistant");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { draft, setDraft, attachments } = controller;
  const canSend = (draft.trim().length > 0 || attachments.length > 0) && !controller.busy && !controller.preparing && !controller.loading;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Grows with the text, up to 5 lines.
  useLayoutEffect(() => {
    const node = inputRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 104)}px`;
  }, [draft]);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (canSend) controller.send();
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files);
    if (!files.length) return;
    event.preventDefault();
    controller.addFiles(files);
  };

  return (
    <form
      className="flex shrink-0 flex-col gap-1.5 border-t border-stroke-3 p-2.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSend) controller.send();
      }}
    >
      {attachments.length ? (
        <div className="flex flex-wrap gap-1">
          {attachments.map((file, index) => (
            <span key={`${file.name}-${index}`} className="inline-flex h-[20px] items-center gap-1 rounded-[4px] border border-stroke-2 pr-0.5 pl-1.5 font-mono text-caption text-fg-2">
              <span className="max-w-[220px] truncate">{file.name}</span>
              <button
                type="button"
                aria-label={t("composer.remove", { name: file.name })}
                disabled={controller.uploading}
                onClick={() => controller.removeFile(index)}
                className="flex size-4 items-center justify-center rounded-[3px] text-fg-3 outline-none hover:bg-fill-3 hover:text-fg-1"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="flex items-end gap-1.5">
        <input
          ref={fileRef}
          type="file"
          multiple
          accept={ASSISTANT_FILE_ACCEPT}
          className="hidden"
          onChange={(event) => {
            if (event.target.files?.length) controller.addFiles(Array.from(event.target.files));
            event.target.value = "";
          }}
        />
        <Btn icon ghost aria-label={t("composer.attach")} title={t("composer.attach")} disabled={controller.uploading} onClick={() => fileRef.current?.click()}>
          <Paperclip className="size-3.5" />
        </Btn>
        <textarea
          ref={inputRef}
          rows={1}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={t("composer.placeholder")}
          aria-label={t("composer.placeholder")}
          className="min-h-(--cap-control-h) flex-1 resize-none rounded-[6px] border border-stroke-1 bg-editor px-2 py-[5px] text-control leading-[1.25] outline-none placeholder:text-fg-3 focus:border-fg-muted"
        />
        {controller.busy ? (
          <Btn onClick={controller.stop}>{t("composer.stop")}</Btn>
        ) : (
          <Btn primary type="submit" disabled={!canSend}>
            {t("composer.send")}
          </Btn>
        )}
      </div>
    </form>
  );
}
