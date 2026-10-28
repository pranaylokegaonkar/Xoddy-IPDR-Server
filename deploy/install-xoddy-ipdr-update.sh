#!/usr/bin/env bash
#
# Install the Xoddy IPDR updater command on a freshly set up Ubuntu server.
# Run after cloning the repository:
#   sudo bash /opt/xoddy-ipdr/deploy/install-xoddy-ipdr-update.sh
#
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/xoddy-ipdr}"
UPDATER_SOURCE="$APP_DIR/deploy/xoddy-ipdr-update.sh"
UPDATER_DEST="/usr/local/sbin/xoddy-ipdr-update"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this installer with sudo." >&2
  exit 1
fi

if [[ ! -f "$UPDATER_SOURCE" ]]; then
  echo "ERROR: Updater not found at $UPDATER_SOURCE" >&2
  echo "Clone or pull the Xoddy IPDR repository first." >&2
  exit 1
fi

install -o root -g root -m 0755 "$UPDATER_SOURCE" "$UPDATER_DEST"
echo "Installed $UPDATER_DEST"
echo "Ensure root can fetch the repository, then update with: sudo xoddy-ipdr-update"
