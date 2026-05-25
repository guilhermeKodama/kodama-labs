import { NextResponse } from "next/server";

export const runtime = "edge";

type LeadPayload = Record<string, string>;

export async function POST(request: Request) {
  let payload: LeadPayload;
  try {
    payload = (await request.json()) as LeadPayload;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const webhook = process.env.LEADS_WEBHOOK_URL;

  if (!webhook) {
    console.log("[lead] LEADS_WEBHOOK_URL not set — logging only:", payload);
    return NextResponse.json({ ok: true, forwarded: false });
  }

  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...payload, receivedAt: new Date().toISOString() }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error("[lead] webhook responded non-2xx:", res.status, text);
      return NextResponse.json({ error: "webhook failed" }, { status: 502 });
    }
  } catch (err) {
    console.error("[lead] webhook fetch threw:", err);
    return NextResponse.json({ error: "webhook unreachable" }, { status: 502 });
  }

  return NextResponse.json({ ok: true, forwarded: true });
}
