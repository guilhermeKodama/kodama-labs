// This worker runs pre-bundled via esbuild (see package.json's worker:whatsapp
// script), not through tsx like the other workers — tsx's loader has a bug
// resolving Baileys' ESM-only whatsapp-rust-bridge dependency
// (ERR_PACKAGE_PATH_NOT_EXPORTED), even under the latest tsx. Plain Node resolves
// it fine, so esbuild bundles this file (Prisma's generated client stays external
// since it's CJS and doesn't survive being bundled into ESM) and Node runs the
// output directly.
import { rm } from "node:fs/promises";
import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  type ConnectionState,
  type WASocket,
} from "@whiskeysockets/baileys";
import type { Boom } from "@hapi/boom";
import pino from "pino";
import qrcode from "qrcode-terminal";
import { env } from "../env";
import { prisma } from "../server/lib/prisma";
import { setIntegrationStatus } from "../server/whatsapp/status";
import { shouldIngest, ingestMessage, upsertContacts, upsertChats } from "../server/whatsapp/ingest";
import { handleSend } from "../server/whatsapp/send";
import { claim, fail } from "../server/jobs/queue";

const logger = pino({ level: "warn" });

let ownWid: string | null = null;
let sendLoopRunning = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Persisted (not in-memory) so the cooldown survives systemd restarting the
// process — that's the whole point. 479 failed reconnect attempts happened
// over 23h once because every close() just exited and RestartSec=10 brought
// it right back for another immediate try. Same backoff shape as the job
// queue's fail(): 30s base, doubling, capped at 1h.
async function waitForCooldown(): Promise<void> {
  const current = await prisma.integrationStatus.findUnique({ where: { channel: "whatsapp" } });
  if (!current?.nextRetryAt) return;
  const waitMs = current.nextRetryAt.getTime() - Date.now();
  if (waitMs <= 0) return;
  console.warn(
    `[whatsapp] cooldown ativo (${current.consecutiveFailures} falha(s) consecutiva(s)) — próxima tentativa às ${current.nextRetryAt.toLocaleTimeString("pt-BR")}, aguardando ${Math.round(waitMs / 1000)}s`
  );
  await sleep(waitMs);
}

async function recordConnectionFailure(reasonLabel: string): Promise<void> {
  const current = await prisma.integrationStatus.findUnique({ where: { channel: "whatsapp" } });
  const consecutiveFailures = (current?.consecutiveFailures ?? 0) + 1;
  const backoffMs = Math.min(30_000 * 2 ** consecutiveFailures, 60 * 60 * 1000);
  const nextRetryAt = new Date(Date.now() + backoffMs);
  console.warn(
    `[whatsapp] ${reasonLabel} — falha consecutiva #${consecutiveFailures}, próxima tentativa em ${Math.round(backoffMs / 1000)}s`
  );
  await setIntegrationStatus("whatsapp", { consecutiveFailures, nextRetryAt });
}

// Self-scheduling like the jobs worker's loop, not setInterval — a send
// involves real network I/O to WhatsApp, and a stopped flag (below) needs to
// take effect between iterations rather than racing a fresh setInterval firing.
async function sendPollLoop(sock: WASocket): Promise<void> {
  while (sendLoopRunning) {
    const start = Date.now();
    try {
      const jobs = await claim(["send"], 1);
      for (const job of jobs) {
        try {
          await handleSend(job, { sock, ownWid: ownWid! });
        } catch (error) {
          console.error(`[whatsapp] job send (${job.id}) falhou`, error);
          await fail(job.id, error, job.attempts, job.maxAttempts);
        }
      }
    } catch (error) {
      console.error("[whatsapp] falha ao consumir fila de envio", error);
    }
    await sleep(Math.max(0, 5_000 - (Date.now() - start)));
  }
}

