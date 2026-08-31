import { hc } from "hono/client";
import type { AppType } from "@capital/server/app";

/**
 * Create the base URL for API requests.
 * On the client, use the window origin.
 * On the server, this needs to be the full URL.
 */
const getBaseUrl = () => {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  // For server-side rendering, use the NEXT_PUBLIC_APP_URL or localhost
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
};

/**
 * Type-safe Hono API client for the Capital backend.
 * 
 * Note: All API calls are authenticated via session cookies.
 * The userId is automatically extracted from the session on the backend.
 *
 * Usage:
 * ```ts
 * import { client } from '@/lib/api-client';
 *
 * // Get businesses (for the authenticated user)
 * const res = await client.v1.businesses.$get();
 * const businesses = await res.json();
 *
 * // Create transaction
 * const res = await client.v1.transactions.$post({
 *   json: {
 *     entityType: 'business',
 *     type: 'income',
 *     amount: 1000,
 *     currency: 'USD',
 *     description: 'Client payment',
 *     category: 'Client Payment',
 *     date: new Date().toISOString(),
 *     businessId: 'business-123',
 *   }
 * });
 * ```
 */
export const client = hc<AppType>(`${getBaseUrl()}/api`, {
  fetch: (input: RequestInfo | URL, init?: RequestInit) =>
    fetch(input, {
      ...init,
      credentials: "include",
      // Every store fetch is meant to reflect the current server state —
      // stores are the app's only cache layer. Without this, the browser's
      // HTTP cache could serve a stale GET after a mutating POST/PUT/DELETE
      // (this bit fire-store's /summary specifically; see git history).
      cache: "no-store",
    }),
});

/**
 * Helper function to handle API responses with error handling.
 */
export async function apiRequest<T>(
  request: Promise<Response>
): Promise<{ data: T | null; error: string | null }> {
  try {
    const response = await request;

    if (!response.ok) {
      const errorData = (await response.json()) as { error?: { message?: string } };
      return {
        data: null,
        error: errorData.error?.message ?? `Request failed with status ${response.status}`,
      };
    }

    const data = (await response.json()) as T;
    return { data, error: null };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}
