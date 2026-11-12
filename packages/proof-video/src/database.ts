const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** `<app>_proof_<checkout>_dev`: one throwaway database per app and checkout. */
export function proofDatabaseName(app: string, slug: string): string {
  return `${app}_proof_${slug}_dev`;
}

function isProofName(name: string, app: string): boolean {
  return new RegExp(`^${app}_proof_[a-z0-9_]+_dev$`).test(name);
}

/** Parses without ever putting the URL, which holds a password, into the error. */
function parse(url: string): URL {
  try {
    return new URL(url);
  } catch {
    throw new Error("[proof] The database URL cannot be parsed.");
  }
}

/**
 * Throws unless `url` is a proof database on this machine. There is no
 * override: a recording writes demo data, runs the branch's migrations
 * and may reset the database, so it must never reach a shared one.
 */
export function assertProofDatabase(url: string, app: string): void {
  const parsed = parse(url);
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!LOCAL_HOSTS.has(parsed.hostname)) {
    throw new Error(`[proof] Refusing the database server "${parsed.hostname}": proof runs only use a local server.`);
  }
  // Some drivers let a `host` parameter replace the host in the URL.
  const host = parsed.searchParams.get("host");
  if (host !== null && !LOCAL_HOSTS.has(host)) {
    throw new Error(`[proof] Refusing the database server "${host}": proof runs only use a local server.`);
  }
  if (!isProofName(name, app)) {
    throw new Error(`[proof] Refusing the database "${name}": proof runs only use ${proofDatabaseName(app, "<checkout>")}.`);
  }
}

/**
 * The proof database for this checkout: the server and login of
 * `sourceUrl` (the app's own dev database URL), with the database name
 * replaced and every connection parameter dropped except `schema`.
 */
export function proofDatabaseUrl(sourceUrl: string, app: string, slug: string): string {
  const url = parse(sourceUrl);
  url.pathname = `/${proofDatabaseName(app, slug)}`;
  const schema = url.searchParams.get("schema");
  url.search = schema ? `?schema=${encodeURIComponent(schema)}` : "";
  const derived = url.toString();
  assertProofDatabase(derived, app);
  return derived;
}
