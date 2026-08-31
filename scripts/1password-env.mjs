#!/usr/bin/env node
// A small CLI wrapper around the local `1password-mcp` server (1Password's
// official Environments MCP server) for scripting env-var management across
// the monorepo's per-app Environments (kodama-labs-<app>-dev convention).
//
// Must run as the `kodama` user with fresh group membership (onepassword /
// onepassword-mcp / onepassword-cli) for the local IPC bridge to the
// 1Password desktop app to work:
//
//   sudo -E -u kodama node scripts/1password-env.mjs <command> [...args]
//
// KODAMA_LABS_1P_ACCOUNT_ID must be set (see `op account list --format=json`,
// the `account_uuid` field).
//
// Commands:
//   list-environments
//   list-variables <environmentName>
//   create-environment <environmentName>
//   rename-environment <environmentName> <newName>
//   append-variables <environmentName> <varsJsonFile>
//     varsJsonFile: JSON array of {"name":"X","value":"Y","concealed":true}
//   create-local-env-file <environmentName> <mountPath>

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const accountId = process.env.KODAMA_LABS_1P_ACCOUNT_ID;
if (!accountId) {
  console.error("KODAMA_LABS_1P_ACCOUNT_ID is not set (see: op account list --format=json)");
  process.exit(1);
}

const [, , command, ...args] = process.argv;

function rpc(child, message) {
  return new Promise((resolve, reject) => {
    const id = message.id;
    const timeout = setTimeout(() => reject(new Error(`timeout waiting for response to ${message.method}`)), 30000);
    function onData(chunk) {
      buf += chunk.toString("utf8");
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (!line.trim()) continue;
        const parsed = JSON.parse(line);
        if (parsed.id === id) {
          clearTimeout(timeout);
          child.stdout.off("data", onData);
          if (parsed.error) reject(new Error(JSON.stringify(parsed.error)));
          else resolve(parsed.result);
        }
      }
    }
    let buf = "";
    child.stdout.on("data", onData);
    child.stdin.write(JSON.stringify(message) + "\n");
  });
}

async function main() {
  const child = spawn("1password-mcp", [], { stdio: ["pipe", "pipe", "inherit"] });
  let nextId = 2;

  await rpc(child, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "1password-env-cli", version: "0.0.1" } },
  });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

  async function callTool(name, toolArgs) {
    const result = await rpc(child, { jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: toolArgs } });
    const text = result?.content?.find((c) => c.type === "text")?.text;
    if (!text) return result;
    try {
      return JSON.parse(text);
    } catch {
      return { message: text };
    }
  }

  await callTool("authenticate", {});

  let environments;
  if (command !== "create-environment") {
    ({ environments } = await callTool("list_environments", { accountId }));
  }

  function findEnv(name) {
    const env = environments?.find((e) => e.name === name);
    if (!env) throw new Error(`Environment "${name}" not found. Known: ${environments.map((e) => e.name).join(", ")}`);
    return env;
  }

  let output;
  switch (command) {
    case "list-environments":
      output = environments;
      break;
    case "list-variables": {
      const env = findEnv(args[0]);
      output = await callTool("list_variables", { accountId, environmentId: env.environmentId });
      break;
    }
    case "create-environment":
      output = await callTool("create_environment", { accountId, environmentName: args[0] });
      break;
    case "rename-environment": {
      // The Environments API can't update or delete an individual variable —
      // append_variables only ever adds. Correcting a wrong value therefore
      // means renaming the old Environment aside and recreating it, which is
      // what this exists for.
      const env = findEnv(args[0]);
      output = await callTool("rename_environment", {
        accountId,
        environmentId: env.environmentId,
        environmentName: env.name,
        newName: args[1],
      });
      break;
    }
    case "append-variables": {
      const env = findEnv(args[0]);
      const allVariables = JSON.parse(readFileSync(args[1], "utf8"));
      // append_variables has no upsert/dedup semantics server-side — calling
      // it twice with the same name duplicates the entry. Guard here since
      // the API won't.
      const { variableNames: existing } = await callTool("list_variables", { accountId, environmentId: env.environmentId });
      const variables = allVariables.filter((v) => !existing.includes(v.name));
      const skipped = allVariables.filter((v) => existing.includes(v.name)).map((v) => v.name);
      if (variables.length === 0) {
        output = { message: "Nothing to add — all variables already present.", skipped };
        break;
      }
      const result = await callTool("append_variables", { accountId, environmentId: env.environmentId, variables });
      output = { ...result, added: variables.map((v) => v.name), skipped };
      break;
    }
    case "create-local-env-file": {
      const env = findEnv(args[0]);
      output = await callTool("create_local_env_file", { accountId, environmentId: env.environmentId, environmentName: env.name, mountPath: args[1] });
      break;
    }
    case "list-local-env-files": {
      const env = findEnv(args[0]);
      output = await callTool("list_local_env_files", { accountId, environmentId: env.environmentId });
      break;
    }
    default:
      console.error(`unknown command: ${command}`);
      process.exit(1);
  }

  console.log(JSON.stringify(output, null, 2));
  child.stdin.end();
  process.exit(0);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
