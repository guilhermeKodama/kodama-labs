import { spawnSync } from "node:child_process";
import fs from "node:fs";

export interface PsqlResult {
  status: number;
  stdout: string;
  stderr: string;
}

function connection() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is unset");
  const url = new URL(raw);
  return {
    host: url.hostname,
    port: url.port || "5432",
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
  };
}

/** The database DATABASE_URL points at. */
export function testDatabase(): string {
  return connection().database;
}

// Machines without a psql client (a Mac with Postgres only in Docker) run it
// inside the dev compose's `postgres` container instead; `-f` files are then
// piped in, since the container cannot see host paths.
const HOST_PSQL = spawnSync("psql", ["--version"], { encoding: "utf8" }).status === 0;
const PSQL_CONTAINER = process.env.CAPITAL_TEST_PSQL_CONTAINER ?? "postgres";

/** Runs psql against `database` with ON_ERROR_STOP; `input` is fed on stdin. */
export function psql(database: string, args: string[], input?: string): PsqlResult {
  const creds = connection();
  const common = ["-U", creds.user, "-d", database, "-v", "ON_ERROR_STOP=1", "-X"];
  let result;
  if (HOST_PSQL) {
    result = spawnSync("psql", ["-h", creds.host, "-p", creds.port, ...common, ...args], {
      encoding: "utf8",
      input,
      env: { ...process.env, PGPASSWORD: creds.password },
    });
  } else {
    // psql skips stdin when -c is given, so a file run moves every -c in
    // front of the file's text, in the order psql would have run them.
    const fileAt = args.indexOf("-f");
    let stdin = input;
    let rest = args;
    if (fileAt >= 0) {
      const commands = args.flatMap((a, i) => (args[i - 1] === "-c" ? [`${a};`] : []));
      stdin = [...commands, fs.readFileSync(args[fileAt + 1], "utf8")].join("\n");
      rest = args.filter((a, i) => a !== "-c" && args[i - 1] !== "-c" && i !== fileAt && i !== fileAt + 1);
    }
    result = spawnSync("docker", ["exec", "-i", "-e", `PGPASSWORD=${creds.password}`, PSQL_CONTAINER, "psql", ...common, ...rest], {
      encoding: "utf8",
      input: stdin,
    });
  }
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}
