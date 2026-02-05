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
 * Usage:
 * ```ts
 * import { client } from '@/lib/api-client';
 *
 * // Get businesses
 * const res = await client.v1.businesses.$get({
 *   query: { userId: 'user-123' }
 * });
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
  fetch: (input, init) =>
    fetch(input, {
      ...init,
      credentials: "include",
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
