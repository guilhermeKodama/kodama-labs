import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "react-hooks/incompatible-library": "off",
    },
  },
  {
    // Every word a reader sees comes from src/messages, so a later copy pass
    // (and a second language) touches message files only.
    files: ["src/components/**/*.tsx", "src/figures/**/*.tsx", "src/app/**/*.tsx"],
    ignores: ["**/__tests__/**"],
    rules: {
      "react/jsx-no-literals": ["error", { noStrings: true, ignoreProps: true }],
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The approved mockup, kept as the porting spec. Never imported.
    "design/**",
  ]),
]);

export default eslintConfig;
