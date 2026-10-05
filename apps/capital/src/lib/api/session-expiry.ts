import { loginPath } from "@/lib/middleware-helpers";
import { ApiError } from "./client";

/**
 * What happens when the API says the session is gone (any query or
 * mutation answering 401): end the session, drop every cached answer and
 * go to /login?redirect=<where the user was>, once however many requests
 * fail at the same time. The logout call deletes the session cookie;
 * without it the middleware would send /login straight back to the app.
 *
 * Wired into the QueryClient's QueryCache and MutationCache (query-provider.tsx).
 */

/** A 401, except a wrong password on the login form, which is not an expired session. */
export function isSessionExpired(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401 && error.code !== "auth.invalid_credentials";
}

const PUBLIC_PATHS = ["/login", "/signup"];

export interface SessionExpiryDeps {
  /** POST /v2/auth/logout. */
  logout: () => Promise<unknown>;
  /** Drops the query cache. */
  clear: () => void;
  navigate: (href: string) => void;
  /** Path plus query of the current page. */
  currentUrl: () => string;
}

export interface SessionExpiry {
  /** Call with every request error; returns true when it started the logout. */
  handle: (error: unknown) => boolean;
  /** "Sair": the same steps, to the plain login page. */
  signOut: () => void;
  /** The user is signed in again (the session query succeeded): a later 401 is handled again. */
  reset: () => void;
}

export function createSessionExpiry(deps: SessionExpiryDeps): SessionExpiry {
  // Set from the first 401 (or Sair) until the next sign-in, so the
  // requests that fail meanwhile (the cleared cache refetching) do nothing.
  let leaving = false;
  const leave = (href: string) => {
    leaving = true;
    void deps
      .logout()
      .catch(() => undefined)
      .then(() => {
        deps.clear();
        deps.navigate(href);
      });
  };
  return {
    handle: (error) => {
      if (leaving || !isSessionExpired(error)) return false;
      const current = deps.currentUrl();
      if (PUBLIC_PATHS.includes(current.split(/[?#]/)[0])) return false;
      leave(loginPath(current));
      return true;
    },
    signOut: () => {
      if (!leaving) leave("/login");
    },
    reset: () => {
      leaving = false;
    },
  };
}
