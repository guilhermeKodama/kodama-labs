export type UtmPayload = {
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string;
  utm_term: string;
  referrer: string;
};

const STORAGE_KEY = "utm_attribution";

const EMPTY: UtmPayload = {
  utm_source: "",
  utm_medium: "",
  utm_campaign: "",
  utm_content: "",
  utm_term: "",
  referrer: "",
};

function readFromUrl(): UtmPayload {
  const params = new URLSearchParams(window.location.search);
  return {
    utm_source: params.get("utm_source") ?? "",
    utm_medium: params.get("utm_medium") ?? "",
    utm_campaign: params.get("utm_campaign") ?? "",
    utm_content: params.get("utm_content") ?? "",
    utm_term: params.get("utm_term") ?? "",
    referrer: document.referrer,
  };
}

function readFromStorage(): UtmPayload {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    return { ...EMPTY, ...(JSON.parse(raw) as Partial<UtmPayload>) };
  } catch {
    return EMPTY;
  }
}

// First non-empty value wins, so client-side navigation to a UTM-less URL
// (e.g. /?utm_source=ig → /start) doesn't wipe attribution.
export function captureUtms(): void {
  if (typeof window === "undefined") return;
  const fromUrl = readFromUrl();
  const stored = readFromStorage();
  const merged: UtmPayload = {
    utm_source: stored.utm_source || fromUrl.utm_source,
    utm_medium: stored.utm_medium || fromUrl.utm_medium,
    utm_campaign: stored.utm_campaign || fromUrl.utm_campaign,
    utm_content: stored.utm_content || fromUrl.utm_content,
    utm_term: stored.utm_term || fromUrl.utm_term,
    referrer: stored.referrer || fromUrl.referrer,
  };
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // sessionStorage may be unavailable (private mode, quota); ignore.
  }
}

export function readUtms(): UtmPayload {
  if (typeof window === "undefined") return EMPTY;
  captureUtms();
  return readFromStorage();
}
