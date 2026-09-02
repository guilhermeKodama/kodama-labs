import { create } from "zustand";
import { client } from "@/lib/api-client";
import { parseHistoryToMessages, type RawAgentMessage } from "@/lib/assistant/parse-history";
import type {
  ChatMessage,
  ConversationFile,
  ConversationSummary,
  DuplicateReviewCard,
  MessageBlock,
} from "@/types/assistant";

interface AssistantState {
  conversations: ConversationSummary[];
  conversationsLoaded: boolean;
  messagesByConversation: Record<string, ChatMessage[]>;
  filesByConversation: Record<string, ConversationFile[]>;
  turnRunning: Record<string, boolean>;
  turnErrorByConversation: Record<string, string | undefined>;
  loadedConversations: Record<string, boolean>;
  /** Last failure from a non-streaming action (create/fetch/upload/archive).
   *  Per-turn streaming errors keep their own per-conversation slot in
   *  `turnErrorByConversation` — this one is for everything else, which
   *  until now failed completely silently. */
  error: string | null;
}

interface AssistantActions {
  fetchConversations: () => Promise<void>;
  createConversation: (title?: string) => Promise<string | null>;
  fetchConversation: (id: string) => Promise<void>;
  sendMessage: (
    conversationId: string,
    input: {
      text?: string;
      cardResponse?: { cardId: string; decisions: Array<{ pairId: string; label: string }> };
      fileIds?: string[];
    }
  ) => Promise<void>;
  uploadFile: (conversationId: string, file: File) => Promise<ConversationFile | null>;
  toggleFileActive: (conversationId: string, fileId: string) => void;
  confirmPlan: (conversationId: string, planId: string, payloadHash: string) => Promise<boolean>;
  rejectPlan: (conversationId: string, planId: string) => Promise<boolean>;
  cancelTurn: (conversationId: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  archiveConversation: (id: string) => Promise<void>;
  setError: (error: string | null) => void;
}

/** Pull the API's error message out of a failed response, falling back to a
 *  labelled status code when the body isn't the JSON envelope we expect
 *  (an HTML error page, a proxy timeout, an empty body). */
async function readError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return body?.error?.message ?? `${fallback} (${res.status})`;
}

function updateBlock(
  messages: ChatMessage[],
  messageId: string,
  mutate: (blocks: MessageBlock[]) => MessageBlock[]
): ChatMessage[] {
  return messages.map((m) => (m.id === messageId ? { ...m, blocks: mutate(m.blocks) } : m));
}

