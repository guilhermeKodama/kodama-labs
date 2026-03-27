import { useEffect, useRef, useState, useCallback } from "react";
import type { PipelineState } from "@sentinel/server/modules/pipeline/get-pipeline-state";

export type ConnectionStatus = "connected" | "connecting" | "disconnected";

export function usePipelineStream(initialState: PipelineState) {
  const [state, setState] = useState<PipelineState>(initialState);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const esRef = useRef<EventSource | null>(null);

  const connect = useCallback(() => {
    esRef.current?.close();

    const es = new EventSource("/api/pipeline/stream");
    esRef.current = es;

    es.onopen = () => {
      setStatus("connected");
    };

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as PipelineState;
        setState(data);
        setStatus("connected");
      } catch {
        // Ignore malformed messages
      }
    };

    es.onerror = () => {
      setStatus("connecting");
      // EventSource auto-reconnects; no manual logic needed.
      // On permanent failure, the browser stops retrying and readyState becomes CLOSED.
      if (es.readyState === EventSource.CLOSED) {
        setStatus("disconnected");
      }
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      esRef.current?.close();
      esRef.current = null;
    };
  }, [connect]);

  return { state, status };
}
