import { NextRequest } from "next/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createCapitalMcpServer } from "@capital/server/modules/mcp/lib/mcp-server";
import { prisma } from "@capital/server/lib/prisma";
import crypto from "crypto";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;
// Allow up to 15MB request body to support 10MB files as base64 (~13.3MB)
export const bodyParser = {
  sizeLimit: "15mb",
};

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");

  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * MCP Server endpoint for remote accounting operations.
 *
 * This endpoint implements the MCP Streamable HTTP transport specification
 * for external AI assistants like Contador to read and write accounting data.
 *
 * Authentication (two layers):
 * 1. Cloudflare Access: CF-Access-Client-Id / CF-Access-Client-Secret headers
 *    (validated at tunnel level before reaching this handler)
 * 2. App-level: Bearer token in Authorization header (MCP_API_KEY env var)
 *
 * Transport: Streamable HTTP (stateless mode) following MCP specification:
 * - POST: Handle JSON-RPC requests (initialize, tools/list, tools/call, etc.)
 * - GET: 405 Method Not Allowed (stateless mode)
 * - DELETE: 405 Method Not Allowed (stateless mode)
 *
 * Usage:
 * 1. Set MCP_API_KEY and MCP_USER_ID in .env.production
 * 2. Configure Cloudflare Access service tokens
 * 3. MCP clients send requests to https://capital.kodamalabs.ai/mcp
 */

/**
 * Validate bearer token authentication.
 * Returns 401 with WWW-Authenticate header if invalid.
 */
function validateAuth(request: NextRequest): Response | null {
  const authHeader = request.headers.get("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return new Response("Unauthorized", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Bearer realm="MCP API"',
      },
    });
  }

  const token = authHeader.slice(7); // Remove "Bearer " prefix
  const expectedToken = process.env.MCP_API_KEY;

  if (!expectedToken) {
    console.error("MCP_API_KEY not configured");
    return new Response("Internal Server Error", {
      status: 500,
    });
  }

  if (!timingSafeEqual(token, expectedToken)) {
    return new Response("Unauthorized", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Bearer realm="MCP API"',
      },
    });
  }

  return null; // Auth successful
}

/**
 * Handle MCP requests with Streamable HTTP transport.
 */
async function handleMcpRequest(request: NextRequest): Promise<Response> {
  // Validate authentication first
  const authError = validateAuth(request);
  if (authError) {
    return authError;
  }

  // Get user ID from environment
  const userId = process.env.MCP_USER_ID;
  if (!userId) {
    console.error("MCP_USER_ID not configured");
    return new Response("Internal Server Error", { status: 500 });
  }

  // Create MCP server and transport
  const mcpServer = createCapitalMcpServer(userId, prisma);

  // Create stateless transport (no session management)
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // Stateless mode
    enableJsonResponse: true, // Prefer JSON responses over SSE for simple request/response
  });

  // Connect server to transport
  await mcpServer.connect(transport);

  try {
    // Handle the HTTP request using the transport
    const response = await transport.handleRequest(request);
    return response;
  } finally {
    // Clean up
    await mcpServer.close();
  }
}

export async function POST(request: NextRequest) {
  try {
    return await handleMcpRequest(request);
  } catch (error) {
    console.error("MCP endpoint error:", error);
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        message: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

/**
 * GET and DELETE are not supported in stateless mode.
 * Return 405 Method Not Allowed.
 */
export async function GET() {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: {
      Allow: "POST",
    },
  });
}

export async function DELETE() {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: {
      Allow: "POST",
    },
  });
}
