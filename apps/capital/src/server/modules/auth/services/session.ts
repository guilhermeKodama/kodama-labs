import type { PrismaClient } from "@/generated/prisma";
import { SESSION_EXPIRY_DAYS } from "../constants";

export async function createSession(
  userId: string,
  prisma: PrismaClient
): Promise<string> {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_EXPIRY_DAYS);

  const session = await prisma.session.create({
    data: {
      userId,
      expiresAt,
    },
  });

  return session.id;
}

export async function validateSession(
  sessionId: string,
  prisma: PrismaClient
): Promise<{ userId: string } | null> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
  });

  if (!session) {
    return null;
  }

  // Check if session has expired
  if (new Date() > session.expiresAt) {
    // Clean up expired session
    await prisma.session.delete({ where: { id: sessionId } });
    return null;
  }

  return { userId: session.userId };
}

export async function deleteSession(
  sessionId: string,
  prisma: PrismaClient
): Promise<void> {
  await prisma.session.deleteMany({
    where: { id: sessionId },
  });
}

export async function deleteUserSessions(
  userId: string,
  prisma: PrismaClient
): Promise<void> {
  await prisma.session.deleteMany({
    where: { userId },
  });
}
