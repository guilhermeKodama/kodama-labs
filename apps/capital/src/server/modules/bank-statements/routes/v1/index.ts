import { createRouter } from "@capital/server/lib/create-app";

import * as postParse from "./post-parse";
import * as postImport from "./post-import";
import * as getImports from "./get-imports";

const router = createRouter()
  .openapi(postParse.route, postParse.handler)
  .openapi(postImport.route, postImport.handler)
  .openapi(getImports.route, getImports.handler);

export default router;
