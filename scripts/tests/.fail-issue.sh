#!/usr/bin/env bash
# Failure notifier for scheduled pipelines (TASK-47).
# Opens one issue per pipeline name; if an open issue already exists, appends
# a comment with the run link instead. Requires GH_TOKEN + GITHUB_REPOSITORY.
set -euo pipefail

PIPELINE="${1:?pipeline name required}"
RUN_ID="${2:-unknown}"
REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY required}"
TITLE="pipeline: ${PIPELINE} failed"
BODY="Scheduled pipeline \`${PIPELINE}\` failed.

- Run: https://github.com/${REPO}/actions/runs/${RUN_ID}
- First seen: $(date -u '+%Y-%m-%dT%H:%M:%SZ')

Latest 30 log lines are in the run page — check the failing step."

# find an existing open issue with the exact title
EXISTING=$(gh issue list -R "$REPO" --state open --search "${TITLE} in:title" --json number --jq '.[0].number' 2>/dev/null || true)

if [ -n "$EXISTING" ]; then
  gh issue comment "$EXISTING" -R "$REPO" --body "$BODY" >/dev/null
  echo "appended failure to issue #${EXISTING}"
else
  gh issue create -R "$REPO" --title "$TITLE" --body "$BODY" >/dev/null
  echo "opened failure issue"
fi
