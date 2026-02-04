import type { PrismaClient } from "@prisma/client";
import { verifyPassword } from "./password";

interface LoginInput {
  email: string;
  password: string;
}

export async function login(input: LoginInput, prisma: PrismaClient) {
  // Find user by email
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    include: {
      personalAccount: true,
    },
  });

  if (!user) {
    throw new Error("Invalid email or password");
  }

  // Verify password
  const isValid = await verifyPassword(input.password, user.passwordHash);

  if (!isValid) {
    throw new Error("Invalid email or password");
  }

  return user;
}
