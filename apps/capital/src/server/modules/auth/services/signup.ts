import type { PrismaClient } from "@prisma/client";
import { hashPassword } from "./password";

interface SignupInput {
  email: string;
  password: string;
  name: string;
  baseCurrency?: string;
}

export async function signup(input: SignupInput, prisma: PrismaClient) {
  // Check if user already exists
  const existingUser = await prisma.user.findUnique({
    where: { email: input.email },
  });

  if (existingUser) {
    throw new Error("User with this email already exists");
  }

  // Hash the password
  const passwordHash = await hashPassword(input.password);

  // Create user with personal account
  const user = await prisma.user.create({
    data: {
      email: input.email,
      passwordHash,
      name: input.name,
      baseCurrency: input.baseCurrency || "USD",
      personalAccount: {
        create: {
          defaultCurrency: input.baseCurrency || "USD",
        },
      },
    },
    include: {
      personalAccount: true,
    },
  });

  return user;
}
