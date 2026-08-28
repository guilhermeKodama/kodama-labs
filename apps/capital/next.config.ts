import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // The assistant's knowledge base is read from disk at runtime
  // (src/server/modules/assistant/agent/knowledge/index.ts) rather than
  // imported, so Next's file tracer needs an explicit hint to bundle the
  // markdown files into the serverless output.
  outputFileTracingIncludes: {
    "/api/[...route]": ["./src/server/modules/assistant/agent/knowledge/*.md"],
  },
};

export default withNextIntl(nextConfig);
