#!/usr/bin/env bash
# TASK-1374 — optional local pre-commit secret scan.
#
# The AUTHORITATIVE gitleaks scan runs in ci.yml's `security` job (full
# history, blocking). This hook is a convenience for catching leaks before
# they're pushed at all. Install:
#   cp scripts/security/pre-commit-gitleaks.sh .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
# It self-skips (exit 0) when the gitleaks binary is absent, so it never
# blocks contributors who rely on CI alone.

set -u

# TASK-1497: never let a torn/conflicted data/board.json reach git — a stash
# pop that conflicts leaves <<<<<<< markers in the file, and one landed in
# the live board (2026-08-24, incident #4). Fail the commit instead.
if [ -f data/board.json ]; then
  node -e "JSON.parse(require('fs').readFileSync('data/board.json','utf8'))" 2>/dev/null || {
    echo "[pre-commit] data/board.json is not valid JSON — fix or checkout before committing." >&2
    exit 1
  }
fi

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "[pre-commit] gitleaks not installed — skipping local scan (CI will scan)."
  exit 0
fi

exec gitleaks protect --staged --redact -v
