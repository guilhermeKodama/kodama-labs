/**
 * Push devices: the label stored with a subscription and how the
 * Notificações table names it ("Mac · Chrome", "iPhone · app instalado
 * (PWA)"). The client stores "<device>|<browser>" plus "|pwa" when the app
 * runs installed; older rows hold just the device ("Mac"), and the browser
 * then comes from the user agent.
 */
export type DeviceKind = "iPhone" | "iPad" | "Mac" | "Android" | "Windows" | "Linux" | "device";
export type BrowserKind = "Chrome" | "Safari" | "Firefox" | "Edge" | "Opera" | "Samsung" | "browser";

export interface DeviceInfo {
  device: DeviceKind;
  browser: BrowserKind;
  pwa: boolean;
}

const DEVICES: DeviceKind[] = ["iPhone", "iPad", "Mac", "Android", "Windows", "Linux", "device"];
const BROWSERS: BrowserKind[] = ["Chrome", "Safari", "Firefox", "Edge", "Opera", "Samsung", "browser"];

export function detectDevice(userAgent: string): DeviceKind {
  if (/iPhone|iPod/.test(userAgent)) return "iPhone";
  if (/iPad/.test(userAgent)) return "iPad";
  if (/Android/.test(userAgent)) return "Android";
  if (/Macintosh|Mac OS X/.test(userAgent)) return "Mac";
  if (/Windows/.test(userAgent)) return "Windows";
  if (/Linux|X11/.test(userAgent)) return "Linux";
  return "device";
}

export function detectBrowser(userAgent: string): BrowserKind {
  if (/Edg\//.test(userAgent)) return "Edge";
  if (/OPR\/|Opera/.test(userAgent)) return "Opera";
  if (/SamsungBrowser/.test(userAgent)) return "Samsung";
  if (/Firefox\/|FxiOS/.test(userAgent)) return "Firefox";
  if (/Chrome\/|CriOS/.test(userAgent)) return "Chrome";
  if (/Safari\//.test(userAgent)) return "Safari";
  return "browser";
}

/** What the client sends as deviceLabel when it subscribes. */
export function encodeDeviceLabel(userAgent: string, standalone: boolean): string {
  return [detectDevice(userAgent), detectBrowser(userAgent), ...(standalone ? ["pwa"] : [])].join("|");
}

/** A stored label (new or old form) and user agent, read back for display. */
export function parseDeviceLabel(label: string | null | undefined, userAgent: string | null | undefined): DeviceInfo {
  const ua = userAgent ?? "";
  const [device, browser, flag] = (label ?? "").split("|");
  return {
    device: (DEVICES as string[]).includes(device) ? (device as DeviceKind) : detectDevice(ua),
    browser: (BROWSERS as string[]).includes(browser) ? (browser as BrowserKind) : detectBrowser(ua),
    pwa: flag === "pwa",
  };
}
