import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { env } from "@/env";
import { isPluggyConfigured } from "@capital/server/modules/pluggy/lib/config";
import { GET } from "../pluggy-sync/route";

const request = (secret?: string) =>
  new NextRequest("http://localhost/api/cron/pluggy-sync", { headers: secret ? { authorization: `Bearer ${secret}` } : {} });

describe("pluggy-sync cron", () => {
  it("rejects a bad secret before any sync", async () => {
    if (!env.CRON_SECRET) return;
    expect((await GET(request("wrong"))).status).toBe(401);
  });

  it("no-ops with status disabled when the credentials are unset", async () => {
    // A machine with both Pluggy vars set would reach the client. CI has neither.
    if (isPluggyConfigured()) return;
    const res = await GET(request(env.CRON_SECRET));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, status: "disabled", message: "Pluggy is not configured" });
  });
});
