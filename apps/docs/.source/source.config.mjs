// source.config.ts
import {
  defineConfig,
  defineDocs,
  frontmatterSchema,
  metaSchema
} from "fumadocs-mdx/config";
import { remarkMdxMermaid } from "fumadocs-core/mdx-plugins";
import { rehypeCodeDefaultOptions } from "fumadocs-core/mdx-plugins";
var docs = defineDocs({
  dir: "content/docs",
  docs: {
    schema: frontmatterSchema,
    postprocess: {
      includeProcessedMarkdown: true
    }
  },
  meta: {
    schema: metaSchema
  }
});
var source_config_default = defineConfig({
  mdxOptions: {
    remarkPlugins: [remarkMdxMermaid],
    rehypeCodeOptions: {
      themes: {
        light: "github-light",
        dark: "github-dark"
      },
      transformers: [...rehypeCodeDefaultOptions.transformers ?? []]
    }
  }
});
export {
  source_config_default as default,
  docs
};
