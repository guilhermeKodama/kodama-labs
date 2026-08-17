import { prisma } from "../lib/prisma";

type IntegrationStatusUpdate = {
  state?: string;
  lastMessageAt?: Date;
  qrPayload?: string | null;
  sessionStartedAt?: Date | null;
  lastError?: string | null;
  ownWid?: string | null;
};

export async function setIntegrationStatus(
  channel: string,
  update: IntegrationStatusUpdate
) {
  await prisma.integrationStatus.upsert({
    where: { channel },
    create: { channel, state: update.state ?? "CONNECTING", ...update },
    update: { ...update, lastEventAt: new Date() },
  });
}
