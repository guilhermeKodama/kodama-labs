import { createLocalBlobHandler } from "@repo/storage/next";
import { localBlobStorageOpts } from "@/server/lib/storage";

export const GET = createLocalBlobHandler(localBlobStorageOpts());
