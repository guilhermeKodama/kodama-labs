#!/usr/bin/env python3
"""Turn deploy.sh's KODAMA_APP lines into the Actions step summary."""

import os
import pathlib
import re
import sys


def render(text: str) -> str:
    rows = re.findall(r"(?m)^KODAMA_APP (\S+) (\S+) (\S+)$", text)
    overall = ""
    match = re.search(r"(?m)^KODAMA_OVERALL (\S+)$", text)
    if match:
        overall = match.group(1)
    warnings = [line for line in text.splitlines() if line.startswith("WARNING: tooling drift:")]
    lines = ["## Production deploy", ""]
    if overall:
        lines.append(f"Overall: `{overall}`")
        lines.append("")
    if warnings:
        lines.append(
            "Tooling drift: the installed scripts differ from this commit. "
            "Re-run `infrastructure/deploy/install.sh` on kodama-ai. Nothing was auto-installed."
        )
        lines.append("")
        for warning in warnings:
            lines.append(f"- {warning}")
        lines.append("")
    if rows:
        lines.append("| App | Result | SHA |")
        lines.append("| --- | --- | --- |")
        for app, result, sha in rows:
            lines.append(f"| {app} | {result} | `{sha}` |")
    else:
        lines.append("No per-app summary was printed.")
    return "\n".join(lines) + "\n"


def main() -> None:
    log_path = pathlib.Path(os.environ.get("DEPLOY_LOG", ""))
    text = ""
    if log_path.is_file():
        text = log_path.read_text(encoding="utf-8", errors="replace")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    body = render(text)
    if summary:
        pathlib.Path(summary).write_text(body, encoding="utf-8")
    else:
        sys.stdout.write(body)


if __name__ == "__main__":
    main()
