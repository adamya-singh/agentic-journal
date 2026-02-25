#!/usr/bin/env bash
set -euo pipefail

if ! command -v tailscale >/dev/null 2>&1; then
  echo "tailscale CLI not found. Install Tailscale first."
  exit 1
fi

ts_name="$(tailscale status --json 2>/dev/null | grep -m1 '\"DNSName\"' | awk -F'\"' '{print $4}' | sed 's/\.$//' || true)"

echo "Configuring Tailscale HTTPS routes..."
echo "  443   -> http://127.0.0.1:3000   (Agentic Journal)"
echo "  18443 -> http://127.0.0.1:18789  (OpenClaw)"

serve_cmd() {
  local args=("$@")
  if command -v timeout >/dev/null 2>&1; then
    timeout 8s tailscale serve "${args[@]}"
  else
    tailscale serve "${args[@]}"
  fi
}

set +e
out_443="$(serve_cmd --bg --https=443 http://127.0.0.1:3000 2>&1)"
rc_443=$?
out_18443="$(serve_cmd --bg --https=18443 http://127.0.0.1:18789 2>&1)"
rc_18443=$?
set -e

if [[ $rc_443 -ne 0 || $rc_18443 -ne 0 ]]; then
  echo
  echo "Failed to configure one or more routes."
  [[ -n "$out_443" ]] && echo "$out_443"
  [[ -n "$out_18443" ]] && echo "$out_18443"
  echo
  echo "If Serve is disabled in your tailnet, enable it once in admin:"
  echo "  https://login.tailscale.com/f/serve"
  echo
  echo "Then rerun:"
  echo "  npm run setup:tailscale-https"
  exit 1
fi

echo
echo "Configured successfully."
tailscale serve status
echo
if [[ -n "${ts_name:-}" ]]; then
  echo "Open from your MacBook:"
  echo "  Agentic Journal: https://${ts_name}"
  echo "  OpenClaw:        https://${ts_name}:18443"
fi
