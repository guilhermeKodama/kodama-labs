import { env } from "@/env";

/** Whether the sign-up route and page take new accounts (SIGNUP_OPEN, closed by default). */
export function signupIsOpen(): boolean {
  return env.SIGNUP_OPEN === "true";
}
