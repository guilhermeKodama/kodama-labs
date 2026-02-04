import { createRouter } from "@capital/server/lib/create-app";

import * as postSignup from "./post-signup";
import * as postLogin from "./post-login";
import * as postLogout from "./post-logout";
import * as getMe from "./get-me";

const router = createRouter()
  .openapi(postSignup.route, postSignup.handler)
  .openapi(postLogin.route, postLogin.handler)
  .openapi(postLogout.route, postLogout.handler)
  .openapi(getMe.route, getMe.handler);

export default router;
