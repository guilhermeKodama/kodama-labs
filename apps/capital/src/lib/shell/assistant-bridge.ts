import { useEffect, useLayoutEffect, useRef } from "react";

/**
 * Opens the assistant (it lives in the ⌘K palette) from anywhere: the
 * import dialog sending a PDF, "Importar nota", the /assistant redirect.
 * A tiny event bus, so callers need no context and the ⌘K host is the
 * only listener. A request made while no host is mounted waits for the
 * next one.
 */

export interface AssistantRequest {
  /** Text placed in the composer (sent by the host, or left to edit; the host decides). */
  prompt?: string;
  /** Files to attach to the next message. */
  files?: File[];
}

export type AssistantListener = (request: AssistantRequest) => void;

export interface AssistantBridge {
  open: (request?: AssistantRequest) => void;
  /** Registers the host; a request that came before it is delivered at once. */
  listen: (listener: AssistantListener) => () => void;
}

export function createAssistantBridge(): AssistantBridge {
  let listener: AssistantListener | null = null;
  let pending: AssistantRequest | null = null;
  return {
    open: (request = {}) => {
      if (listener) listener(request);
      else pending = request;
    },
    listen: (next) => {
      listener = next;
      if (pending) {
        const request = pending;
        pending = null;
        next(request);
      }
      return () => {
        if (listener === next) listener = null;
      };
    },
  };
}

const bridge = createAssistantBridge();

/** Opens ⌘K in assistant mode, optionally with a prompt and files. */
export function openAssistant(request: AssistantRequest = {}): void {
  bridge.open(request);
}

/** For the ⌘K host: called with each openAssistant() request while mounted. */
export function useAssistantBridge(onOpen: AssistantListener): void {
  const handler = useRef(onOpen);
  useLayoutEffect(() => {
    handler.current = onOpen;
  });
  useEffect(() => bridge.listen((request) => handler.current(request)), []);
}
