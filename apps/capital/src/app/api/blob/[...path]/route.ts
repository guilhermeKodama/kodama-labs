import { createLocalBlobHandler } from "@repo/storage/next";
import { env } from "@/env";

export const GET = createLocalBlobHandler({
  token: env.BLOB_READ_WRITE_TOKEN,
  appUrl: env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
});
