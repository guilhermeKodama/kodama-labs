// @ts-nocheck
import * as __fd_glob_22 from "../content/docs/sentinel/index.mdx?collection=docs"
import * as __fd_glob_21 from "../content/docs/sentinel/index 2.mdx?collection=docs"
import * as __fd_glob_20 from "../content/docs/sentinel/etl-pipeline.mdx?collection=docs"
import * as __fd_glob_19 from "../content/docs/sentinel/etl-pipeline 2.mdx?collection=docs"
import * as __fd_glob_18 from "../content/docs/sentinel/data-sources.mdx?collection=docs"
import * as __fd_glob_17 from "../content/docs/sentinel/data-sources 2.mdx?collection=docs"
import * as __fd_glob_16 from "../content/docs/sentinel/data-model.mdx?collection=docs"
import * as __fd_glob_15 from "../content/docs/sentinel/data-model 2.mdx?collection=docs"
import * as __fd_glob_14 from "../content/docs/sentinel/architecture.mdx?collection=docs"
import * as __fd_glob_13 from "../content/docs/sentinel/architecture 2.mdx?collection=docs"
import * as __fd_glob_12 from "../content/docs/sentinel/analysis-engines.mdx?collection=docs"
import * as __fd_glob_11 from "../content/docs/sentinel/analysis-engines 2.mdx?collection=docs"
import * as __fd_glob_10 from "../content/docs/capital/index.mdx?collection=docs"
import * as __fd_glob_9 from "../content/docs/capital/index 2.mdx?collection=docs"
import * as __fd_glob_8 from "../content/docs/business/market-research.mdx?collection=docs"
import * as __fd_glob_7 from "../content/docs/business/index.mdx?collection=docs"
import * as __fd_glob_6 from "../content/docs/index.mdx?collection=docs"
import { default as __fd_glob_5 } from "../content/docs/sentinel/meta.json?collection=docs"
import { default as __fd_glob_4 } from "../content/docs/sentinel/meta 2.json?collection=docs"
import { default as __fd_glob_3 } from "../content/docs/capital/meta.json?collection=docs"
import { default as __fd_glob_2 } from "../content/docs/capital/meta 2.json?collection=docs"
import { default as __fd_glob_1 } from "../content/docs/business/meta.json?collection=docs"
import { default as __fd_glob_0 } from "../content/docs/meta.json?collection=docs"
import { server } from 'fumadocs-mdx/runtime/server';
import type * as Config from '../source.config';

const create = server<typeof Config, import("fumadocs-mdx/runtime/types").InternalTypeConfig & {
  DocData: {
  }
}>({"doc":{"passthroughs":["extractedReferences"]}});

export const docs = await create.docs("docs", "content/docs", {"meta.json": __fd_glob_0, "business/meta.json": __fd_glob_1, "capital/meta 2.json": __fd_glob_2, "capital/meta.json": __fd_glob_3, "sentinel/meta 2.json": __fd_glob_4, "sentinel/meta.json": __fd_glob_5, }, {"index.mdx": __fd_glob_6, "business/index.mdx": __fd_glob_7, "business/market-research.mdx": __fd_glob_8, "capital/index 2.mdx": __fd_glob_9, "capital/index.mdx": __fd_glob_10, "sentinel/analysis-engines 2.mdx": __fd_glob_11, "sentinel/analysis-engines.mdx": __fd_glob_12, "sentinel/architecture 2.mdx": __fd_glob_13, "sentinel/architecture.mdx": __fd_glob_14, "sentinel/data-model 2.mdx": __fd_glob_15, "sentinel/data-model.mdx": __fd_glob_16, "sentinel/data-sources 2.mdx": __fd_glob_17, "sentinel/data-sources.mdx": __fd_glob_18, "sentinel/etl-pipeline 2.mdx": __fd_glob_19, "sentinel/etl-pipeline.mdx": __fd_glob_20, "sentinel/index 2.mdx": __fd_glob_21, "sentinel/index.mdx": __fd_glob_22, });