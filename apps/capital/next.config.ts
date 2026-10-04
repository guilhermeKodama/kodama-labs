import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // The assistant's knowledge base is read from disk at runtime
  // (src/server/modules/assistant/agent/knowledge/index.ts) rather than
  // imported. Next's file tracer needs an explicit hint so a traced
  // server bundle includes the markdown. The Docker image copies the
  // full tree and does not use output: "standalone".
  outputFileTracingIncludes: {
    "/api/[...route]": ["./src/server/modules/assistant/agent/knowledge/*.md"],
  },
};

export default withNextIntl(nextConfig);
