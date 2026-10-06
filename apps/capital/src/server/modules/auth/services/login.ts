import type { PrismaClient } from "@/generated/prisma";
import { verifyPassword } from "./password";

interface LoginInput {
  email: string;
  password: string;
}

export async function login(input: LoginInput, prisma: PrismaClient) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user) throw new Error("Invalid email or password");
  const isValid = await verifyPassword(input.password, user.passwordHash);
  if (!isValid) throw new Error("Invalid email or password");
  return user;
}
