import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { HTTPException } from "hono/http-exception";
import { validateMcpAuth } from "../auth";
import { Hono } from "hono";

describe("MCP Authentication", () => {
  let originalApiKey: string | undefined;

  beforeEach(() => {
    originalApiKey = process.env.MCP_API_KEY;
  });

  afterEach(() => {
    if (originalApiKey !== undefined) {
      process.env.MCP_API_KEY = originalApiKey;
    } else {
      delete process.env.MCP_API_KEY;
    }
  });

  it("should reject requests without Authorization header", () => {
    process.env.MCP_API_KEY = "test-key-123";
    const app = new Hono();
    const c = app.request("/test", { headers: new Headers() });

    expect(() => validateMcpAuth(c)).toThrow(HTTPException);
    expect(() => validateMcpAuth(c)).toThrow("Missing or invalid Authorization header");
  });

  it("should reject requests with invalid Authorization format", () => {
    process.env.MCP_API_KEY = "test-key-123";
    const app = new Hono();
    const headers = new Headers();
    headers.set("Authorization", "InvalidFormat test-key-123");
    const c = app.request("/test", { headers });

    expect(() => validateMcpAuth(c)).toThrow(HTTPException);
    expect(() => validateMcpAuth(c)).toThrow("Missing or invalid Authorization header");
  });

  it("should reject requests with wrong API key", () => {
    process.env.MCP_API_KEY = "correct-key-123";
    const app = new Hono();
    const headers = new Headers();
    headers.set("Authorization", "Bearer wrong-key-123");
    const c = app.request("/test", { headers });

    expect(() => validateMcpAuth(c)).toThrow(HTTPException);
    expect(() => validateMcpAuth(c)).toThrow("Invalid API key");
  });

  it("should accept requests with correct API key", () => {
    process.env.MCP_API_KEY = "correct-key-123";
    const app = new Hono();
    const headers = new Headers();
    headers.set("Authorization", "Bearer correct-key-123");
    const c = app.request("/test", { headers });

    expect(() => validateMcpAuth(c)).not.toThrow();
  });

  it("should throw 500 error when MCP_API_KEY is not configured", () => {
    delete process.env.MCP_API_KEY;
    const app = new Hono();
    const headers = new Headers();
    headers.set("Authorization", "Bearer any-key");
    const c = app.request("/test", { headers });

    expect(() => validateMcpAuth(c)).toThrow(HTTPException);
    expect(() => validateMcpAuth(c)).toThrow("MCP_API_KEY not configured");
  });
});
