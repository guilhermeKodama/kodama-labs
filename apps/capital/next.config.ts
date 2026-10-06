import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/**
 * Pages of the old UI and where they live now, for bookmarks, the
 * installed PWA and old push notifications. `seed:<key>` opens the seeded
 * view with that key; `assistant=1` opens the assistant in ⌘K. The old
 * UI also had /en/… URLs: those keep the prefix on the new page, and the
 * middleware turns it into the NEXT_LOCALE cookie (so they stay in
 * English). Temporary (307): the new screens may still move.
 */
const LEGACY_PAGES: [source: string, destination: string][] = [
  ["/dashboard", "/transactions"],
  ["/businesses", "/transactions"],
  ["/personal", "/transactions"],
  ["/transfers", "/transactions"],
  ["/reports", "/transactions"],
  ["/tax", "/transactions?view=seed:ir"],
  ["/credit-cards", "/transactions?view=seed:board"],
  ["/recurring", "/transactions/budgets"],
  ["/fire", "/investments/contributions"],
  ["/assistant", "/transactions?assistant=1"],
];

const nextConfig: NextConfig = {
  // The assistant's knowledge base is read from disk at runtime
  // (src/server/modules/assistant/agent/knowledge/index.ts) rather than
  // imported. Next's file tracer needs an explicit hint so a traced
  // server bundle includes the markdown. The Docker image copies the
  // full tree and does not use output: "standalone".
  outputFileTracingIncludes: {
    "/api/[...route]": ["./src/server/modules/assistant/agent/knowledge/*.md"],
  },
  async redirects() {
    return LEGACY_PAGES.flatMap(([source, destination]) => [
      { source: `${source}/:rest*`, destination, permanent: false },
      { source: `/:locale(pt-BR|en)${source}/:rest*`, destination: `/:locale${destination}`, permanent: false },
    ]);
  },
};

export default withNextIntl(nextConfig);
