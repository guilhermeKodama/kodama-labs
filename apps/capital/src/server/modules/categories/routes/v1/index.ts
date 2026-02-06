import { createRouter } from "@capital/server/lib/create-app";

import * as getCategories from "./get-categories";
import * as postCategory from "./post-category";
import * as deleteCategory from "./delete-category";

const router = createRouter()
  .openapi(getCategories.route, getCategories.handler)
  .openapi(postCategory.route, postCategory.handler)
  .openapi(deleteCategory.route, deleteCategory.handler);

export default router;
