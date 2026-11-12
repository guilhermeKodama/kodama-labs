#!/usr/bin/env python3
"""Atomic read/write for ~/deploys/status.json. Values come from argv or env, never from a log line."""

import json
import os
import sys

UNITS = (
    "monitoring",
    "kodamalabs",
    "careers",
    "attention",
    "sentinel",
    "capital",
    "cronjobs",
    "cloudflared",
)


def status_path() -> str:
    return os.environ.get("KODAMA_STATUS") or os.path.expanduser("~/deploys/status.json")


def load() -> dict:
    path = status_path()
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise SystemExit(f"status file is not an object: {path}")
    return data


def save(data: dict) -> None:
    path = status_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    temporary = path + ".tmp"
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2)
        handle.write("\n")
    os.replace(temporary, path)


def apps(data: dict) -> dict:
    raw = data.get("apps")
    if not isinstance(raw, dict):
        raw = {}
        data["apps"] = raw
    return raw


def blank_app(sha: str) -> dict:
    return {"sha": sha, "result": "success", "error": "", "failedSha": ""}


def cmd_init(sha: str) -> None:
    data = {
        "targetSha": sha,
        "result": "success",
        "startedAt": "",
        "finishedAt": "",
        "log": "",
        "error": "",
        "dumps": [],
        "blockedSha": "",
        "blockedReason": "",
        "postgresWarnedSha": "",
        "tooling_drift": False,
        "apps": {unit: blank_app(sha) for unit in UNITS},
    }
    save(data)


def lookup(data: dict, dotted: str) -> str:
    current = data
    for part in dotted.split("."):
        if not isinstance(current, dict) or part not in current:
            return ""
        current = current[part]
    if current is None:
        return ""
    if isinstance(current, bool):
        return "true" if current else "false"
    if isinstance(current, (dict, list)):
        return json.dumps(current, separators=(",", ":"))
    return str(current)


def cmd_set_app_success(unit: str, sha: str) -> None:
    data = load()
    app = apps(data).setdefault(unit, blank_app(""))
    app["sha"] = sha
    app["result"] = "success"
    app["error"] = ""
    app["failedSha"] = ""
    save(data)


def cmd_set_app_failure(unit: str, result: str, sha: str) -> None:
    data = load()
    app = apps(data).setdefault(unit, blank_app(""))
    app["result"] = result
    app["error"] = os.environ.get("KODAMA_STATUS_ERROR", "")
    app["failedSha"] = sha
    save(data)


def cmd_block(sha: str) -> None:
    data = load()
    data["blockedSha"] = sha
    data["blockedReason"] = os.environ.get("KODAMA_STATUS_ERROR", "")
    data["targetSha"] = sha
    data["result"] = os.environ.get("KODAMA_STATUS_RESULT", "failure")
    save(data)


def cmd_mark_start(sha: str, log: str) -> None:
    data = load()
    data["targetSha"] = sha
    data["result"] = "in_progress"
    data["startedAt"] = os.environ.get("KODAMA_STATUS_NOW", "")
    data["finishedAt"] = ""
    data["log"] = log
    data["error"] = ""
    data["dumps"] = []
    save(data)


def cmd_mark_end(result: str) -> None:
    data = load()
    data["result"] = result
    data["finishedAt"] = os.environ.get("KODAMA_STATUS_NOW", "")
    data["error"] = os.environ.get("KODAMA_STATUS_ERROR", "")
    if result == "success":
        data["blockedSha"] = ""
        data["blockedReason"] = ""
    save(data)


def cmd_add_dump(dump: str) -> None:
    data = load()
    dumps = data.get("dumps")
    if not isinstance(dumps, list):
        dumps = []
    dumps.append(dump)
    data["dumps"] = dumps
    save(data)


def cmd_clear_block() -> None:
    data = load()
    data["blockedSha"] = ""
    data["blockedReason"] = ""
    save(data)


def cmd_set_field(key: str, value: str) -> None:
    if not key.isidentifier() or key == "apps":
        raise SystemExit(f"refusing to set {key}")
    data = load()
    if key == "tooling_drift":
        data[key] = value == "true"
    else:
        data[key] = value
    save(data)


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("usage: status.py <command> [args]")
    command = sys.argv[1]
    if command == "init":
        cmd_init(sys.argv[2])
    elif command == "get":
        print(lookup(load(), sys.argv[2]))
    elif command == "set-app-success":
        cmd_set_app_success(sys.argv[2], sys.argv[3])
    elif command == "set-app-failure":
        cmd_set_app_failure(sys.argv[2], sys.argv[3], sys.argv[4])
    elif command == "block":
        cmd_block(sys.argv[2])
    elif command == "mark-start":
        cmd_mark_start(sys.argv[2], sys.argv[3])
    elif command == "mark-end":
        cmd_mark_end(sys.argv[2])
    elif command == "add-dump":
        cmd_add_dump(sys.argv[2])
    elif command == "clear-block":
        cmd_clear_block()
    elif command == "set-field":
        cmd_set_field(sys.argv[2], sys.argv[3])
    else:
        raise SystemExit(f"unknown command {command}")


if __name__ == "__main__":
    main()
