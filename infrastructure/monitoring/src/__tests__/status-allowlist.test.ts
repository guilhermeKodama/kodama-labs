import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const pattern = readFileSync(join(root, "infrastructure/cloudflared/status-allowlist.regex"), "utf8").trim();
const ingress = readFileSync(join(root, "infrastructure/cloudflared/config.yml"), "utf8");
const allow = new RegExp(pattern);

const allowed = [
  "/",
  "/status/kodama",
  "/status/kodama/rss",
  "/api/status-page/kodama",
  "/api/status-page/heartbeat/kodama",
  "/api/status-page/kodama/manifest.json",
  "/api/status-page/kodama/incident-history",
  "/api/status-page/kodama/badge",
  "/api/entry-page",
  "/upload/logo1.png",
  "/upload/logo12.png",
  "/assets/index-Ab12.css",
  "/assets/index-Ab12.js",
  "/icon.svg",
  "/favicon.ico",
  "/icon.png",
  "/apple-touch-icon.png",
  "/apple-touch-icon-precomposed.png",
  "/icon-192x192.png",
  "/icon-512x512.png",
  "/manifest.json",
  "/serviceWorker.js",
  "/robots.txt",
];

const denied = [
  "",
  "/dashboard",
  "/Dashboard",
  "/socket.io/",
  "/socket.io",
  "/api/push/x",
  "/api/push/anything",
  "/metrics",
  "/api/badge/1/status",
  "/api/badge/1",
  "/setup-database-info",
  "/api/entry-page/extra",
  "/api/status-page/upload-logo",
  "/status",
  "/status/",
  "/status-page",
  "/status/kodama/",
  "/status/kodama/rss/extra",
  "/status/other",
  "/status/kodama/../../dashboard",
  "/api/status-page/other",
  "/api/status-page/kodama/../../dashboard",
  "/api/status-page/heartbeat/other",
  "/api/entry-page/../dashboard",
  "/assets/../dashboard",
  "/assets/..%2fdashboard",
  "/assets/foo/bar.js",
  "/assets/index-Ab12.js/",
  "/upload/../dashboard",
  "/upload/logo.png",
  "/upload/logo1.png/extra",
  "/upload/secret.txt",
  "//dashboard",
  "/status\\kodama",
  "/icon.svg/extra",
  "/robots.txt/extra",
];

describe("status allowlist", () => {
  it("is anchored and free of lookaround so Go RE2 and JavaScript agree", () => {
    expect(pattern.startsWith("^")).toBe(true);
    expect(pattern.endsWith("$")).toBe(true);
    expect(pattern).not.toMatch(/\(\?<?[=!]/);
    expect(pattern).not.toMatch(/\\[1-9]/);
  });

  it("is the path cloudflared is configured with", () => {
    expect(ingress).toContain(`path: '${pattern}'`);
    expect(ingress).toContain("hostname: status.kodamalabs.ai");
    expect(ingress).toContain("service: http://uptime-kuma:3001");
    const statusRules = ingress
      .split("\n")
      .filter((line) => line.includes("status.kodamalabs.ai") || line.includes("http_status:404"));
    expect(statusRules.filter((line) => line.includes("http_status:404")).length).toBeGreaterThanOrEqual(2);
  });

  it("allows the status page shell and denies the dashboard and traversal", () => {
    for (const path of allowed) {
      expect(allow.test(path), path).toBe(true);
    }
    for (const path of denied) {
      expect(allow.test(path), path).toBe(false);
    }
  });
});
