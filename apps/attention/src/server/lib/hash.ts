import { createHash } from "node:crypto";
import { env } from "../../env";

export function hashIdentifier(value: string): string {
  return createHash("sha256").update(`${env.WHATSAPP_HASH_SALT}:${value}`).digest("hex");
}
