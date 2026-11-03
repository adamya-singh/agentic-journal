#!/usr/bin/env bash
set -euo pipefail
REPO_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"
if [[ ! -f /home/openclaw/media-stack/config.json ]]; then
  node scripts/media-stack.ts init
fi
node scripts/media-stack.ts check-storage
for unit in journal-media-stack journal-media-vpn-status journal-media-ac-awake agentic-journal-acquisition-worker agentic-journal-acquisition-guard; do
  sudo -n install -m 0644 "systemd/${unit}.service" "/etc/systemd/system/${unit}.service"
done
sudo -n systemctl daemon-reload
sudo -n systemctl enable --now journal-media-stack journal-media-vpn-status journal-media-ac-awake agentic-journal-acquisition-worker agentic-journal-acquisition-guard
