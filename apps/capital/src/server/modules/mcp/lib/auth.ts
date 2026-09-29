import { HTTPException } from "hono/http-exception";
import type { Context } from "hono";

/**
 * MCP Bearer token authentication
 * 
 * Validates the bearer token from the Authorization header against the
 * MCP_API_KEY environment variable.
 * 
 * Required header: Authorization: Bearer <token>
 */
export function validateMcpAuth(c: Context): void {
  const authHeader = c.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new HTTPException(401, {
      message: "Missing or invalid Authorization header. Expected: Bearer <token>",
    });
  }

  const token = authHeader.slice(7); // Remove "Bearer " prefix
  const expectedToken = process.env.MCP_API_KEY;

  if (!expectedToken) {
    throw new HTTPException(500, {
      message: "MCP_API_KEY not configured on server",
    });
  }

  if (token !== expectedToken) {
    throw new HTTPException(401, {
      message: "Invalid API key",
    });
  }
}
