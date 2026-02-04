import { createRouter } from "@capital/server/lib/create-app";

import * as getBusinesses from "./get-businesses";
import * as getBusinessById from "./get-business-by-id";
import * as postBusiness from "./post-business";
import * as putBusiness from "./put-business";
import * as deleteBusiness from "./delete-business";

const router = createRouter()
  .openapi(getBusinesses.route, getBusinesses.handler)
  .openapi(getBusinessById.route, getBusinessById.handler)
  .openapi(postBusiness.route, postBusiness.handler)
  .openapi(putBusiness.route, putBusiness.handler)
  .openapi(deleteBusiness.route, deleteBusiness.handler);

export default router;
