import { NextRequest } from "next/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createCapitalMcpServer } from "@capital/server/modules/mcp/lib/mcp-server";
import { authenticateMcpRequest, McpConfigError, recordMcpClient, type McpPrincipal } from "@capital/server/modules/mcp/lib/auth";
import { prisma } from "@capital/server/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Body size limits for App Router route handlers:
 * - Next.js App Router (14+) streams request bodies with no built-in size limit
 * - The MCP WebStandardStreamableHTTPServerTransport reads the body via request.json()
 * - V8's JSON.parse has practical limits (~512MB-1GB depending on available memory)
 * - For 10MB files as base64 (~13.3MB), this is well within limits
 * - Production testing confirms 10MB+ payloads work without configuration
 */

/**
 * MCP Server endpoint for remote accounting operations.
 *
 * This endpoint implements the MCP Streamable HTTP transport specification
 * for external AI assistants (Cursor, Claude, …) to read and write
 * accounting data.
 *
 * Authentication (two layers):
 * 1. Cloudflare Access: CF-Access-Client-Id / CF-Access-Client-Secret headers
 *    (validated at tunnel level before reaching this handler)
 * 2. App-level: `Authorization: Bearer <token>` with a personal API token
 *    from Ajustes › Integrações e API (cap_live_…; read-only tokens get only
 *    the read tools), or the server's MCP_API_KEY acting as MCP_USER_ID.
 *
 * Transport: Streamable HTTP (stateless mode) following MCP specification:
 * - POST: Handle JSON-RPC requests (initialize, tools/list, tools/call, etc.)
 * - GET: 405 Method Not Allowed (stateless mode)
 * - DELETE: 405 Method Not Allowed (stateless mode)
 *
 * The clientInfo of each initialize is recorded on the token, for the
 * connected-clients table.
 */

const UNAUTHORIZED = () =>
  new Response("Unauthorized", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Bearer realm="MCP API"',
    },
  });

/** initialize requests are small; a body declared larger (file uploads) is not read twice. */
const CLIENT_INFO_PEEK_MAX_BYTES = 64 * 1024;

async function rememberClient(request: NextRequest, principal: McpPrincipal) {
  if (!principal.tokenId) return;
  const declared = request.headers.get("content-length");
  if (declared !== null && !(Number(declared) > 0 && Number(declared) <= CLIENT_INFO_PEEK_MAX_BYTES)) return;
  try {
    const body = await request.clone().json();
    await recordMcpClient(principal, body, prisma);
  } catch {
    // An unreadable body is the transport's to reject; the client record is best effort.
  }
}

/**
 * Handle MCP requests with Streamable HTTP transport.
 */
async function handleMcpRequest(request: NextRequest): Promise<Response> {
  let principal: McpPrincipal | null;
  try {
    principal = await authenticateMcpRequest(request.headers.get("Authorization"), prisma);
  } catch (error) {
    if (error instanceof McpConfigError) {
      console.error(error.message);
      return new Response("Internal Server Error", { status: 500 });
    }
    throw error;
  }
  if (!principal) return UNAUTHORIZED();

  await rememberClient(request, principal);

  // Create MCP server and transport
  const mcpServer = createCapitalMcpServer(principal.userId, prisma, { readOnly: principal.readOnly });

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
