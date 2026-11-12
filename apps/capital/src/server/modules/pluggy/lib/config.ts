import { env } from "@/env";

/** Both credentials are required. A missing one leaves the sync off. */
export function isPluggyConfigured(): boolean {
  return Boolean(env.PLUGGY_CLIENT_ID && env.PLUGGY_CLIENT_SECRET);
}
