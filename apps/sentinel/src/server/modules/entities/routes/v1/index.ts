import { createRouter } from "@sentinel/server/lib/create-app";

import * as listEntities from "./list-entities";

const router = createRouter().openapi(
  listEntities.route,
  listEntities.handler
);

export default router;
