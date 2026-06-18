import { createRouter } from "@pipeline/server/lib/create-app";
import { prisma } from "@pipeline/server/lib/prisma";
import { intakeLead } from "../lead-intake";
import { isOriginAllowed, rateLimited, verifySignature } from "../verify";

const MAX_BODY_BYTES = 100_000;

// POST /api/webhook/lead/:slug — the LP's server route forwards here with an
// HMAC signature. Contract: NEVER 4xx a plausible lead. Anything that fails
// auth/validation parks in lead_inbox for triage instead of bouncing back to
// a real user mid-campaign. Responses are deliberately uninformative.
const router = createRouter();

router.post("/webhook/lead/:slug", async (c) => {
  const slug = c.req.param("slug");
  const ok = () => c.json({ ok: true });

  const ip =
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (rateLimited(`${slug}:${ip}`)) return ok();

  // Browser-borne requests must come from a synced idea's landing page;
  // the legit server-to-server forward carries neither header.
  const originAllowed = await isOriginAllowed(
    c.req.header("origin"),
    c.req.header("referer"),
  );
  if (!originAllowed) return ok();

  const rawBody = await c.req.text();
  if (rawBody.length > MAX_BODY_BYTES) return ok();

  const signature = verifySignature(
    rawBody,
    c.req.header("x-kodama-timestamp"),
    c.req.header("x-kodama-signature"),
  );

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    body = { _raw: rawBody };
  }

  const inbox = await prisma.leadInbox.create({
    data: {
      slug,
      body: body as object,
      signatureValid: signature.valid,
    },
  });

  const fail = async (error: string) => {
    await prisma.leadInbox.update({
      where: { id: inbox.id },
      data: { error },
    });
    return ok();
  };

  if (!signature.valid) {
    return fail(`invalid_signature: ${signature.reason}`);
  }

  const idea = await prisma.idea.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!idea) return fail("unknown_idea");

  try {
    const result = await intakeLead(idea.id, body);
    if (!result.ok) return fail(result.error ?? "intake_failed");

    await prisma.leadInbox.update({
      where: { id: inbox.id },
      data: { processedAt: new Date(), leadId: result.leadId },
    });
  } catch (err) {
    return fail(
      `intake_error: ${err instanceof Error ? err.message : "unknown"}`,
    );
  }

  return ok();
});

export default router;
