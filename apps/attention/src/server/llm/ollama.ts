import { env } from "../../env";

export type ChatJsonInput = {
  model: string;
  system: string;
  user: string;
  schema: object;
  timeoutMs?: number;
};

export type ChatJsonResult = {
  json: unknown;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
};

// Single place that knows how to talk to the model provider. A future
// api-based adapter (e.g. Anthropic) implements the same chatJson signature —
// swapping providers is an env change, not a rewrite of triage.ts/draft.ts.
export async function chatJson({
  model,
  system,
  user,
  schema,
  timeoutMs,
}: ChatJsonInput): Promise<ChatJsonResult> {
  const res = await fetch(`${env.OLLAMA_API_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      format: schema,
      options: { num_ctx: 8192 },
      keep_alive: "60m",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(timeoutMs ?? env.LLM_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`Ollama respondeu ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    message?: { content?: string };
    prompt_eval_count?: number;
    eval_count?: number;
    total_duration?: number;
  };

  const content = data.message?.content;
  if (typeof content !== "string") {
    throw new Error("Ollama não retornou message.content");
  }

  return {
    json: JSON.parse(content),
    inputTokens: data.prompt_eval_count ?? 0,
    outputTokens: data.eval_count ?? 0,
    durationMs: Math.round((data.total_duration ?? 0) / 1e6),
  };
}
