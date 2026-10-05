import { describe, expect, it, vi } from "vitest";
import { createAssistantBridge } from "@/lib/shell/assistant-bridge";
import { APP_HOME, isAppUrl, lastAppUrl, LAST_APP_URL_KEY, rememberAppUrl } from "@/lib/shell/last-app-url";
import { readCookie, savedLocaleAction } from "@/lib/shell/locale";
import { createSidebarStore, parseSidebarMode, SIDEBAR_STORAGE_KEY } from "@/lib/shell/sidebar";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

const failingStorage = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};

describe("sidebar store", () => {
  it("starts expanded unless the rail was chosen", () => {
    expect(parseSidebarMode(null)).toBe("expanded");
    expect(parseSidebarMode("rail")).toBe("rail");
    expect(parseSidebarMode("weird")).toBe("expanded");
    expect(createSidebarStore(memoryStorage({ [SIDEBAR_STORAGE_KEY]: "rail" })).get()).toEqual({ mode: "rail", drawerOpen: false });
  });

  it("toggles the rail on wide screens and remembers it", () => {
    const storage = memoryStorage();
    const store = createSidebarStore(storage);
    const listener = vi.fn();
    store.subscribe(listener);
    store.toggle(false);
    expect(store.get().mode).toBe("rail");
    expect(storage.data.get(SIDEBAR_STORAGE_KEY)).toBe("rail");
    store.toggle(false);
    expect(store.get().mode).toBe("expanded");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("opens and closes the drawer on narrow screens without touching the mode", () => {
    const storage = memoryStorage();
    const store = createSidebarStore(storage);
    store.toggle(true);
    expect(store.get()).toEqual({ mode: "expanded", drawerOpen: true });
    store.toggle(true);
    expect(store.get().drawerOpen).toBe(false);
    expect(storage.data.size).toBe(0);
  });

  it("notifies only on real changes and stops after unsubscribe", () => {
    const store = createSidebarStore(null);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.setDrawerOpen(false);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
    store.setMode("rail");
    expect(listener).not.toHaveBeenCalled();
    expect(store.get().mode).toBe("rail");
  });

  it("works when storage throws", () => {
    const store = createSidebarStore(failingStorage);
    expect(store.get().mode).toBe("expanded");
    store.toggle(false);
    expect(store.get().mode).toBe("rail");
  });
});

describe("last app URL", () => {
  it("accepts app screens only", () => {
    expect(isAppUrl("/transactions?view=v1&entry=e1")).toBe(true);
    expect(isAppUrl("/investments/contributions")).toBe(true);
    for (const url of ["/settings", "/settings?page=fx", "/login?redirect=%2F", "/signup", "/", "//evil.example", "/\\evil", "/\t/evil.example", "/\n/evil.example", "https://x", null, ""]) {
      expect(isAppUrl(url), String(url)).toBe(false);
    }
    expect(isAppUrl("/settingsx")).toBe(true);
  });

  it("remembers the last app URL and falls back to Transações", () => {
    const storage = memoryStorage();
    expect(lastAppUrl(storage)).toBe(APP_HOME);
    rememberAppUrl(storage, "/investments?scope=pj");
    rememberAppUrl(storage, "/settings?page=prefs");
    expect(lastAppUrl(storage)).toBe("/investments?scope=pj");
    storage.data.set(LAST_APP_URL_KEY, "https://evil.example");
    expect(lastAppUrl(storage)).toBe(APP_HOME);
    expect(lastAppUrl(null)).toBe(APP_HOME);
    expect(lastAppUrl(failingStorage)).toBe(APP_HOME);
    expect(() => rememberAppUrl(failingStorage, "/transactions")).not.toThrow();
  });
});

describe("assistant bridge", () => {
  it("delivers requests to the mounted host", () => {
    const bridge = createAssistantBridge();
    const host = vi.fn();
    const stop = bridge.listen(host);
    bridge.open({ prompt: "Importe este extrato" });
    bridge.open();
    expect(host.mock.calls).toEqual([[{ prompt: "Importe este extrato" }], [{}]]);
    stop();
    bridge.open({ prompt: "depois" });
    expect(host).toHaveBeenCalledTimes(2);
  });

  it("keeps the last request until a host mounts", () => {
    const bridge = createAssistantBridge();
    bridge.open({ prompt: "primeiro" });
    bridge.open({ prompt: "segundo" });
    const host = vi.fn();
    bridge.listen(host);
    expect(host.mock.calls).toEqual([[{ prompt: "segundo" }]]);
    const later = vi.fn();
    bridge.listen(later);
    expect(later).not.toHaveBeenCalled();
  });

  it("ignores the unsubscribe of a host that was replaced", () => {
    const bridge = createAssistantBridge();
    const first = vi.fn();
    const stopFirst = bridge.listen(first);
    const second = vi.fn();
    bridge.listen(second);
    stopFirst();
    bridge.open({ prompt: "x" });
    expect(second).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
  });
});

describe("locale", () => {
  it("reads one cookie", () => {
    expect(readCookie("a=1; NEXT_LOCALE=en; b=x=y", "NEXT_LOCALE")).toBe("en");
    expect(readCookie("a=1; b=x=y", "b")).toBe("x=y");
    expect(readCookie("NEXT_LOCALE=pt-BR", "NEXT_LOCALE")).toBe("pt-BR");
    expect(readCookie("", "NEXT_LOCALE")).toBeNull();
    expect(readCookie("XNEXT_LOCALE=en", "NEXT_LOCALE")).toBeNull();
  });

  it("applies the saved locale only when the browser has no locale cookie", () => {
    expect(savedLocaleAction("en", "pt-BR", "pt-BR")).toBeNull();
    expect(savedLocaleAction("en", null, "pt-BR")).toEqual({ locale: "en", switch: true });
    expect(savedLocaleAction("pt-BR", null, "pt-BR")).toEqual({ locale: "pt-BR", switch: false });
    expect(savedLocaleAction("en", "klingon", "pt-BR")).toEqual({ locale: "en", switch: true });
    expect(savedLocaleAction(undefined, null, "pt-BR")).toBeNull();
    expect(savedLocaleAction("fr", null, "pt-BR")).toBeNull();
  });
});
