import { createRouter } from "@capital/server/lib/create-app";

import * as postAttachment from "./post-attachment";
import * as getAttachments from "./get-attachments";
import * as deleteAttachment from "./delete-attachment";

const router = createRouter()
  .openapi(getAttachments.route, getAttachments.handler)
  .openapi(postAttachment.route, postAttachment.handler)
  .openapi(deleteAttachment.route, deleteAttachment.handler);

export default router;
