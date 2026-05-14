// @ts-nocheck
import * as __fd_glob_13 from "../content/docs/sentinel/index.mdx?collection=docs"
import * as __fd_glob_12 from "../content/docs/sentinel/etl-pipeline.mdx?collection=docs"
import * as __fd_glob_11 from "../content/docs/sentinel/data-sources.mdx?collection=docs"
import * as __fd_glob_10 from "../content/docs/sentinel/data-model.mdx?collection=docs"
import * as __fd_glob_9 from "../content/docs/sentinel/architecture.mdx?collection=docs"
import * as __fd_glob_8 from "../content/docs/sentinel/analysis-engines.mdx?collection=docs"
import * as __fd_glob_7 from "../content/docs/capital/index.mdx?collection=docs"
import * as __fd_glob_6 from "../content/docs/business/market-research.mdx?collection=docs"
import * as __fd_glob_5 from "../content/docs/business/index.mdx?collection=docs"
import * as __fd_glob_4 from "../content/docs/index.mdx?collection=docs"
import { default as __fd_glob_3 } from "../content/docs/sentinel/meta.json?collection=docs"
import { default as __fd_glob_2 } from "../content/docs/capital/meta.json?collection=docs"
import { default as __fd_glob_1 } from "../content/docs/business/meta.json?collection=docs"
import { default as __fd_glob_0 } from "../content/docs/meta.json?collection=docs"
import { server } from 'fumadocs-mdx/runtime/server';
import type * as Config from '../source.config';

const create = server<typeof Config, import("fumadocs-mdx/runtime/types").InternalTypeConfig & {
  DocData: {
  }
}>({"doc":{"passthroughs":["extractedReferences"]}});

export const docs = await create.docs("docs", "content/docs", {"meta.json": __fd_glob_0, "business/meta.json": __fd_glob_1, "capital/meta.json": __fd_glob_2, "sentinel/meta.json": __fd_glob_3, }, {"index.mdx": __fd_glob_4, "business/index.mdx": __fd_glob_5, "business/market-research.mdx": __fd_glob_6, "capital/index.mdx": __fd_glob_7, "sentinel/analysis-engines.mdx": __fd_glob_8, "sentinel/architecture.mdx": __fd_glob_9, "sentinel/data-model.mdx": __fd_glob_10, "sentinel/data-sources.mdx": __fd_glob_11, "sentinel/etl-pipeline.mdx": __fd_glob_12, "sentinel/index.mdx": __fd_glob_13, });
