#!/usr/bin/env bash
#
# One-shot updater for the self-hosted Xoddy IPDR Server (Ubuntu).
#
#   sudo update xoddy-ipdr
#
# Pulls the latest code from GitHub non-interactively (no prompts), installs
# dependencies, rebuilds the API server + web UI, applies any database schema
# changes, and restarts the services.
#
set -euo pipefail

# ===========================================================================
# Configuration — edit these ONCE on your server (see install notes below).
# ===========================================================================

# Where the repository is cloned on the server, and which branch to deploy.
# Both can also be set in the env file (see ENV_FILE below).
APP_DIR="${APP_DIR:-/opt/xoddy-ipdr}"
BRANCH="${BRANCH:-main}"

# --- GitHub credentials (used for a non-interactive pull, no prompts) -------
# GH_TOKEN must be a GitHub Personal Access Token with "repo" scope.
# You can either hard-code them here, or (preferred) put them in the env file
# /etc/xoddy-ipdr/xoddy-ipdr.env so no secret lives in this script.
GH_USER="${GH_USER:-pranaylokegaonkar}"
GH_TOKEN="${GH_TOKEN:-<YOUR_GITHUB_TOKEN>}"
GH_REPO="${GH_REPO:-github.com/pranaylokegaonkar/Xoddy-IPDR-Server.git}"

# Build-time env for the web (Vite) bundle.
export PORT="${PORT:-5000}"          # any value; only required so vite.config validates
export BASE_PATH="${BASE_PATH:-/}"   # the path the UI is served under by nginx
export NODE_ENV=production

# systemd unit running the API + UDP collector.
API_SERVICE="${API_SERVICE:-xoddy-ipdr-api}"
# Reload nginx after rebuilding the web UI (1 = yes, 0 = no).
RELOAD_NGINX="${RELOAD_NGINX:-1}"

# Optional env file holding DATABASE_URL/SESSION_SECRET (and optionally
# GH_USER/GH_TOKEN). Sourced if present so `db push` has DATABASE_URL.
ENV_FILE="${ENV_FILE:-/etc/xoddy-ipdr/xoddy-ipdr.env}"

# ===========================================================================
# Implementation — usually no need to edit below this line.
# ===========================================================================

APP_NAME="${1:-xoddy-ipdr}"
if [[ "$APP_NAME" != "xoddy-ipdr" ]]; then
  echo "Unknown app: '$APP_NAME' (only 'xoddy-ipdr' is supported)" >&2
  exit 1
fi

if [[ -f "$ENV_FILE" ]]; then
  echo "==> Loading environment from $ENV_FILE"
  set -a; # shellcheck disable=SC1090
  source "$ENV_FILE"; set +a
fi

if [[ "$GH_TOKEN" == "<YOUR_GITHUB_TOKEN>" || -z "$GH_TOKEN" ]]; then
  echo "ERROR: GH_TOKEN is not set. Edit this script or set it in $ENV_FILE." >&2
  exit 1
fi

echo "==> Updating Xoddy IPDR Server in $APP_DIR (branch: $BRANCH)"
cd "$APP_DIR"

echo "==> Pulling latest code from GitHub (non-interactive)"
git fetch "https://${GH_USER}:${GH_TOKEN}@${GH_REPO}" "$BRANCH"
git checkout "$BRANCH"
git reset --hard FETCH_HEAD

echo "==> Installing dependencies"
corepack enable >/dev/null 2>&1 || true
pnpm install --frozen-lockfile

echo "==> Building libraries, API server, and web UI"
pnpm run typecheck:libs
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/xoddy-ipdr run build

echo "==> Applying database schema changes"
pnpm --filter @workspace/db run push

echo "==> Restarting services"
systemctl restart "$API_SERVICE"
if [[ "$RELOAD_NGINX" == "1" ]]; then
  nginx -t && systemctl reload nginx
fi

echo "==> Done. Xoddy IPDR Server is up to date."
