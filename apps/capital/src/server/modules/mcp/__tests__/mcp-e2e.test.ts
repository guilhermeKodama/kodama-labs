import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { POST, GET, DELETE } from "@/app/mcp/route";
import { prisma } from "@capital/server/lib/prisma";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { NextRequest } from "next/server";

// Test utilities
function createMockNextRequest(
  method: string,
  body?: unknown,
  headers: Record<string, string> = {}
): unknown {
  const url = "http://localhost:3000/mcp";
  const init: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...headers,
    },
  };

  if (body) {
    init.body = JSON.stringify(body);
  }

  return new Request(url, init);
}

describe("MCP Server End-to-End", () => {
  const TEST_API_KEY = "test-api-key-for-mcp-e2e";
  const TEST_USER_ID = "test-user-mcp-e2e-001";
  let personalAccountId: string;

  beforeAll(async () => {
    // Set environment variables for tests
    process.env.MCP_API_KEY = TEST_API_KEY;
    process.env.MCP_USER_ID = TEST_USER_ID;

    // Clean up and create test data
    await prisma.transaction.deleteMany({
      where: {
        OR: [
          { business: { userId: TEST_USER_ID } },
          { personalAccount: { userId: TEST_USER_ID } },
        ],
      },
    });
    await prisma.personalAccount.deleteMany({ where: { userId: TEST_USER_ID } });
    await prisma.category.deleteMany({ where: { userId: TEST_USER_ID } });
    await prisma.user.deleteMany({ where: { id: TEST_USER_ID } });

    // Create test user
    await prisma.user.create({
      data: {
        id: TEST_USER_ID,
        email: "mcp-e2e-test@example.com",
        passwordHash: "test-hash",
        name: "MCP E2E Test User",
        baseCurrency: "BRL",
      },
    });

    // Create personal account
    const personalAccount = await prisma.personalAccount.create({
      data: {
        userId: TEST_USER_ID,
        defaultCurrency: "BRL",
      },
    });
    personalAccountId = personalAccount.id;

    // Create test category
    await prisma.category.create({
      data: {
        userId: TEST_USER_ID,
        name: "Dividends",
        type: "income",
        isSystem: true,
      },
    });
  });

  afterAll(async () => {
    // Clean up
    await prisma.transaction.deleteMany({
      where: {
        OR: [
          { business: { userId: TEST_USER_ID } },
          { personalAccount: { userId: TEST_USER_ID } },
        ],
      },
    });
    await prisma.personalAccount.deleteMany({ where: { userId: TEST_USER_ID } });
    await prisma.category.deleteMany({ where: { userId: TEST_USER_ID } });
    await prisma.user.deleteMany({ where: { id: TEST_USER_ID } });

    delete process.env.MCP_API_KEY;
    delete process.env.MCP_USER_ID;
  });

  describe("Authentication", () => {
    it("should reject requests without Authorization header", async () => {
      const request = createMockNextRequest("POST", {
        jsonrpc: "2.0",
        method: "initialize",
        params: {},
        id: 1,
      });

      const response = await POST(request as unknown as NextRequest);
      expect(response.status).toBe(401);
      expect(response.headers.get("WWW-Authenticate")).toBe('Bearer realm="MCP API"');
    });

    it("should reject requests with invalid bearer token", async () => {
      const request = createMockNextRequest(
        "POST",
        {
          jsonrpc: "2.0",
          method: "initialize",
          params: {},
          id: 1,
        },
        {
          Authorization: "Bearer wrong-token",
        }
      );

      const response = await POST(request as unknown as NextRequest);
      expect(response.status).toBe(401);
      expect(response.headers.get("WWW-Authenticate")).toBe('Bearer realm="MCP API"');
    });
  });

  describe("HTTP Methods", () => {
    it("should return 405 for GET requests", async () => {
      const response = await GET();
      expect(response.status).toBe(405);
      expect(response.headers.get("Allow")).toBe("POST");
    });

    it("should return 405 for DELETE requests", async () => {
      const response = await DELETE();
      expect(response.status).toBe(405);
      expect(response.headers.get("Allow")).toBe("POST");
    });
  });

  describe("MCP Protocol", () => {
    it("should handle initialize request", async () => {
      const request = createMockNextRequest(
        "POST",
        {
          jsonrpc: "2.0",
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: {
              name: "test-client",
              version: "1.0.0",
            },
          },
          id: 1,
        },
        {
          Authorization: `Bearer ${TEST_API_KEY}`,
        }
      );

      const response = await POST(request as unknown as NextRequest);
      
      // Debug: log response if not 200
      if (response.status !== 200) {
        const text = await response.clone().text();
        console.error(`Response status: ${response.status}, body:`, text);
      }
      
      expect(response.status).toBe(200);

      const data = (await response.json()) as Record<string, unknown>;
      expect(data.jsonrpc).toBe("2.0");
      expect(data.id).toBe(1);
      expect(data.result).toHaveProperty("protocolVersion");
      expect(data.result).toHaveProperty("capabilities");
      expect(data.result).toHaveProperty("serverInfo");
      const result = data.result as {
        serverInfo: { name: string; version: string };
      };
      expect(result.serverInfo.name).toBe("capital-accounting");
      expect(result.serverInfo.version).toBe("1.0.0");
    });

    it("should handle tools/list request", async () => {
      // First initialize
      const initRequest = createMockNextRequest(
        "POST",
        {
          jsonrpc: "2.0",
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "test-client", version: "1.0.0" },
          },
          id: 1,
        },
        { Authorization: `Bearer ${TEST_API_KEY}` }
      );
      await POST(initRequest as unknown as NextRequest);

      // Then list tools
      const request = createMockNextRequest(
        "POST",
        {
          jsonrpc: "2.0",
          method: "tools/list",
          params: {},
          id: 2,
        },
        {
          Authorization: `Bearer ${TEST_API_KEY}`,
        }
      );

      const response = await POST(request as unknown as NextRequest);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.jsonrpc).toBe("2.0");
      expect(data.id).toBe(2);
      expect(data.result).toHaveProperty("tools");
      expect(Array.isArray(data.result.tools)).toBe(true);
      expect(data.result.tools.length).toBe(21); // 10 original + 3 attachment + 5 budget + 3 statement tools

      // Check for expected tools
      const result = data.result as { tools: Array<{ name: string }> };
      const toolNames = result.tools.map((t) => t.name);
      expect(toolNames).toContain("bulk_create_transactions");
      expect(toolNames).toContain("list_transactions");
      expect(toolNames).toContain("adjust_position");
      expect(toolNames).toContain("import_credit_card_statement");
      expect(toolNames).toContain("mark_transaction_as_card_settlement");
      expect(toolNames).toContain("get_credit_card_statement");
    });

    it("should handle tools/call with bulk_create_transactions in dry-run mode", async () => {
      // Initialize first
      const initRequest = createMockNextRequest(
        "POST",
        {
          jsonrpc: "2.0",
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "test-client", version: "1.0.0" },
          },
          id: 1,
        },
        { Authorization: `Bearer ${TEST_API_KEY}` }
      );
      await POST(initRequest as unknown as NextRequest);

      // Call bulk_create_transactions
      const request = createMockNextRequest(
        "POST",
        {
          jsonrpc: "2.0",
          method: "tools/call",
          params: {
            name: "bulk_create_transactions",
            arguments: {
              transactions: [
                {
                  entityType: "personal",
                  type: "income",
                  amount: 50.75,
                  currency: "BRL",
                  description: "PMLL11 - Test Dividend",
                  category: "Dividends",
                  date: "2026-09-15",
                  personalAccountId,
                },
              ],
              dryRun: true,
            },
          },
          id: 3,
        },
        {
          Authorization: `Bearer ${TEST_API_KEY}`,
        }
      );

      const response = await POST(request as unknown as NextRequest);
      expect(response.status).toBe(200);

      const data = (await response.json()) as Record<string, unknown>;
      expect(data.jsonrpc).toBe("2.0");
      expect(data.id).toBe(3);
      expect(data.result).toHaveProperty("content");
      const result = data.result as { content: Array<{ type: string; text: string }> };
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content[0].type).toBe("text");

      const resultText = JSON.parse(result.content[0].text) as {
        created: unknown[];
        duplicates: unknown[];
        errors: unknown[];
      };
      expect(resultText).toHaveProperty("created");
      expect(resultText).toHaveProperty("duplicates");
      expect(resultText).toHaveProperty("errors");
      expect((resultText.created as Array<{ id: string }>).length).toBe(1);
      expect((resultText.created as Array<{ id: string }>)[0].id).toBe("dry-run");

      // Verify nothing was actually created
      const count = await prisma.transaction.count({
        where: { personalAccountId },
      });
      expect(count).toBe(0);
    });
  });

  describe("MCP Client Integration", () => {
    it("should work with official MCP SDK client", async () => {
      // Create a mock transport that uses our route handler
      class TestTransport {
        private headers: Record<string, string>;

        constructor(headers: Record<string, string>) {
          this.headers = headers;
        }

        async start() {}

        async close() {}

        async send(message: unknown) {
          const request = createMockNextRequest("POST", message, this.headers);
          const response = await POST(request as unknown as NextRequest);

          // HTTP 202 Accepted (for notifications/initialized) - no response body expected
          if (response.status === 202) {
            return;
          }

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const data = (await response.json()) as Record<string, unknown>;

          // Simulate receiving the response
          if (this.onmessage) {
            this.onmessage(data);
          }
        }

        onmessage?: (message: unknown) => void;
        onerror?: (error: Error) => void;
        onclose?: () => void;
      }

      const transport = new TestTransport({
        Authorization: `Bearer ${TEST_API_KEY}`,
      });

      const client = new Client(
        {
          name: "test-client",
          version: "1.0.0",
        },
        {
          capabilities: {},
        }
      );

      await client.connect(transport as unknown as Transport);

      // List tools
      const tools = await client.listTools();
      expect(tools.tools.length).toBe(21); // 10 original + 3 attachment + 5 budget + 3 statement tools
      const toolNames = tools.tools.map((tool) => tool.name);
      expect(toolNames).toContain("import_credit_card_statement");
      expect(toolNames).toContain("mark_transaction_as_card_settlement");
      expect(toolNames).toContain("get_credit_card_statement");

      // Call a tool
      const result = await client.callTool({
        name: "get_valid_types",
        arguments: {},
      }) as { content: Array<{ type: string; text: string }> };

      const content = result.content;
      expect(content[0].type).toBe("text");
      const types = JSON.parse(content[0].text) as { types: string[] };
      expect(types.types).toEqual(["income", "expense", "investment"]);

      await client.close();
    });
  });
});
