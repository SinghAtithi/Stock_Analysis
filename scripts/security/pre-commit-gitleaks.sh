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

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "[pre-commit] gitleaks not installed — skipping local scan (CI will scan)."
  exit 0
fi

exec gitleaks protect --staged --redact -v