async function start() {
  await waitForCooldown();
  await setIntegrationStatus("whatsapp", { state: "CONNECTING" });

  // eslint-disable-next-line react-hooks/rules-of-hooks -- not a React hook, just named like one
  const { state, saveCreds } = await useMultiFileAuthState(env.WHATSAPP_AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger,
    auth: state,
    syncFullHistory: true,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    void handleConnectionUpdate(update).catch((error) =>
      console.error("[whatsapp] falha ao processar connection.update", error)
    );
  });

  async function handleConnectionUpdate(update: Partial<ConnectionState>) {
    const { connection, qr, lastDisconnect } = update;

    if (qr) {
      console.log("[whatsapp] escaneie o QR code abaixo com o WhatsApp do celular:");
      qrcode.generate(qr, { small: true });
      await setIntegrationStatus("whatsapp", { state: "NEEDS_QR", qrPayload: qr });
    }

    if (connection === "open") {
      ownWid = sock.user?.id ?? null;
      console.log(`[whatsapp] sessão conectada como ${ownWid}`);
      await setIntegrationStatus("whatsapp", {
        state: "CONNECTED",
        qrPayload: null,
        sessionStartedAt: new Date(),
        lastError: null,
        ownWid,
        consecutiveFailures: 0,
        nextRetryAt: null,
      });

      sendLoopRunning = true;
      void sendPollLoop(sock);
    }

    if (connection === "close") {
      sendLoopRunning = false;
      const statusCode = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      console.error(
        `[whatsapp] conexão fechada (status ${statusCode}) — ${loggedOut ? "logout, precisa de QR novo" : "vai reconectar"}`
      );

      if (loggedOut) {
        await setIntegrationStatus("whatsapp", {
          state: "AUTH_FAILURE",
          lastError: `logged out (status ${statusCode})`,
        });
        // Clear now-dead credentials so the next boot starts genuinely fresh and
        // emits a QR immediately, instead of retrying invalid creds forever.
        await rm(env.WHATSAPP_AUTH_DIR, { recursive: true, force: true });
      } else {
        await setIntegrationStatus("whatsapp", {
          state: "DISCONNECTED",
          lastError: `connection closed (status ${statusCode})`,
        });
      }
      await recordConnectionFailure(loggedOut ? "logout" : "desconexão");
      // systemd Restart=always brings the process back up quickly either way —
      // waitForCooldown() at the top of start() is what actually paces retries.
      process.exit(1);
    }
  }

  sock.ev.on("messages.upsert", (upsert) => {
    if (upsert.type !== "notify" || !ownWid) return;
    void (async () => {
      for (const msg of upsert.messages) {
        if (!shouldIngest(msg)) continue;
        try {
          await ingestMessage(msg, { ownWid: ownWid!, sock });
        } catch (error) {
          console.error("[whatsapp] falha ao ingerir mensagem", error);
        }
      }
    })();
  });

  sock.ev.on("messaging-history.set", ({ chats, contacts, messages }) => {
    void (async () => {
      try {
        await upsertChats(chats);
        await upsertContacts(contacts);
        if (ownWid) {
          for (const msg of messages) {
            if (!shouldIngest(msg)) continue;
            await ingestMessage(msg, { ownWid, sock });
          }
        }
        console.log(
          `[whatsapp] histórico sincronizado: ${chats.length} chats, ${contacts.length} contatos, ${messages.length} mensagens`
        );
      } catch (error) {
        console.error("[whatsapp] falha ao processar sincronização de histórico (conexão segue viva)", error);
      }
    })();
  });

  sock.ev.on("contacts.upsert", (contacts) => {
    void upsertContacts(contacts).catch((error) =>
      console.error("[whatsapp] falha ao atualizar contatos", error)
    );
  });
  sock.ev.on("contacts.update", (contacts) => {
    void upsertContacts(contacts).catch((error) =>
      console.error("[whatsapp] falha ao atualizar contatos", error)
    );
  });
  sock.ev.on("chats.upsert", (chats) => {
    void upsertChats(chats).catch((error) => console.error("[whatsapp] falha ao atualizar chats", error));
  });

  setInterval(() => {
    void setIntegrationStatus("whatsapp", {});
  }, 60_000);
}

start().catch((error) => {
  console.error("[whatsapp] falha ao iniciar", error);
  process.exit(1);
});
