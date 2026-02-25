#!/usr/bin/env bash
set -euo pipefail

print_status() {
  local service_name="$1"
  local active_state
  local enabled_state

  active_state="$(systemctl is-active "$service_name" 2>/dev/null || true)"
  enabled_state="$(systemctl is-enabled "$service_name" 2>/dev/null || true)"

  printf "%-24s active=%-10s enabled=%s\n" "$service_name" "$active_state" "$enabled_state"
}

echo "Local access checks (Raspberry Pi)"
echo "=================================="
print_status tailscaled
print_status agentic-journal

if command -v tailscale >/dev/null 2>&1; then
  ts_ip="$(tailscale ip -4 2>/dev/null | head -n 1 || true)"
  ts_name="$(tailscale status --json 2>/dev/null | grep -m1 '\"DNSName\"' | awk -F'\"' '{print $4}' | sed 's/\.$//' || true)"
  echo
  echo "Tailnet address info"
  echo "--------------------"
  echo "IPv4: ${ts_ip:-unavailable}"
  echo "MagicDNS: ${ts_name:-unavailable}"
  echo
  if [[ -n "${ts_name:-}" ]]; then
    echo "Open from your MacBook:"
    echo "  http://${ts_name}:3000"
  elif [[ -n "${ts_ip:-}" ]]; then
    echo "Open from your MacBook:"
    echo "  http://${ts_ip}:3000"
  fi
else
  echo
  echo "tailscale CLI not found."
fi
