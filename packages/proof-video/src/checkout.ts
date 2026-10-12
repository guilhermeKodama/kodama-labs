import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";

/**
 * Root of the checkout that contains `dir`. A git worktree is its own
 * checkout, so two worktrees of one repository get different roots.
 */
export function checkoutRoot(dir: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return path.resolve(dir);
  }
}

/**
 * The checkout's folder name, reduced to lowercase letters, digits and
 * underscores so it can sit inside a database name without quoting.
 */
export function slugFromPath(root: string, maxLength = 40): string {
  const slug = path
    .basename(root)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return (slug || "checkout").slice(0, maxLength).replace(/_+$/, "");
}

/** A port that is stable for one checkout and differs between checkouts. */
export function portFromPath(root: string, first = 3200, count = 700): number {
  const hash = createHash("sha1").update(root).digest();
  return first + (hash.readUInt32BE(0) % count);
}

export function checkoutSlug(dir: string, maxLength?: number): string {
  return slugFromPath(checkoutRoot(dir), maxLength);
}

export function checkoutPort(dir: string, first?: number, count?: number): number {
  return portFromPath(checkoutRoot(dir), first, count);
}
