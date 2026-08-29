import { createRouter } from "@capital/server/lib/create-app";

import * as postConversation from "./post-conversation";
import * as getConversations from "./get-conversations";
import * as getConversation from "./get-conversation";
import * as deleteConversation from "./delete-conversation";
import * as postFile from "./post-file";
import * as postCancel from "./post-cancel";
import { confirmRoute, confirmHandler, rejectRoute, rejectHandler } from "./post-plan-confirm";
import { postMessageHandler } from "./post-message";

const router = createRouter()
  .openapi(postConversation.route, postConversation.handler)
  .openapi(getConversations.route, getConversations.handler)
  .openapi(getConversation.route, getConversation.handler)
  .openapi(deleteConversation.route, deleteConversation.handler)
  .openapi(postFile.route, postFile.handler)
  .openapi(postCancel.route, postCancel.handler)
  .openapi(confirmRoute, confirmHandler)
  .openapi(rejectRoute, rejectHandler)
  // Not OpenAPI-typed: SSE response, documented in agent/events.ts instead.
  .post("/v1/assistant/conversations/:id/messages", postMessageHandler);

export default router;
