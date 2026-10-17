import { describe, expect, it } from "vitest";
import {
  STATUS_PAGE_DESCRIPTION_PREFIX,
  STATUS_PAGE_DOMAIN,
  classifyStatusMonitor,
  statusGroupPayload,
  statusGroupsMatch,
  statusLogoDataUrl,
  statusMonitorDescription,
  statusMonitorDesired,
  statusMonitorsToRemove,
  statusPageCustomCss,
  statusPageIsCurrent,
  statusPageMonitors,
  statusPageSaveConfig,
  type StatusGroupSnapshot,
  type StatusPageSnapshot,
} from "../status-page.js";

describe("status page monitors", () => {
  it("uses friendly names and does not take over kodama/ monitors", () => {
    const names = statusPageMonitors().map((monitor) => monitor.name);
    expect(names).toEqual(["Capital", "Careers", "Attentio"]);
    for (const name of names) {
      expect(name.startsWith("kodama/")).toBe(false);
    }
  });

  it("classifies ownership from the statuspage description prefix", () => {
    const desired = statusMonitorDesired(statusPageMonitors()[0]!);
    const description = statusMonitorDescription(desired);
    expect(description.startsWith(STATUS_PAGE_DESCRIPTION_PREFIX)).toBe(true);
    expect(classifyStatusMonitor(undefined, description)).toBe("add");
    expect(classifyStatusMonitor({ description }, description)).toBe("keep");
    expect(classifyStatusMonitor({ description: `${STATUS_PAGE_DESCRIPTION_PREFIX}old` }, description)).toBe("update");
    expect(() => classifyStatusMonitor({ description: "managed:abc" }, description)).toThrow(/outside the status page/);
    expect(() => classifyStatusMonitor({ description: "" }, description)).toThrow(/outside the status page/);
  });

  it("removes retired rows and duplicate names, keeping the first owned copy", () => {
    const remove = statusMonitorsToRemove(
      [
        { id: 1, name: "Capital", description: "statuspage:aaa" },
        { id: 2, name: "Capital", description: "statuspage:bbb" },
        { id: 3, name: "Careers", description: "statuspage:ccc" },
        { id: 4, name: "Old", description: "statuspage:ddd" },
        { id: 5, name: "kodama/public-capital-login", description: "managed:eee" },
        { id: 6, name: "Attentio", description: "" },
      ],
      new Set(["Capital", "Careers", "Attentio"]),
    );
    expect(remove).toEqual([2, 4]);
  });
});

describe("status page config", () => {
  const monitors = statusPageMonitors();
  const ids = new Map(monitors.map((monitor, index) => [monitor.name, index + 10]));

  function current(overrides: Partial<StatusPageSnapshot> = {}): StatusPageSnapshot {
    return {
      slug: "kodama",
      title: "Kodama Labs",
      description: "Status of Kodama Labs public services.",
      icon: "/upload/logo1.png?t=1",
      theme: "auto",
      autoRefreshInterval: 300,
      published: true,
      showTags: false,
      domainNameList: [STATUS_PAGE_DOMAIN],
      customCSS: statusPageCustomCss(),
      footerText: "Kodama Labs",
      showPoweredBy: false,
      analyticsId: null,
      analyticsScriptUrl: null,
      analyticsType: null,
      showCertificateExpiry: false,
      showOnlyLastHeartbeat: false,
      rssTitle: "Kodama Labs",
      ...overrides,
    };
  }

  function groups(): StatusGroupSnapshot[] {
    return [
      {
        id: 7,
        name: "Services",
        monitorList: monitors.map((monitor) => ({ id: ids.get(monitor.name), sendUrl: false })),
      },
    ];
  }

  it("treats an already-saved page as current", () => {
    expect(statusPageIsCurrent(current(), groups(), ids)).toBe(true);
  });

  it("re-saves when the logo, a label, or a leaked url drifts", () => {
    expect(statusPageIsCurrent(current({ icon: "/icon.svg" }), groups(), ids)).toBe(false);
    expect(statusPageIsCurrent(current({ title: "Other" }), groups(), ids)).toBe(false);
    expect(statusPageIsCurrent(current({ showPoweredBy: true }), groups(), ids)).toBe(false);
    const leaked = groups();
    leaked[0]!.monitorList![0]!.url = "https://capital.kodamalabs.ai/login";
    expect(statusPageIsCurrent(current(), leaked, ids)).toBe(false);
  });

  it("reuses the Services group id and keeps sendUrl off", () => {
    expect(statusGroupPayload(groups(), ids)).toEqual([
      {
        id: 7,
        name: "Services",
        monitorList: [
          { id: 10, sendUrl: false },
          { id: 11, sendUrl: false },
          { id: 12, sendUrl: false },
        ],
      },
    ]);
    expect(statusGroupsMatch(groups(), ids)).toBe(true);
  });

  it("saves the domain and discourages the powered-by line", () => {
    expect(statusPageSaveConfig()).toMatchObject({
      slug: "kodama",
      theme: "auto",
      showPoweredBy: false,
      domainNameList: [STATUS_PAGE_DOMAIN],
    });
  });

  it("embeds the compass logo as a PNG data URL", () => {
    const url = statusLogoDataUrl();
    expect(url.startsWith("data:image/png;base64,")).toBe(true);
    const bytes = Buffer.from(url.slice("data:image/png;base64,".length), "base64");
    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  });
});
