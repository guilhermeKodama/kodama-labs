import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Liquid } from "liquidjs";
import { cronPeriodSeconds } from "../cron-period.js";
import { KUMA_WEBHOOK_BODY } from "../kuma-body.js";
import { pushToken, resolvePushToken } from "../push-token.js";
import { buildMonitors, cronPushMonitors, managedHash } from "../spec.js";
import { resolveWebhook } from "../webhook.js";

const schedules = join(dirname(fileURLToPath(import.meta.url)), "../../../cronjobs/schedules");

describe("webhook auth", () => {
  it("uses the raw header value when it is set", () => {
    expect(
      resolveWebhook({
        url: "https://example.test/hook",
        header: "X-Auth",
        headerValue: "Token raw-value",
        key: "ignored",
      }),
    ).toEqual({
      url: "https://example.test/hook",
      headers: { "X-Auth": "Token raw-value" },
    });
  });

  it("falls back to Bearer when only the key is set", () => {
    expect(resolveWebhook({ url: "https://example.test/hook", key: "abc" })).toEqual({
      url: "https://example.test/hook",
      headers: { Authorization: "Bearer abc" },
    });
  });

  it("is a no-op without a url", () => {
    expect(resolveWebhook({ key: "abc" })).toBeNull();
  });
});

describe("push tokens", () => {
  it("is stable and changes with the secret", () => {
    expect(pushToken("s", "kodama/host-disk")).toBe(pushToken("s", "kodama/host-disk"));
    expect(pushToken("s", "kodama/host-disk")).not.toBe(pushToken("other", "kodama/host-disk"));
  });

  it("prefers a server-assigned token from the override file", () => {
    expect(resolvePushToken("s", "kodama/host-disk", { "kodama/host-disk": "from-server" })).toBe("from-server");
  });
});

