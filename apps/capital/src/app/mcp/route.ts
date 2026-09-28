import { NextRequest, NextResponse } from "next/server";
import { handleMcpRequest } from "@capital/server/modules/mcp/lib/handler";
import { prisma } from "@capital/server/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

/**
 * MCP Server endpoint for remote accounting operations.
 * 
 * This endpoint exposes MCP tools over JSON-RPC for external AI assistants
 * like Contador to read and write accounting data.
 * 
 * Authentication:
 * - Cloudflare Access: CF-Access-Client-Id / CF-Access-Client-Secret headers
 * - App-level: Bearer token in Authorization header (MCP_API_KEY env var)
 * 
 * Both layers are enforced. Cloudflare Access is configured in the dashboard.
 * 
 * Usage:
 * 1. Set MCP_API_KEY and MCP_USER_ID in .env.production
 * 2. Configure Cloudflare Access to allow service tokens on /mcp path
 * 3. MCP clients send JSON-RPC requests to https://capital.kodamalabs.ai/mcp
 */
export async function POST(request: NextRequest) {
  try {
    // Validate MCP bearer token authentication
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Missing or invalid Authorization header" },
        { status: 401 }
      );
    }

    const token = authHeader.slice(7);
    const expectedToken = process.env.MCP_API_KEY;

    if (!expectedToken) {
      return NextResponse.json(
        { error: "MCP_API_KEY not configured" },
        { status: 500 }
      );
    }

    if (token !== expectedToken) {
      return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
    }

    // Get the user ID from environment
    const userId = process.env.MCP_USER_ID;
    if (!userId) {
      return NextResponse.json(
        { error: "MCP_USER_ID not configured" },
        { status: 500 }
      );
    }

    // Parse JSON-RPC request
    const body = await request.json();
    const { jsonrpc, id, method, params } = body;

    if (jsonrpc !== "2.0") {
      return NextResponse.json(
        {
          jsonrpc: "2.0",
          id: id || null,
          error: {
            code: -32600,
            message: "Invalid Request: jsonrpc must be '2.0'",
          },
        },
        { status: 400 }
      );
    }

    // Handle MCP request
    try {
      const result = await handleMcpRequest(userId, prisma, { method, params });

      return NextResponse.json({
        jsonrpc: "2.0",
        id,
        result,
      });
    } catch (error) {
      return NextResponse.json({
        jsonrpc: "2.0",
        id: id || null,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  } catch (error) {
    console.error("MCP endpoint error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
