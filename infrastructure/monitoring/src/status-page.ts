import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { managedHash, type MonitorDesired } from "./spec.js";

/** Public hostname. DNS for this name is created in Cloudflare, not in git. */
export const STATUS_PAGE_DOMAIN = "status.kodamalabs.ai";

/** Slug Kuma serves at `/status/kodama` and, with the domain map, at `/`. */
export const STATUS_PAGE_SLUG = "kodama";

/**
 * Description prefix for the public display monitors. Separate from `kodama/`
 * so the alerting monitors keep their names, tokens, and cleanup rules.
 * A monitor whose description starts with this prefix is owned by the
 * provisioner even though its name is the public label.
 */
export const STATUS_PAGE_DESCRIPTION_PREFIX = "statuspage:";

/** Bump when the logo PNG changes so the next provision re-uploads it. */
export const STATUS_LOGO_MARKER = "compass-v1";

export const STATUS_PAGE_TITLE = "Kodama Labs";
export const STATUS_PAGE_DESCRIPTION = "Status of Kodama Labs public services.";
export const STATUS_PAGE_FOOTER = "Kodama Labs";
export const STATUS_GROUP_NAME = "Services";

export interface StatusService {
  /** Name shown on the public page. Not a `kodama/` monitor name. */
  name: string;
  /** Same target the alerting `kodama/public-*` monitor checks. */
  url: string;
}

/**
 * Display copies of the public HTTP checks. The `kodama/public-*` monitors
 * stay the ones that alert. These rows exist so the page can show a friendly
 * name: Kuma 2.5.3 publishes `monitor.name` and has no display-name field.
 */
export function statusPageMonitors(): StatusService[] {
  return [
    { name: "Capital", url: "https://capital.kodamalabs.ai/login" },
    { name: "Careers", url: "https://careers.kodamalabs.ai/" },
    { name: "Attentio", url: "https://attentio.dev/" },
  ];
}

export function statusMonitorDesired(service: StatusService): MonitorDesired {
  return {
    name: service.name,
    type: "http",
    url: service.url,
    method: "GET",
    interval: 60,
    retryInterval: 60,
    maxretries: 2,
    resendInterval: 0,
    accepted_statuscodes: ["200-399"],
    maxredirects: 0,
  };
}

export function statusMonitorDescription(monitor: MonitorDesired): string {
  return `${STATUS_PAGE_DESCRIPTION_PREFIX}${managedHash(monitor)}`;
}

export type StatusMonitorAction = "add" | "keep" | "update";

/**
 * How to reconcile one display monitor with what Kuma already has.
 * A name owned by anything else is refused so a UI monitor is not overwritten.
 */
export function classifyStatusMonitor(
  existing: { description: string } | undefined,
  description: string,
): StatusMonitorAction {
  if (!existing) return "add";
  if (!existing.description.startsWith(STATUS_PAGE_DESCRIPTION_PREFIX)) {
    throw new Error("monitor name is already used outside the status page");
  }
  if (existing.description === description) return "keep";
  return "update";
}

/** Ids to delete: retired status-page monitors, and duplicates of a name we keep. */
export function statusMonitorsToRemove(
  existing: Array<{ id: number; name: string; description: string }>,
  desiredNames: ReadonlySet<string>,
): number[] {
  const remove: number[] = [];
  const kept = new Set<string>();
  for (const monitor of existing) {
    if (!monitor.description.startsWith(STATUS_PAGE_DESCRIPTION_PREFIX)) continue;
    if (!desiredNames.has(monitor.name) || kept.has(monitor.name)) {
      remove.push(monitor.id);
      continue;
    }
    kept.add(monitor.name);
  }
  return remove;
}

export function statusPageCustomCss(): string {
  return `/* kodama-status ${STATUS_LOGO_MARKER} */
body {
  background: #f6f5f3 !important;
  color: #1c1917 !important;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif !important;
}
body.dark {
  background: #0c1714 !important;
  color: #f5f5f4 !important;
}
h1, .group-title {
  font-weight: 600 !important;
  letter-spacing: -0.02em !important;
}
.item-name {
  font-weight: 500 !important;
}
.shadow-box {
  border-radius: 16px !important;
  border: 1px solid #e7e5e4 !important;
  box-shadow: none !important;
}
body.dark .shadow-box {
  background: #12211c !important;
  border-color: rgba(255, 255, 255, 0.08) !important;
}
.overall-status .ok {
  color: #0f766e !important;
}
body.dark .overall-status .ok {
  color: #5eead4 !important;
}
footer, .refresh-info {
  color: #737373 !important;
}
body.dark footer, body.dark .refresh-info {
  color: #a8a29e !important;
}
`;
}

export function statusLogoDataUrl(): string {
  const png = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../assets/status-logo.png"));
  return `data:image/png;base64,${png.toString("base64")}`;
}

