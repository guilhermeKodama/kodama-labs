import {
  isJidGroup,
  getContentType,
  extractMessageContent,
  downloadMediaMessage,
  type WAMessage,
  type WASocket,
  type Contact as BaileysContact,
  type Chat as BaileysChat,
} from "@whiskeysockets/baileys";
import { prisma } from "../lib/prisma";
import { env } from "../../env";
import { setIntegrationStatus } from "./status";
import { transcribeAudio } from "./transcribe";
import { enqueue } from "../jobs/queue";

const STATUS_BROADCAST_JID = "status@broadcast";

// Content types that carry no user content worth ingesting.
const NON_CONTENT_TYPES = new Set(["protocolMessage", "reactionMessage", "pollUpdateMessage"]);

function messageTimestampToDate(ts: WAMessage["messageTimestamp"]): Date {
  if (typeof ts === "number") return new Date(ts * 1000);
  if (typeof ts === "string") return new Date(Number(ts) * 1000);
  // Long instance (protobuf int64) — has toNumber()
  return new Date((ts as unknown as { toNumber(): number }).toNumber() * 1000);
}

export function shouldIngest(msg: WAMessage): boolean {
  const chatWid = msg.key.remoteJid;
  if (!msg.key.id || !chatWid) return false;
  if (chatWid === STATUS_BROADCAST_JID || chatWid.endsWith("@newsletter")) return false;

  const content = extractMessageContent(msg.message ?? undefined);
  const contentType = getContentType(content);
  if (!contentType || NON_CONTENT_TYPES.has(contentType)) return false;

  return true;
}

const MEDIA_TYPES = new Set([
  "imageMessage",
  "videoMessage",
  "audioMessage",
  "documentMessage",
  "stickerMessage",
]);

function extractBody(content: ReturnType<typeof extractMessageContent>): string | null {
  if (!content) return null;
  return (
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.documentMessage?.caption ||
    null
  );
}

// contextInfo (quote/mentions) is nested under whichever content type is active,
// not just extendedTextMessage — check the common carriers generically.
function extractContextInfo(content: ReturnType<typeof extractMessageContent>) {
  if (!content) return undefined;
  return (
    content.extendedTextMessage?.contextInfo ??
    content.imageMessage?.contextInfo ??
    content.videoMessage?.contextInfo ??
    content.documentMessage?.contextInfo ??
    content.stickerMessage?.contextInfo
  );
}

const chatCache = new Map<string, string>();
const contactCache = new Map<string, string>();

export function resetCaches() {
  chatCache.clear();
  contactCache.clear();
}

async function resolveChat(waChatId: string, isGroup: boolean, name?: string | null): Promise<string> {
  const cached = chatCache.get(waChatId);
  if (cached) return cached;

  const row = await prisma.chat.upsert({
    where: { waChatId },
    create: { waChatId, isGroup, name: name ?? undefined },
    update: name ? { name } : {},
  });
  chatCache.set(waChatId, row.id);
  return row.id;
}

// Baileys never offers an on-demand contact fetch — this creates a bare row on
// first sight; upsertContacts() (wired to the contacts.upsert/update events) fills
// in name/pushname later, whenever WhatsApp actually pushes that info to us.
async function resolveContact(waContactId: string): Promise<string> {
  const cached = contactCache.get(waContactId);
  if (cached) return cached;

  const row = await prisma.contact.upsert({
    where: { waContactId },
    create: { waContactId },
    update: {},
  });
  contactCache.set(waContactId, row.id);
  return row.id;
}

export async function upsertContacts(contacts: Array<Partial<BaileysContact>>) {
  for (const contact of contacts) {
    if (!contact.id) continue;
    const row = await prisma.contact.upsert({
      where: { waContactId: contact.id },
      create: {
        waContactId: contact.id,
        name: contact.name ?? undefined,
        pushname: contact.notify ?? undefined,
      },
      update: {
        ...(contact.name ? { name: contact.name } : {}),
        ...(contact.notify ? { pushname: contact.notify } : {}),
      },
    });
    contactCache.set(contact.id, row.id);
  }
}

