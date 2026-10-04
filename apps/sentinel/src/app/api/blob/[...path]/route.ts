import { createLocalBlobHandler } from "@repo/storage/next";
import { env } from "@/env";

export const GET = createLocalBlobHandler({
  localDir: env.SENTINEL_BLOB_DIR,
  appUrl: env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3002",
});