/** Fields `saveStatusPage` actually writes in Kuma 2.5.3. */
export function statusPageSaveConfig(): Record<string, unknown> {
  return {
    slug: STATUS_PAGE_SLUG,
    title: STATUS_PAGE_TITLE,
    description: STATUS_PAGE_DESCRIPTION,
    theme: "auto",
    autoRefreshInterval: 300,
    showTags: false,
    footerText: STATUS_PAGE_FOOTER,
    customCSS: statusPageCustomCss(),
    showPoweredBy: false,
    rssTitle: STATUS_PAGE_TITLE,
    showOnlyLastHeartbeat: false,
    showCertificateExpiry: false,
    analyticsId: null,
    analyticsScriptUrl: null,
    analyticsType: null,
    domainNameList: [STATUS_PAGE_DOMAIN],
  };
}

export interface StatusPageSnapshot {
  slug?: string;
  title?: string | null;
  description?: string | null;
  icon?: string | null;
  theme?: string | null;
  autoRefreshInterval?: number | null;
  published?: boolean;
  showTags?: boolean;
  domainNameList?: string[];
  customCSS?: string | null;
  footerText?: string | null;
  showPoweredBy?: boolean;
  analyticsId?: string | null;
  analyticsScriptUrl?: string | null;
  analyticsType?: string | null;
  showCertificateExpiry?: boolean;
  showOnlyLastHeartbeat?: boolean;
  rssTitle?: string | null;
}

export interface StatusGroupSnapshot {
  id?: number;
  name?: string;
  monitorList?: Array<{ id?: number; sendUrl?: unknown; url?: unknown }>;
}

export function statusLogoReady(config: StatusPageSnapshot): boolean {
  const icon = config.icon ?? "";
  const css = config.customCSS ?? "";
  return icon.includes("/upload/logo") && css.includes(STATUS_LOGO_MARKER);
}

/** Pass the existing file back when it is already our logo, so re-runs do not rewrite it. */
export function statusLogoArgument(config: StatusPageSnapshot): string {
  if (statusLogoReady(config) && typeof config.icon === "string") {
    return config.icon.replace(/\?.*$/, "");
  }
  return statusLogoDataUrl();
}

function blank(value: string | null | undefined): string {
  return value ?? "";
}

export function statusPageIsCurrent(
  config: StatusPageSnapshot,
  groups: StatusGroupSnapshot[],
  ids: ReadonlyMap<string, number>,
): boolean {
  if (!statusLogoReady(config)) return false;
  if (config.slug !== STATUS_PAGE_SLUG) return false;
  if (config.title !== STATUS_PAGE_TITLE) return false;
  if (blank(config.description) !== STATUS_PAGE_DESCRIPTION) return false;
  if (config.theme !== "auto") return false;
  if (Number(config.autoRefreshInterval) !== 300) return false;
  if (config.showTags !== false) return false;
  if (blank(config.footerText) !== STATUS_PAGE_FOOTER) return false;
  if (blank(config.customCSS) !== statusPageCustomCss()) return false;
  if (config.showPoweredBy !== false) return false;
  if (blank(config.rssTitle) !== STATUS_PAGE_TITLE) return false;
  if (config.showOnlyLastHeartbeat !== false) return false;
  if (config.showCertificateExpiry !== false) return false;
  if (blank(config.analyticsId) !== "") return false;
  if (blank(config.analyticsScriptUrl) !== "") return false;
  if (blank(config.analyticsType) !== "") return false;
  const domains = [...(config.domainNameList ?? [])].sort();
  if (domains.length !== 1 || domains[0] !== STATUS_PAGE_DOMAIN) return false;
  return statusGroupsMatch(groups, ids);
}

export function statusGroupsMatch(groups: StatusGroupSnapshot[], ids: ReadonlyMap<string, number>): boolean {
  if (groups.length !== 1) return false;
  const group = groups[0];
  if (!group || group.name !== STATUS_GROUP_NAME) return false;
  const got = group.monitorList ?? [];
  const wanted = statusPageMonitors();
  if (got.length !== wanted.length) return false;
  return wanted.every((service, index) => {
    const monitor = got[index];
    if (!monitor) return false;
    if (Number(monitor.id) !== ids.get(service.name)) return false;
    if (monitor.sendUrl) return false;
    if (typeof monitor.url === "string" && monitor.url.length > 0) return false;
    return true;
  });
}

export function statusGroupPayload(
  groups: StatusGroupSnapshot[],
  ids: ReadonlyMap<string, number>,
): Array<{ id?: number; name: string; monitorList: Array<{ id: number; sendUrl: false }> }> {
  const existing = groups.find((group) => group.name === STATUS_GROUP_NAME && typeof group.id === "number");
  const monitorList = statusPageMonitors().map((service) => {
    const id = ids.get(service.name);
    if (id === undefined) throw new Error(`missing status monitor id for ${service.name}`);
    return { id, sendUrl: false as const };
  });
  return [
    {
      ...(existing?.id !== undefined ? { id: existing.id } : {}),
      name: STATUS_GROUP_NAME,
      monitorList,
    },
  ];
}
