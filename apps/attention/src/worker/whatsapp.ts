import { Client, LocalAuth } from "whatsapp-web.js";
import qrcode from "qrcode-terminal";
import { prisma } from "../server/lib/prisma";
import { hashIdentifier } from "../server/lib/hash";
import { env } from "../env";

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: env.WHATSAPP_AUTH_DIR }),
  puppeteer: {
    headless: true,
    executablePath: env.WHATSAPP_CHROMIUM_PATH || undefined,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

client.on("qr", (qr) => {
  console.log("[whatsapp] escaneie o QR code abaixo com o WhatsApp do celular:");
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  console.log("[whatsapp] sessão conectada");
});

client.on("disconnected", (reason) => {
  console.error("[whatsapp] desconectado:", reason);
});

// message_create (não message) captura envios do próprio número junto com os recebidos,
// necessário para gerar direction: OUT.
client.on("message_create", async (message) => {
  try {
    const chat = await message.getChat();
    await prisma.whatsAppMessageMeta.create({
      data: {
        chatIdHash: hashIdentifier(chat.id._serialized),
        senderHash: hashIdentifier(message.author || message.from || "unknown"),
        isGroup: chat.isGroup,
        direction: message.fromMe ? "OUT" : "IN",
        length: message.body?.length ?? 0,
        occurredAt: new Date(message.timestamp * 1000),
      },
    });
  } catch (error) {
    console.error("[whatsapp] falha ao gravar metadado", error);
  }
});

client.initialize();
