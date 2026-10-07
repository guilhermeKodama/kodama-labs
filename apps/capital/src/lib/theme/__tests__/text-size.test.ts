import { describe, expect, it } from "vitest";
import { isTextSize, TEXT_SIZES as SERVER_TEXT_SIZES } from "@capital/server/modules/users/lib/preferences";
import { applyTextSize, parseTextSize, TEXT_SIZE_SCRIPT, TEXT_SIZE_STORAGE_KEY, TEXT_SIZES } from "../text-size";

describe("text size preference", () => {
  it("knows Pequeno, Médio and Grande, nothing else", () => {
    expect(TEXT_SIZES).toEqual(["sm", "md", "lg"]);
    expect([...SERVER_TEXT_SIZES]).toEqual([...TEXT_SIZES]);
    expect(isTextSize("lg")).toBe(true);
    expect(isTextSize("xl")).toBe(false);
    expect(parseTextSize("sm")).toBe("sm");
    expect(parseTextSize("LG")).toBeNull();
    expect(parseTextSize(undefined)).toBeNull();
  });

  it("applies the size to the document and remembers it", () => {
    const root = { dataset: {} as DOMStringMap };
    const stored = new Map<string, string>();
    applyTextSize("lg", root, { setItem: (k, v) => void stored.set(k, v) });
    expect(root.dataset.textSize).toBe("lg");
    expect(stored.get(TEXT_SIZE_STORAGE_KEY)).toBe("lg");
  });

  it("still applies it when storage throws", () => {
    const root = { dataset: {} as DOMStringMap };
    applyTextSize("sm", root, {
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(root.dataset.textSize).toBe("sm");
  });

  it("the pre-paint script sets a stored size and ignores anything else", () => {
    const run = (stored: string | null) => {
      const documentElement = { dataset: {} as DOMStringMap };
      new Function("localStorage", "document", TEXT_SIZE_SCRIPT)({ getItem: (k: string) => (k === TEXT_SIZE_STORAGE_KEY ? stored : null) }, { documentElement });
      return documentElement.dataset.textSize;
    };
    expect(run("lg")).toBe("lg");
    expect(run("sm")).toBe("sm");
    expect(run("huge")).toBeUndefined();
    expect(run(null)).toBeUndefined();
  });
});
