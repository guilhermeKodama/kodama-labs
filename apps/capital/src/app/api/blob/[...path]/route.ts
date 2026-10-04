import { runtimeAppUrl } from "@repo/storage";
import { createLocalBlobHandler } from "@repo/storage/next";
import { env } from "@/env";

export const GET = createLocalBlobHandler({
  localDir: env.CAPITAL_BLOB_DIR,
  appUrl: runtimeAppUrl(env.NEXT_PUBLIC_APP_URL),
});
