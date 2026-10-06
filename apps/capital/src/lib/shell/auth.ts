import { safeRedirect } from "@/lib/middleware-helpers";

/**
 * The login and signup pages. Both read `?redirect=` (set by the
 * middleware and by the session-expiry handler) to return the user to the
 * page they were sent away from, and pass it on when switching between
 * the two pages. A redirect that is not a path of this app is never
 * followed nor forwarded (safeRedirect).
 */

export type AuthMode = "login" | "signup";

export const MIN_PASSWORD_LENGTH = 8;

function redirectParam(search: string | URLSearchParams): string | null {
  return (typeof search === "string" ? new URLSearchParams(search) : search).get("redirect");
}

/** Where to go once signed in: `?redirect` when it is a safe app path, else Transações. */
export function authRedirectTarget(search: string | URLSearchParams): string {
  return safeRedirect(redirectParam(search));
}

/** The other auth page ("Criar uma conta" / "Entrar"), keeping a safe `?redirect`. */
export function authSwitchHref(to: AuthMode, search: string | URLSearchParams): string {
  const redirect = redirectParam(search);
  const keep = redirect !== null && safeRedirect(redirect) === redirect;
  return keep ? `/${to}?redirect=${encodeURIComponent(redirect)}` : `/${to}`;
}

export interface CredentialsInput {
  name: string;
  email: string;
  password: string;
}

export type CredentialsField = keyof CredentialsInput;
/** Message keys under auth.problems. */
export type CredentialsProblem = "required" | "email" | "passwordLength";
export type CredentialsProblems = Partial<Record<CredentialsField, CredentialsProblem>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Client-side checks before the request, matching the server's schema:
 * signup needs a name, a valid e-mail and a password of at least 8
 * characters; login needs an e-mail and a password.
 */
export function validateCredentials(mode: AuthMode, input: CredentialsInput): CredentialsProblems {
  const problems: CredentialsProblems = {};
  if (mode === "signup" && !input.name.trim()) problems.name = "required";
  const email = input.email.trim();
  if (!email) problems.email = "required";
  else if (!EMAIL.test(email)) problems.email = "email";
  if (!input.password) problems.password = "required";
  else if (mode === "signup" && input.password.length < MIN_PASSWORD_LENGTH) problems.password = "passwordLength";
  return problems;
}

/**
 * The fields to mark after a failed request: those named by a 422's issue
 * paths ("email", "password"…), and the e-mail when it is already taken.
 */
export function invalidCredentialFields(error: { code?: string | null; issues?: readonly { path: string }[] }): Set<CredentialsField> {
  const fields = new Set<CredentialsField>();
  for (const { path } of error.issues ?? []) {
    const field = path.split(".")[0];
    if (field === "name" || field === "email" || field === "password") fields.add(field);
  }
  if (error.code === "auth.email_taken") fields.add("email");
  return fields;
}

/** The request body for each page. Signup sends the language the form is shown in. */
export function credentialsBody(mode: AuthMode, input: CredentialsInput, locale: string) {
  const email = input.email.trim();
  return mode === "login" ? { email, password: input.password } : { name: input.name.trim(), email, password: input.password, locale };
}