export const useAssistantStore = create<AssistantState & AssistantActions>()((set, get) => ({
  conversations: [],
  conversationsLoaded: false,
  messagesByConversation: {},
  filesByConversation: {},
  turnRunning: {},
  turnErrorByConversation: {},
  loadedConversations: {},
  error: null,

  setError: (error) => set({ error }),

  fetchConversations: async () => {
    try {
      const res = await client.v1.assistant.conversations.$get({ query: {} });
      if (!res.ok) {
        set({ error: await readError(res, "Falha ao carregar conversas") });
        return;
      }
      const data = await res.json();
      set({ conversations: data, conversationsLoaded: true, error: null });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Falha ao carregar conversas" });
    }
  },

  createConversation: async (title) => {
    try {
      const res = await client.v1.assistant.conversations.$post({ json: { title } });
      if (!res.ok) {
        set({ error: await readError(res, "Falha ao criar conversa") });
        return null;
      }
      const conversation = await res.json();
      set((state) => ({ conversations: [conversation, ...state.conversations], error: null }));
      return conversation.id;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Falha ao criar conversa" });
      return null;
    }
  },

  fetchConversation: async (id) => {
    try {
      const res = await client.v1.assistant.conversations[":id"].$get({ param: { id } });
      if (!res.ok) {
        set({ error: await readError(res, "Falha ao carregar conversa") });
        return;
      }
      const data = await res.json();
      const messages = parseHistoryToMessages(data.messages as RawAgentMessage[]);
      const files: ConversationFile[] = data.files.map((f) => ({ ...f, active: true }));
      set((state) => ({
        messagesByConversation: { ...state.messagesByConversation, [id]: messages },
        filesByConversation: { ...state.filesByConversation, [id]: files },
        loadedConversations: { ...state.loadedConversations, [id]: true },
        error: null,
      }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Falha ao carregar conversa" });
    }
  },

  uploadFile: async (conversationId, file) => {
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/v1/assistant/conversations/${conversationId}/files`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (!res.ok) {
        set({ error: await readError(res, "Falha no envio do arquivo") });
        return null;
      }
      const uploaded = (await res.json()) as ConversationFile;
      const withActive: ConversationFile = { ...uploaded, active: true };
      set((state) => ({
        filesByConversation: {
          ...state.filesByConversation,
          [conversationId]: [...(state.filesByConversation[conversationId] ?? []), withActive],
        },
        error: null,
      }));
      return withActive;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Falha no envio do arquivo" });
      return null;
    }
  },

  toggleFileActive: (conversationId, fileId) => {
    set((state) => ({
      filesByConversation: {
        ...state.filesByConversation,
        [conversationId]: (state.filesByConversation[conversationId] ?? []).map((f) =>
          f.id === fileId ? { ...f, active: !f.active } : f
        ),
      },
    }));
  },

  confirmPlan: async (conversationId, planId, payloadHash) => {
    const res = await fetch(
      `/api/v1/assistant/conversations/${conversationId}/plans/${planId}/confirm`,
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payloadHash }),
      }
    );
    return res.ok;
  },

  rejectPlan: async (conversationId, planId) => {
    const res = await fetch(
      `/api/v1/assistant/conversations/${conversationId}/plans/${planId}/reject`,
      { method: "POST", credentials: "include" }
    );
    return res.ok;
  },

  cancelTurn: async (conversationId) => {
    await fetch(`/api/v1/assistant/conversations/${conversationId}/cancel`, {
      method: "POST",
      credentials: "include",
    });
  },

  renameConversation: async (id, title) => {
    // No dedicated rename endpoint yet - update-conversation.ts's title
    // command exists server-side but isn't wired to a route in v1; this
    // is a known gap, tracked for a fast-follow rather than blocking v1.
    set((state) => ({
      conversations: state.conversations.map((c) => (c.id === id ? { ...c, title } : c)),
    }));
  },

  archiveConversation: async (id) => {
    try {
      const res = await client.v1.assistant.conversations[":id"].$delete({ param: { id } });
      if (!res.ok) {
        set({ error: await readError(res, "Falha ao excluir conversa") });
        return;
      }
      set((state) => ({
        conversations: state.conversations.filter((c) => c.id !== id),
        error: null,
      }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Falha ao excluir conversa" });
    }
  },

  sendMessage: async (conversationId, input) => {
    const conversationFiles = get().filesByConversation[conversationId] ?? [];
    // PDFs and images are the only types that go in as content blocks -
    // OFX/CSV are read through get_parsed_rows instead.
    const activeFileIds = conversationFiles
      .filter((f) => (f.fileType === "pdf" || f.fileType === "image") && f.active !== false)
      .map((f) => f.id);
    const fileIds = input.fileIds ?? activeFileIds;

    const optimisticId = `pending-${Date.now()}`;
    const optimisticBlocks: MessageBlock[] = input.cardResponse
      ? [{ kind: "card_response", text: input.cardResponse.decisions.map((d) => `${d.pairId}: ${d.label}`).join(", ") }]
      : [{ kind: "text", text: input.text ?? "" }];

    // Mirror what the server will persist as capital_file_ref, so the
    // attachment shows up the instant the user hits send rather than
    // only after a reload.
    if (!input.cardResponse && fileIds.length > 0) {
      const attached = conversationFiles
        .filter((f) => fileIds.includes(f.id))
        .map((f) => ({
          fileId: f.id,
          originalName: f.originalName,
          mediaType: f.mimeType,
          blobUrl: f.blobUrl,
        }));
      if (attached.length > 0) {
        optimisticBlocks.push({ kind: "attachments", files: attached });
      }
    }

    set((state) => ({
      messagesByConversation: {
        ...state.messagesByConversation,
        [conversationId]: [
          ...(state.messagesByConversation[conversationId] ?? []),
          { id: optimisticId, role: "user", status: "sending", createdAt: new Date().toISOString(), blocks: optimisticBlocks },
        ],
      },
      turnRunning: { ...state.turnRunning, [conversationId]: true },
      turnErrorByConversation: { ...state.turnErrorByConversation, [conversationId]: undefined },
    }));

    try {
      const res = await fetch(`/api/v1/assistant/conversations/${conversationId}/messages`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: input.text, cardResponse: input.cardResponse, fileIds }),
      });

      if (!res.ok || !res.body) {
        const errBody = await res.json().catch(() => null) as { error?: { message?: string } } | null;
        set((state) => ({
          turnRunning: { ...state.turnRunning, [conversationId]: false },
          turnErrorByConversation: {
            ...state.turnErrorByConversation,
            [conversationId]: errBody?.error?.message ?? `Erro ${res.status}`,
          },
        }));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          if (!frame.trim()) continue;
          let eventType = "message";
          let data = "";
          for (const line of frame.split("\n")) {
            if (line.startsWith("event:")) eventType = line.slice(6).trim();
            else if (line.startsWith("data:")) data += line.slice(5).trim();
          }
          if (!data) continue;
          try {
            handleEvent(conversationId, optimisticId, eventType, JSON.parse(data), set);
          } catch {
            // malformed frame - skip it, the stream continues
          }
        }
      }
    } catch (error) {
      set((state) => ({
        turnErrorByConversation: {
          ...state.turnErrorByConversation,
          [conversationId]: error instanceof Error ? error.message : "Falha na conexão",
        },
      }));
    } finally {
      set((state) => ({ turnRunning: { ...state.turnRunning, [conversationId]: false } }));
      // Picks up anything the turn may have changed about the
      // conversation itself - title (auto-generated on the first
      // message), lastMessageAt ordering - not just its messages.
      void get().fetchConversations();
    }
  },
}));

type SetFn = (
  partial:
    | Partial<AssistantState>
    | ((state: AssistantState & AssistantActions) => Partial<AssistantState>)
) => void;
function handleEvent(
  conversationId: string,
  optimisticId: string,
  eventType: string,
  event: Record<string, unknown>,
  set: SetFn
) {
  switch (eventType) {
    case "message_created": {
      const msg = event.message as { id: string; role: "user" | "assistant"; kind: string; createdAt: string };
      set((state) => {
        const current = state.messagesByConversation[conversationId] ?? [];

        // Plumbing row (the tool_result batch sent back to the model) -
        // never rendered as its own bubble.
        if (msg.kind === "tool_results") {
          return { messagesByConversation: state.messagesByConversation };
        }

        // The real, server-persisted version of the optimistic user
        // bubble: same content, now with a stable id - swap it in place
        // rather than appending, so it doesn't jump position.
        if (msg.role === "user") {
          const optimistic = current.find((m) => m.id === optimisticId);
          const withoutOptimistic = current.filter((m) => m.id !== optimisticId);
          const persisted: ChatMessage = {
            id: msg.id,
            role: "user",
            status: "complete",
            createdAt: msg.createdAt,
            blocks: optimistic?.blocks ?? [],
          };
          return {
            messagesByConversation: {
              ...state.messagesByConversation,
              [conversationId]: [...withoutOptimistic, persisted],
            },
          };
        }

        // A fresh assistant message placeholder, appended for streaming.
        const assistantPlaceholder: ChatMessage = {
          id: msg.id,
          role: "assistant",
          status: "streaming",
          createdAt: msg.createdAt,
          blocks: [],
        };
        return {
          messagesByConversation: {
            ...state.messagesByConversation,
            [conversationId]: [...current, assistantPlaceholder],
          },
        };
      });
      break;
    }

    case "token": {
      const { messageId, delta } = event as { messageId: string; delta: string };
      set((state) => ({
        messagesByConversation: {
          ...state.messagesByConversation,
          [conversationId]: (state.messagesByConversation[conversationId] ?? []).map((m) => {
            if (m.id !== messageId) return m;
            const streamingText = (m.streamingText ?? "") + delta;
            // Simplification: while streaming, the running text is
            // always rendered as one trailing block. If a turn emits
            // text, then a tool call, then more text, the two text
            // spans visually merge into one during the live stream -
            // cosmetic only, since message_complete/refresh replays the
            // persisted content array, which keeps the real block order.
            const lastBlock = m.blocks[m.blocks.length - 1];
            const blocks =
              lastBlock?.kind === "text"
                ? [...m.blocks.slice(0, -1), { kind: "text" as const, text: streamingText }]
                : [...m.blocks, { kind: "text" as const, text: streamingText }];
            return { ...m, streamingText, blocks };
          }),
        },
      }));
      break;
    }

    case "tool_call_started": {
      const { messageId, toolCallId, tool, label } = event as {
        messageId: string;
        toolCallId: string;
        tool: string;
        label: string;
      };
      set((state) => ({
        messagesByConversation: {
          ...state.messagesByConversation,
          [conversationId]: updateBlock(state.messagesByConversation[conversationId] ?? [], messageId, (blocks) => [
            ...blocks,
            { kind: "tool", toolCallId, tool, label, status: "running" },
          ]),
        },
      }));
      break;
    }

    case "tool_call_result": {
      const { messageId, toolCallId, status, summary } = event as {
        messageId: string;
        toolCallId: string;
        status: "success" | "error";
        summary?: string;
      };
      set((state) => ({
        messagesByConversation: {
          ...state.messagesByConversation,
          [conversationId]: updateBlock(state.messagesByConversation[conversationId] ?? [], messageId, (blocks) =>
            blocks.map((b) => (b.kind === "tool" && b.toolCallId === toolCallId ? { ...b, status, summary } : b))
          ),
        },
      }));
      break;
    }

    case "plan_proposed": {
      const { messageId, planId, kind, summary, payloadHash, warnings } = event as {
        messageId: string;
        planId: string;
        kind: "import" | "revert";
        summary: Record<string, unknown>;
        payloadHash: string;
        warnings: string[];
      };
      set((state) => ({
        messagesByConversation: {
          ...state.messagesByConversation,
          [conversationId]: updateBlock(state.messagesByConversation[conversationId] ?? [], messageId, (blocks) => [
            ...blocks,
            { kind: "plan", planId, planKind: kind, summary, payloadHash, warnings, status: "proposed" },
          ]),
        },
      }));
      break;
    }

    case "plan_committed": {
      const { messageId, planId, kind, result } = event as {
        messageId: string;
        planId: string;
        kind: "import" | "revert";
        result: Record<string, unknown>;
      };
      set((state) => ({
        messagesByConversation: {
          ...state.messagesByConversation,
          [conversationId]: updateBlock(state.messagesByConversation[conversationId] ?? [], messageId, (blocks) => [
            ...blocks,
            { kind: "plan_result", planId, planKind: kind, result },
          ]),
        },
      }));
      break;
    }

    case "action_card": {
      const { messageId, card } = event as { messageId: string; card: DuplicateReviewCard };
      set((state) => ({
        messagesByConversation: {
          ...state.messagesByConversation,
          [conversationId]: updateBlock(state.messagesByConversation[conversationId] ?? [], messageId, (blocks) => [
            ...blocks,
            { kind: "card", card },
          ]),
        },
      }));
      break;
    }

    case "message_complete": {
      const { messageId } = event as { messageId: string };
      set((state) => ({
        messagesByConversation: {
          ...state.messagesByConversation,
          [conversationId]: (state.messagesByConversation[conversationId] ?? []).map((m) =>
            m.id === messageId ? { ...m, status: "complete" as const } : m
          ),
        },
      }));
      break;
    }

    case "error": {
      const { message } = event as { message: string };
      set((state) => ({
        turnErrorByConversation: { ...state.turnErrorByConversation, [conversationId]: message },
      }));
      break;
    }

    default:
      break;
  }
}
