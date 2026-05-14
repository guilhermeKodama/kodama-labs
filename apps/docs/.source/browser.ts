// @ts-nocheck
import { browser } from 'fumadocs-mdx/runtime/browser';
import type * as Config from '../source.config';

const create = browser<typeof Config, import("fumadocs-mdx/runtime/types").InternalTypeConfig & {
  DocData: {
  }
}>();
const browserCollections = {
  docs: create.doc("docs", {"index.mdx": () => import("../content/docs/index.mdx?collection=docs"), "business/index.mdx": () => import("../content/docs/business/index.mdx?collection=docs"), "business/market-research.mdx": () => import("../content/docs/business/market-research.mdx?collection=docs"), "capital/index 2.mdx": () => import("../content/docs/capital/index 2.mdx?collection=docs"), "capital/index.mdx": () => import("../content/docs/capital/index.mdx?collection=docs"), "sentinel/analysis-engines 2.mdx": () => import("../content/docs/sentinel/analysis-engines 2.mdx?collection=docs"), "sentinel/analysis-engines.mdx": () => import("../content/docs/sentinel/analysis-engines.mdx?collection=docs"), "sentinel/architecture 2.mdx": () => import("../content/docs/sentinel/architecture 2.mdx?collection=docs"), "sentinel/architecture.mdx": () => import("../content/docs/sentinel/architecture.mdx?collection=docs"), "sentinel/data-model 2.mdx": () => import("../content/docs/sentinel/data-model 2.mdx?collection=docs"), "sentinel/data-model.mdx": () => import("../content/docs/sentinel/data-model.mdx?collection=docs"), "sentinel/data-sources 2.mdx": () => import("../content/docs/sentinel/data-sources 2.mdx?collection=docs"), "sentinel/data-sources.mdx": () => import("../content/docs/sentinel/data-sources.mdx?collection=docs"), "sentinel/etl-pipeline 2.mdx": () => import("../content/docs/sentinel/etl-pipeline 2.mdx?collection=docs"), "sentinel/etl-pipeline.mdx": () => import("../content/docs/sentinel/etl-pipeline.mdx?collection=docs"), "sentinel/index 2.mdx": () => import("../content/docs/sentinel/index 2.mdx?collection=docs"), "sentinel/index.mdx": () => import("../content/docs/sentinel/index.mdx?collection=docs"), }),
};
export default browserCollections;