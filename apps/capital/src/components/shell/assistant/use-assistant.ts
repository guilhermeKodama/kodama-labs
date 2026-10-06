"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { invalidateEvent } from "@/lib/api/invalidation";
import { rememberUndo } from "@/lib/api/undo";
import { useErrorMessage } from "@/lib/api/use-app-mutation";
import {
  cancelTurn,
  confirmPlan as postConfirmPlan,
  createConversation,
  getConversation,
  messageBody,
  rejectPlan as postRejectPlan,
  requestError,
  streamMessage,
  streamRetry,
  uploadConversationFile,
} from "@/lib/assistant/api";
import { planResultView, type DuplicateDecision } from "@/lib/assistant/cards";
import { namePastedImage, validateAssistantFile } from "@/lib/assistant/constants";
import { messagesFromConversation, readLastConversation, resumeError, writeLastConversation } from "@/lib/assistant/history";
import { assistantReducer, canRetry, initialAssistantState, isBusy, retryKind, type AssistantInput, type AssistantState } from "@/lib/assistant/reducer";
import type { AgentEvent } from "@/lib/assistant/sse";
import { isWriteTool, turnInvalidation } from "@/lib/assistant/tools";
import type { MessageAttachment } from "@/types/assistant";

function localStore(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

let sequence = 0;
const clientId = () => `local-${Date.now().toString(36)}-${(sequence += 1)}`;

export interface AssistantController {
  state: AssistantState;
  busy: boolean;
  /** Files are being uploaded before the message goes. */
  uploading: boolean;
  /** The message is on its way (conversation created, files uploaded) but its turn has not started. */
  preparing: boolean;
  /** A conversation is being opened (resume or from the list). */
  loading: boolean;
  draft: string;
  setDraft: (text: string) => void;
  attachments: File[];
  addFiles: (files: readonly File[]) => void;
  removeFile: (index: number) => void;
  send: () => void;
  ask: (text: string) => void;
  stop: () => void;
  retry: () => void;
  canRetry: boolean;
  newConversation: () => void;
  open: (conversationId: string) => void;
  /** Reopens the last conversation of this browser, once, when the assistant is first shown. */
  resume: () => void;
  confirmPlan: (planId: string, payloadHash: string) => Promise<void>;
  rejectPlan: (planId: string) => Promise<void>;
  answerCard: (cardId: string, decisions: Record<string, DuplicateDecision>) => void;
}

/**
 * The ⌘K assistant: the open conversation (reducer.ts) and the network
 * around it (create, upload, stream, cancel, plans, cards, resume). Lives
 * in the ⌘K host, so a reply keeps streaming while the palette is closed.
 */
export function useAssistant(): AssistantController {
  const t = useTranslations("assistant");
  const errorText = useErrorMessage();
  const queryClient = useQueryClient();
  const [state, dispatch] = useReducer(assistantReducer, initialAssistantState);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const stateRef = useRef(state);
  const resumedRef = useRef(false);
  const uploadingRef = useRef(false);
  const loadingRef = useRef(false);
  useEffect(() => {
    stateRef.current = state;
  });

  // A stream left open when the shell unmounts (sign out) is dropped.
  useEffect(() => () => abortRef.current?.abort(), []);

  /** Streams a turn: a new message (`input`), or the failed last turn run again (`"rerun"`). */
  const run = useCallback(
    async (conversationId: string, request: AssistantInput | "rerun") => {
      if (request === "rerun") dispatch({ type: "rerun" });
      else dispatch({ type: "send", input: request, optimisticId: clientId(), createdAt: new Date().toISOString() });
      const controller = new AbortController();
      abortRef.current = controller;
      let wrote = false;
      const onEvent = (event: AgentEvent) => {
        if (event.type === "tool_call_result" && event.status === "success" && isWriteTool(event.tool)) wrote = true;
        if (event.type === "plan_committed") {
          wrote = true;
          const { batchId } = planResultView((event.result ?? {}) as Record<string, unknown>);
          // ⌘Z undoes the import (or the revert) like any other write.
          if (batchId) rememberUndo(batchId);
        }
        dispatch({ type: "event", event });
      };
      try {
        if (request === "rerun") await streamRetry(conversationId, onEvent, controller.signal);
        else await streamMessage(conversationId, messageBody(request, clientId()), onEvent, controller.signal);
        dispatch({ type: "ended" });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") dispatch({ type: "cancelled" });
        else dispatch({ type: "failed", error: requestError(error) });
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        void invalidateEvent(queryClient, turnInvalidation(wrote));
      }
    },
    [queryClient],
  );

  const ensureConversation = useCallback(
    async (title: string): Promise<string> => {
      const current = stateRef.current.conversationId;
      if (current) return current;
      const created = await createConversation(title.slice(0, 80) || undefined);
      dispatch({ type: "conversation", conversationId: created.id, title: created.title });
      writeLastConversation(localStore(), created.id);
      return created.id;
    },
    [],
  );

  const sendInput = useCallback(
    (rawText: string, files: File[]) => {
      const text = rawText.trim();
      if ((!text && !files.length) || isBusy(stateRef.current) || uploadingRef.current || loadingRef.current) return;
      // Writing in the open thread: the last conversation is not reopened over it.
      resumedRef.current = true;
      uploadingRef.current = true;
      setPreparing(true);
      setUploading(files.length > 0);
      void (async () => {
        let conversationId: string;
        let uploaded: MessageAttachment[] = [];
        try {
          conversationId = await ensureConversation(text || files[0]?.name || "");
          uploaded = await Promise.all(
            files.map(async (file) => {
              const saved = await uploadConversationFile(conversationId, file);
              return { fileId: saved.id, originalName: saved.originalName, mediaType: saved.mimeType, blobUrl: saved.blobUrl };
            }),
          );
        } catch (error) {
          // Nothing was sent: the text and the files stay in the composer.
          setDraft(rawText);
          setAttachments(files);
          toast(errorText(error));
          return;
        } finally {
          uploadingRef.current = false;
          setPreparing(false);
          setUploading(false);
        }
        await run(conversationId, { text: text || undefined, files: uploaded.length ? uploaded : undefined });
      })();
      setDraft("");
      setAttachments([]);
    },
    [ensureConversation, run, errorText],
  );

  const send = useCallback(() => sendInput(draft, attachments), [sendInput, draft, attachments]);
  /** "Perguntar ao assistente: …" from ⌘K: the typed text goes at once, with any files already attached. */
  const ask = useCallback((text: string) => sendInput(text, attachments), [sendInput, attachments]);

  const stop = useCallback(() => {
    const conversationId = stateRef.current.conversationId;
    void (async () => {
      // The server stops the turn first (it would run on without the reader), then the stream is dropped.
      if (conversationId) await cancelTurn(conversationId).catch(() => undefined);
      abortRef.current?.abort();
    })();
  }, []);

  const retry = useCallback(() => {
    const current = stateRef.current;
    const kind = retryKind(current);
    if (!kind || !current.conversationId) return;
    // A turn that failed on the server saved the message already: it runs again there, nothing is resent.
    if (kind === "rerun") void run(current.conversationId, "rerun");
    else if (current.lastInput) void run(current.conversationId, current.lastInput);
  }, [run]);

  const newConversation = useCallback(() => {
    if (isBusy(stateRef.current) || uploadingRef.current) return;
    resumedRef.current = true;
    dispatch({ type: "reset" });
    setDraft("");
    setAttachments([]);
    writeLastConversation(localStore(), null);
  }, []);

  const open = useCallback(
    (conversationId: string) => {
      if (isBusy(stateRef.current) || uploadingRef.current) return;
      resumedRef.current = true;
      loadingRef.current = true;
      setLoading(true);
      void getConversation(conversationId)
        .then((detail) => {
          const messages = messagesFromConversation(detail);
          dispatch({ type: "loaded", conversationId: detail.id, title: detail.title, messages, error: resumeError(detail, messages) });
          writeLastConversation(localStore(), detail.id);
        })
        .catch((error: unknown) => {
          // A conversation deleted elsewhere is forgotten, so ⌘K starts fresh.
          if (readLastConversation(localStore()) === conversationId) writeLastConversation(localStore(), null);
          toast(t("errors.loadFailed"), { description: errorText(error) });
        })
        .finally(() => {
          loadingRef.current = false;
          setLoading(false);
        });
    },
    [t, errorText],
  );

  const resume = useCallback(() => {
    if (resumedRef.current) return;
    resumedRef.current = true;
    if (stateRef.current.conversationId || stateRef.current.messages.length) return;
    const last = readLastConversation(localStore());
    if (last) open(last);
  }, [open]);

  const addFiles = useCallback(
    (files: readonly File[]) => {
      const accepted: File[] = [];
      const now = Date.now();
      files.forEach((raw, index) => {
        const file = namePastedImage(raw, now + index);
        const rejection = validateAssistantFile(file);
        if (!rejection) accepted.push(file);
        else if (rejection.reason === "type") toast(t("composer.fileType", { name: file.name }));
        else toast(t("composer.fileTooLarge", { name: file.name, max: rejection.maxLabel }));
      });
      if (accepted.length) setAttachments((current) => [...current, ...accepted]);
    },
    [t],
  );

  const removeFile = useCallback((index: number) => setAttachments((current) => current.filter((_, i) => i !== index)), []);

  const confirmPlan = useCallback(
    async (planId: string, payloadHash: string) => {
      const conversationId = stateRef.current.conversationId;
      if (!conversationId || isBusy(stateRef.current)) return;
      try {
        await postConfirmPlan(conversationId, planId, payloadHash);
      } catch (error) {
        toast(errorText(error));
        return;
      }
      dispatch({ type: "plan_status", planId, status: "confirmed" });
      // The agent applies a confirmed plan on its next turn (commit_plan).
      await run(conversationId, { text: t("plan.confirmedMessage") });
    },
    [run, t, errorText],
  );

  const rejectPlan = useCallback(
    async (planId: string) => {
      const conversationId = stateRef.current.conversationId;
      if (!conversationId) return;
      try {
        await postRejectPlan(conversationId, planId);
      } catch (error) {
        toast(errorText(error));
        return;
      }
      dispatch({ type: "plan_status", planId, status: "rejected" });
    },
    [errorText],
  );

  const answerCard = useCallback(
    (cardId: string, decisions: Record<string, DuplicateDecision>) => {
      const conversationId = stateRef.current.conversationId;
      if (!conversationId || isBusy(stateRef.current)) return;
      dispatch({ type: "card_answered", cardId, decisions });
      void run(conversationId, {
        cardResponse: { cardId, decisions: Object.entries(decisions).map(([pairId, decision]) => ({ pairId, label: t(`card.decisions.${decision}`) })) },
      });
    },
    [run, t],
  );

  return {
    state,
    busy: isBusy(state),
    uploading,
    preparing,
    loading,
    draft,
    setDraft,
    attachments,
    addFiles,
    removeFile,
    send,
    ask,
    stop,
    retry,
    canRetry: canRetry(state),
    newConversation,
    open,
    resume,
    confirmPlan,
    rejectPlan,
    answerCard,
  };
}
