export interface WebhookEnv {
  url?: string | undefined;
  header?: string | undefined;
  headerValue?: string | undefined;
  key?: string | undefined;
}

export interface ResolvedWebhook {
  url: string;
  /** Header name → full value. Empty when the URL is set and no auth was configured. */
  headers: Record<string, string>;
}

/**
 * The receiver supplies the header value verbatim. `key` is only a fallback
 * that builds `Bearer <key>` when `headerValue` is empty.
 * Returns null when there is nowhere to send.
 */
export function resolveWebhook(env: WebhookEnv): ResolvedWebhook | null {
  const url = env.url?.trim() ?? "";
  if (!url) return null;

  const name = env.header?.trim() || "Authorization";
  const raw = env.headerValue?.trim() ?? "";
  if (raw) return { url, headers: { [name]: raw } };

  const key = env.key?.trim() ?? "";
  if (key) return { url, headers: { [name]: `Bearer ${key}` } };

  return { url, headers: {} };
}

export function webhookFromProcess(): ResolvedWebhook | null {
  return resolveWebhook({
    url: process.env.ALERT_WEBHOOK_URL,
    header: process.env.ALERT_WEBHOOK_HEADER,
    headerValue: process.env.ALERT_WEBHOOK_HEADER_VALUE,
    key: process.env.ALERT_WEBHOOK_KEY,
  });
}

export async function postJson(
  target: ResolvedWebhook,
  body: unknown,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...target.headers,
  };
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetchImpl(target.url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      if (response.ok) return;
      lastStatus = response.status;
    } catch {
      lastStatus = 0;
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
  }
  console.error(`[webhook] POST failed after 3 attempts (status ${lastStatus})`);
}