describe("monitors", () => {
  const monitors = buildMonitors({ schedulesDir: schedules });

  it("checks internal health and the three public hosts without following redirects", () => {
    const byName = new Map(monitors.map((monitor) => [monitor.name, monitor]));
    expect(byName.get("kodama/capital-web")?.url).toBe("http://capital-web:3000/api/health");
    expect(byName.get("kodama/public-capital-login")).toMatchObject({
      url: "https://capital.kodamalabs.ai/login",
      maxredirects: 0,
      accepted_statuscodes: ["200-399"],
    });
    expect(byName.get("kodama/public-attention")?.maxredirects).toBe(0);
    expect(byName.get("kodama/public-careers")?.accepted_statuscodes).toEqual(["200-399"]);
    expect(byName.has("kodama/public-sentinel.kodamalabs.ai")).toBe(false);
    expect(byName.has("kodama/capital-mcp")).toBe(false);
    expect(byName.has("kodama/ollama")).toBe(false);
    expect(byName.has("kodama/whisper")).toBe(false);
  });

  it("adds extra public hosts only from the env list", () => {
    const extra = buildMonitors({ extraPublicHosts: "https://sentinel.kodamalabs.ai/, kodamalabs.ai" });
    const names = extra.map((monitor) => monitor.name);
    expect(names).toContain("kodama/public-sentinel.kodamalabs.ai");
    expect(names).toContain("kodama/public-kodamalabs.ai");
  });

  it("gives every scheduled cron a push monitor that requires two misses", () => {
    const crons = cronPushMonitors(schedules);
    expect(crons).toHaveLength(25);
    for (const monitor of crons) {
      expect(monitor.type).toBe("push");
      expect(monitor.maxretries).toBe(1);
      expect(monitor.interval).toBeGreaterThan(monitor.retryInterval);
    }
    const byName = new Map(crons.map((monitor) => [monitor.name, monitor]));
    expect(byName.has("kodama/cron-capital-api-cron-categorize-bills")).toBe(false);
    expect(byName.has("kodama/cron-capital-api-cron-categorize-statements")).toBe(false);
    expect(byName.get("kodama/cron-capital-api-cron-categorize")).toMatchObject({
      interval: 180,
      retryInterval: 120,
    });
    expect(byName.get("kodama/cron-capital-api-cron-notify")).toMatchObject({
      interval: 960,
      retryInterval: 900,
    });
    expect(byName.get("kodama/cron-capital-api-cron-portfolio-snapshot")).toMatchObject({
      interval: 26 * 3600 + 60,
      retryInterval: 26 * 3600,
    });
    expect(byName.get("kodama/cron-capital-api-cron-benchmarks")).toMatchObject({
      interval: 26 * 3600 + 60,
      retryInterval: 26 * 3600,
    });
    expect(byName.get("kodama/cron-capital-api-cron-send-reminders")).toMatchObject({
      interval: 360,
      retryInterval: 300,
    });
    expect(byName.get("kodama/cron-sentinel-api-cron-ingest-pncp-documents")).toMatchObject({
      interval: 1860,
      retryInterval: 1800,
    });
    expect(byName.get("kodama/cron-capital-api-cron-process-recurring")).toMatchObject({
      interval: 26 * 3600 + 60,
      retryInterval: 26 * 3600,
    });
    expect(byName.get("kodama/cron-capital-api-cron-fire-snapshot")).toMatchObject({
      interval: 32 * 24 * 3600 + 60,
      retryInterval: 32 * 24 * 3600,
    });
  });

  it("parses the schedule dialects we ship", () => {
    expect(cronPeriodSeconds("*/5 * * * *")).toBe(300);
    expect(cronPeriodSeconds("*/2 * * * *")).toBe(120);
    expect(cronPeriodSeconds("*/15 * * * *")).toBe(900);
    expect(cronPeriodSeconds("0 * * * *")).toBe(3600);
    expect(cronPeriodSeconds("30 23 * * *")).toBe(26 * 3600);
    expect(cronPeriodSeconds("0 10 * * *")).toBe(26 * 3600);
    expect(cronPeriodSeconds("0 */3 * * *")).toBe(3 * 3600);
    expect(cronPeriodSeconds("0,30 * * * *")).toBe(1800);
    expect(cronPeriodSeconds("0 6 * * *")).toBe(26 * 3600);
    expect(cronPeriodSeconds("0 3 1 * *")).toBe(32 * 24 * 3600);
  });

  it("hashes a monitor stably", () => {
    const monitor = monitors[0];
    expect(monitor).toBeDefined();
    if (!monitor) return;
    expect(managedHash(monitor)).toBe(managedHash({ ...monitor }));
  });
});

describe("kuma webhook body", () => {
  const engine = new Liquid({
    root: "./no-such-directory-uptime-kuma",
    relativeReference: false,
    dynamicPartials: false,
  });

  it("JSON-encodes quotes, newlines and backslashes", async () => {
    const rendered = await engine.parseAndRender(KUMA_WEBHOOK_BODY, {
      msg: "ignored when heartbeat is present",
      name: "kodama/x",
      monitorJSON: { name: 'kodama/"quoted"', type: "http" },
      heartbeatJSON: {
        status: 0,
        msg: 'line1\nline "two" \\',
        time: "2026-10-05T00:00:00.000Z",
        important: true,
        ping: null,
      },
    });
    const parsed = JSON.parse(rendered) as {
      status: string;
      monitor: string;
      message: string;
      important: boolean;
      pingMs: null;
    };
    expect(parsed.status).toBe("down");
    expect(parsed.monitor).toBe('kodama/"quoted"');
    expect(parsed.message).toBe('line1\nline "two" \\');
    expect(parsed.important).toBe(true);
    expect(parsed.pingMs).toBeNull();
  });

  it("stays valid JSON when Kuma sends a test notification without a heartbeat", async () => {
    const rendered = await engine.parseAndRender(KUMA_WEBHOOK_BODY, {
      msg: 'test "ping"',
      name: "kodama-alert-webhook",
      monitorJSON: null,
      heartbeatJSON: null,
    });
    expect(JSON.parse(rendered)).toMatchObject({
      status: "test",
      monitor: "kodama-alert-webhook",
      message: 'test "ping"',
    });
  });
});
