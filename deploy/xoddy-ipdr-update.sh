#!/usr/bin/env bash
#
# Install this file as /usr/local/sbin/xoddy-ipdr-update on the Ubuntu server.
# Run it with: sudo xoddy-ipdr-update
#
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/xoddy-ipdr}"
BRANCH="${BRANCH:-main}"
API_SERVICE="${API_SERVICE:-xoddy-ipdr}"
RELOAD_NGINX="${RELOAD_NGINX:-1}"

export PORT="${PORT:-5000}"
export BASE_PATH="${BASE_PATH:-/}"
export NODE_ENV=production
export npm_config_verify_deps_before_run=false

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this command with sudo: sudo xoddy-ipdr-update" >&2
  exit 1
fi

if [[ ! -d "$APP_DIR/.git" ]]; then
  echo "ERROR: No Git checkout found at $APP_DIR" >&2
  exit 1
fi

# Select the running service's environment, not a potentially stale second file.
# An explicit ENV_FILE always takes precedence.
if [[ -z "${ENV_FILE:-}" ]]; then
  service_env="$(systemctl show "$API_SERVICE" --property=EnvironmentFiles --value 2>/dev/null || true)"
  if [[ -n "$service_env" ]]; then
    if [[ "$service_env" =~ ^([^[:space:]]+)[[:space:]]+\(ignore_errors=(yes|no)\)$ ]]; then
      ENV_FILE="${BASH_REMATCH[1]}"
    else
      echo "ERROR: Multiple or complex service environment files. Set ENV_FILE explicitly." >&2
      exit 1
    fi
  elif [[ -f "$APP_DIR/.env" ]]; then
    ENV_FILE="$APP_DIR/.env"
  else
    ENV_FILE="/etc/xoddy-ipdr/xoddy-ipdr.env"
  fi
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: Application environment file not found: $ENV_FILE" >&2
  exit 1
fi

echo "==> Loading application environment from $ENV_FILE"
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL is missing from the selected environment." >&2
  exit 1
fi

cd "$APP_DIR"
git config --global --get-all safe.directory 2>/dev/null | grep -Fqx "$APP_DIR" \
  || git config --global --add safe.directory "$APP_DIR"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "ERROR: $APP_DIR has local changes. Save or remove them before updating." >&2
  exit 1
fi

echo "==> Fetching $BRANCH from the configured Git remote"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git merge --ff-only FETCH_HEAD

echo "==> Installing dependencies"
install_log="$(mktemp)"
if pnpm install --frozen-lockfile >"$install_log" 2>&1; then
  cat "$install_log"
elif grep -q "ERR_PNPM_IGNORED_BUILDS" "$install_log"; then
  cat "$install_log"
  echo "    Continuing past pnpm's ignored-build-scripts notice; build checks follow."
else
  cat "$install_log" >&2
  rm -f "$install_log"
  exit 1
fi
rm -f "$install_log"

echo "==> Checking configured database connection"
(
  cd "$APP_DIR/lib/db"
  node --input-type=module <<'NODE'
import pg from 'pg';
const db = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
  query_timeout: 10000,
});
try {
  await db.connect();
  await db.query('SELECT 1');
  console.log('Database connection OK');
} catch (error) {
  console.error(`Database connection failed (${error.code || error.name}). Check the selected environment file; no schema changes attempted.`);
  process.exitCode = 1;
} finally {
  await db.end().catch(() => {});
}
NODE
)

echo "==> Checking and building libraries, API, and web UI"
pnpm run typecheck:libs
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/xoddy-ipdr run build

echo "==> Applying database schema changes"
pnpm --filter @workspace/db run push

echo "==> Restarting API service"
systemctl restart "$API_SERVICE"
if [[ "$RELOAD_NGINX" == "1" ]]; then
  nginx -t
  systemctl reload nginx
fi

echo "==> Update complete: $(git rev-parse --short HEAD)"
