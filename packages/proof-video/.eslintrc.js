/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  extends: ["@repo/eslint-config/library.js"],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: true,
    tsconfigRootDir: __dirname,
  },
  rules: {
    // TypeScript already reports both, and the plain rules misread type
    // signatures and the browser code passed to page.evaluate.
    "no-unused-vars": "off",
    "no-undef": "off",
    // PROOF_RECORD and CI switch behaviour at run time; no cached task depends on them.
    "turbo/no-undeclared-env-vars": "off",
  },
};
