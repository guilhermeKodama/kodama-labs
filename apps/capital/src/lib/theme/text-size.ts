import type { TextSize } from "@capital/server/modules/users/lib/preferences";

/**
 * The UI text size (User.textSize: Pequeno, Médio, Grande). It lives on
 * <html data-text-size>, which src/app/theme.css turns into --cap-text-scale
 * for every type role and the heights tied to text. localStorage keeps the
 * last one applied, so the inline script of app/[locale]/layout.tsx sets it
 * before the first paint, before /v2/me answers (the layout stays static:
 * no cookies()).
 */

export type { TextSize };

/** The server's TEXT_SIZES (users/lib/preferences.ts), in the order Ajustes lists them. */
export const TEXT_SIZES = ["sm", "md", "lg"] as const satisfies readonly TextSize[];

export const TEXT_SIZE_STORAGE_KEY = "cap-text-size";
export const DEFAULT_TEXT_SIZE: TextSize = "md";

/** A stored text size, or null for anything else ("leave it alone"). */
export function parseTextSize(value: unknown): TextSize | null {
  return typeof value === "string" && (TEXT_SIZES as readonly string[]).includes(value) ? (value as TextSize) : null;
}

interface TextSizeTarget {
  dataset: DOMStringMap;
}

interface TextSizeStorage {
  setItem(key: string, value: string): void;
}

/** Applies the size to the document and remembers it for the next load (storage may be unavailable). */
export function applyTextSize(size: TextSize, root: TextSizeTarget = document.documentElement, storage: TextSizeStorage | null = safeStorage()) {
  root.dataset.textSize = size;
  try {
    storage?.setItem(TEXT_SIZE_STORAGE_KEY, size);
  } catch {
    // Private mode or blocked storage: the size still applies to this page.
  }
}

function safeStorage(): TextSizeStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Runs before the first paint (inline in the root layout): the last size applied on this device. */
export const TEXT_SIZE_SCRIPT = `(function(){try{var s=localStorage.getItem(${JSON.stringify(TEXT_SIZE_STORAGE_KEY)});if(${JSON.stringify(TEXT_SIZES)}.indexOf(s)>=0)document.documentElement.dataset.textSize=s}catch(e){}})();`;
