#!/usr/bin/env node
// Converts a .env file into the JSON array shape 1password-env.mjs's
// `append-variables` expects, WITHOUT printing any secret values to
// stdout — only variable names are ever echoed back, so this is safe to
// run in a context where the values themselves shouldn't be surfaced.
//
// usage: env-to-1password-vars.mjs <envFile> <outputJsonFile>

import { readFileSync, writeFileSync } from "node:fs";

const [, , envFile, outputJsonFile] = process.argv;
if (!envFile || !outputJsonFile) {
  console.error("usage: env-to-1password-vars.mjs <envFile> <outputJsonFile>");
  process.exit(1);
}

const lines = readFileSync(envFile, "utf8").split("\n");
const variables = [];

for (const rawLine of lines) {
  const line = rawLine.trim();
  if (!line || line.startsWith("#")) continue;
  const match = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line);
  if (!match) continue;
  const [, name, rawValue] = match;
  let value = rawValue.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  if (!value) continue; // skip empty/unset vars — nothing to store
  variables.push({ name, value, concealed: true });
}

writeFileSync(outputJsonFile, JSON.stringify(variables, null, 2));
console.log(`wrote ${variables.length} variable(s): ${variables.map((v) => v.name).join(", ")}`);
