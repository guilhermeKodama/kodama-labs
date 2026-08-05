import { NextResponse, after } from "next/server";

export const runtime = "edge";

type LeadPayload = Record<string, string | string[]>;

const FORWARD_RETRIES = 2;
const RETRY_DELAYS_MS = [1_000, 5_000];

// HMAC-SHA256(secret, `${timestamp}.${body}`) via Web Crypto (edge-compatible).
async function sign(secret: string, timestamp: string, body: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${body}`),
  );
  const hex = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `sha256=${hex}`;
}

async function forward(webhook: string, secret: string | undefined, body: string) {
  for (let attempt = 0; attempt <= FORWARD_RETRIES; attempt++) {
    try {
      const timestamp = String(Date.now());
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      if (secret) {
        headers["x-kodama-timestamp"] = timestamp;
        headers["x-kodama-signature"] = await sign(secret, timestamp, body);
      }
      const res = await fetch(webhook, { method: "POST", headers, body });
      if (res.ok) return;
      console.error(`[lead] webhook non-2xx (attempt ${attempt + 1}):`, res.status);
    } catch (err) {
      console.error(`[lead] webhook fetch threw (attempt ${attempt + 1}):`, err);
    }
    if (attempt < FORWARD_RETRIES) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    }
  }
  console.error("[lead] webhook forward exhausted retries — payload:", body);
}

export async function POST(request: Request) {
  let payload: LeadPayload;
  try {
    payload = (await request.json()) as LeadPayload;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // Honeypot: real users never fill the hidden "website" field.
  if (typeof payload.website === "string" && payload.website.trim() !== "") {
    return NextResponse.json({ ok: true, forwarded: false });
  }
  delete payload.website;

  const webhook = process.env.LEADS_WEBHOOK_URL;

  if (!webhook) {
    console.log("[lead] LEADS_WEBHOOK_URL not set — logging only:", payload);
    return NextResponse.json({ ok: true, forwarded: false });
  }

  const body = JSON.stringify({
    ...payload,
    receivedAt: new Date().toISOString(),
  });

  // The user already converted — never bounce them on a downstream hiccup.
  // Respond 200 now; forward (with retries) after the response is sent.
  after(forward(webhook, process.env.LEADS_WEBHOOK_SECRET, body));

  return NextResponse.json({ ok: true, forwarded: true });
}
