import { createHash } from "node:crypto";

export interface Signature {
  signature: string;
  hash: string;
}

/** Collapse ids, times and counts so retries of one error share a key. */
export function signatureOf(text: string): Signature {
  let normalized = text.toLowerCase();
  normalized = normalized.replace(/\d{4}-\d{2}-\d{2}t[\d:.]+z?/gi, "");
  normalized = normalized.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    "",
  );
  normalized = normalized.replace(/\b0x[0-9a-f]+\b/gi, "");
  normalized = normalized.replace(/\b\d+\b/g, "");
  normalized = normalized.replace(/https?:\/\/\S+/g, "");

  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const head = (lines[0] ?? "unknown").slice(0, 180);
  const frame = lines.find((line) => line.startsWith("at "));
  const frameKept = frame ? frame.replace(/:\d+/g, "") : "";
  const signature = [head, frameKept].filter((part) => part.length > 0).join(" | ").slice(0, 300);
  const hash = createHash("sha256").update(signature).digest("hex");
  return { signature, hash: `sha256:${hash}` };
}