export async function upsertChats(chats: Array<Partial<BaileysChat>>) {
  for (const chat of chats) {
    if (!chat.id) continue;
    await resolveChat(chat.id, isJidGroup(chat.id) ?? false, chat.name);
  }
}

type IngestOptions = {
  ownWid: string;
  sock: WASocket;
};

async function transcribeIfAudio(
  msg: WAMessage,
  contentType: string,
  sock: WASocket
): Promise<string | null> {
  if (contentType !== "audioMessage") return null;
  try {
    const buffer = await downloadMediaMessage(
      msg,
      "buffer",
      {},
      { reuploadRequest: sock.updateMediaMessage, logger: sock.logger }
    );
    return await transcribeAudio(buffer);
  } catch (error) {
    console.error("[whatsapp] falha ao baixar áudio pra transcrever", error);
    return null;
  }
}

export async function ingestMessage(msg: WAMessage, { ownWid, sock }: IngestOptions) {
  const waMessageId = msg.key.id;
  const chatWid = msg.key.remoteJid;
  if (!waMessageId || !chatWid) return;

  const chatId = await resolveChat(chatWid, isJidGroup(chatWid) ?? false);

  const direction = msg.key.fromMe ? "OUT" : "IN";
  let senderContactId: string | null = null;
  if (direction === "IN") {
    const senderWid = msg.key.participant || chatWid;
    senderContactId = await resolveContact(senderWid);
  }

  const occurredAt = messageTimestampToDate(msg.messageTimestamp);
  const withinRetention =
    occurredAt.getTime() >= Date.now() - env.RETENTION_DAYS * 24 * 60 * 60 * 1000;

  const content = extractMessageContent(msg.message ?? undefined);
  const contentType = getContentType(content) ?? "unknown";
  const contextInfo = extractContextInfo(content);
  const mentionedMe = (contextInfo?.mentionedJid ?? []).includes(ownWid);

  const existing = await prisma.message.findUnique({
    where: { waMessageId },
    select: { id: true, body: true },
  });

  // Skip re-transcribing: nothing to do once a message already has whatever
  // content it's going to have. The one case worth retrying is an audio
  // message some earlier pass saw but couldn't transcribe (whisper down,
  // network hiccup, or ingested before this feature existed at all).
  const needsTranscription =
    withinRetention && contentType === "audioMessage" && !existing?.body;

  if (existing && !needsTranscription) return;

  const body = !withinRetention
    ? null
    : (extractBody(content) ?? (needsTranscription ? await transcribeIfAudio(msg, contentType, sock) : null));

  if (existing) {
    if (body) await prisma.message.update({ where: { id: existing.id }, data: { body } });
  } else {
    const created = await prisma.message.create({
      data: {
        waMessageId,
        chatId,
        senderContactId,
        direction,
        type: contentType,
        body,
        hasMedia: MEDIA_TYPES.has(contentType),
        mentionedMe,
        quotedWaMessageId: contextInfo?.stanzaId ?? null,
        occurredAt,
      },
    });

    if (direction === "IN") {
      // Only triage genuinely fresh messages — a catch-up/history-sync dump
      // shouldn't trigger a triage stampede for things days or weeks old.
      const withinTriageWindow = occurredAt.getTime() >= Date.now() - 24 * 60 * 60 * 1000;
      if (withinRetention && withinTriageWindow) {
        try {
          await enqueue("triage", { messageId: created.id }, { uniqueKey: `triage:${created.id}` });
        } catch (error) {
          console.error("[whatsapp] falha ao enfileirar triagem", error);
        }
      }
    } else {
      // Replied from the phone — any queued/snoozed items in this chat are moot.
      try {
        await prisma.message.updateMany({
          where: { chatId, queueState: { in: ["QUEUED", "SNOOZED"] } },
          data: { queueState: "RESOLVED_BY_REPLY" },
        });
      } catch (error) {
        console.error("[whatsapp] falha ao auto-resolver fila", error);
      }
    }
  }

  const now = new Date();
  await prisma.chat.update({ where: { id: chatId }, data: { lastMessageAt: occurredAt } });
  await setIntegrationStatus("whatsapp", { lastMessageAt: now });
}
