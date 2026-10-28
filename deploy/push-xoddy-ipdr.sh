#!/usr/bin/env bash
#
# Push the current committed main branch to the configured Git remote.
# Commit and review changes in Replit's Git pane before running this helper.
#
set -euo pipefail

branch="$(git branch --show-current)"
if [[ "$branch" != "main" ]]; then
  echo "ERROR: Expected branch 'main', found '$branch'." >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "ERROR: Commit and review all changes in Replit's Git pane before pushing." >&2
  exit 1
fi

echo "==> Pushing committed main branch to origin"
git push origin main
