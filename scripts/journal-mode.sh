#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/home/rpi5/projects/agentic-journal"
SYSTEMD_DIR="${ROOT_DIR}/systemd"
PROD_SERVICE="agentic-journal.service"
DEV_SERVICE="agentic-journal-dev.service"
OMI_WORKER_SERVICE="agentic-journal-omi-worker.service"

systemctl_cmd() {
  if [[ "${EUID}" -eq 0 ]]; then
    systemctl "$@"
  else
    sudo systemctl "$@"
  fi
}

journalctl_cmd() {
  if [[ "${EUID}" -eq 0 ]]; then
    journalctl "$@"
  else
    sudo journalctl "$@"
  fi
}

install_unit_if_changed() {
  local service_name="$1"
  local source_path="${SYSTEMD_DIR}/${service_name}"
  local target_path="/etc/systemd/system/${service_name}"

  if [[ ! -f "$source_path" ]]; then
    echo "Missing systemd unit template: ${source_path}" >&2
    exit 1
  fi

  if [[ ! -f "$target_path" ]] || ! cmp -s "$source_path" "$target_path"; then
    echo "Installing ${service_name}..."
    if [[ "${EUID}" -eq 0 ]]; then
      install -m 0644 "$source_path" "$target_path"
    else
      sudo install -m 0644 "$source_path" "$target_path"
    fi
  fi
}

install_units() {
  install_unit_if_changed "$PROD_SERVICE"
  install_unit_if_changed "$DEV_SERVICE"
  install_unit_if_changed "$OMI_WORKER_SERVICE"
  systemctl_cmd daemon-reload
  systemctl_cmd enable "$PROD_SERVICE" >/dev/null
  systemctl_cmd enable "$OMI_WORKER_SERVICE" >/dev/null
  systemctl_cmd disable "$DEV_SERVICE" >/dev/null 2>&1 || true
}

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command not found: ${command_name}" >&2
    exit 1
  fi
}

service_state() {
  local service_name="$1"
  local active_state
  local enabled_state

  active_state="$(systemctl is-active "$service_name" 2>/dev/null || true)"
  enabled_state="$(systemctl is-enabled "$service_name" 2>/dev/null || true)"
  printf "%-28s active=%-10s enabled=%s\n" "$service_name" "$active_state" "$enabled_state"
}

wait_for_http() {
  local label="$1"
  local url="$2"
  local attempts="${3:-45}"

  for _ in $(seq 1 "$attempts"); do
    if curl -fsS -o /dev/null --max-time 5 "$url"; then
      printf "%-24s ok %s\n" "$label" "$url"
      return 0
    fi
    sleep 1
  done

  printf "%-24s failed %s\n" "$label" "$url" >&2
  return 1
}

print_mode() {
  local prod_active
  local dev_active

  prod_active="$(systemctl is-active "$PROD_SERVICE" 2>/dev/null || true)"
  dev_active="$(systemctl is-active "$DEV_SERVICE" 2>/dev/null || true)"

  if [[ "$dev_active" == "active" ]]; then
    echo "Mode: dev"
  elif [[ "$prod_active" == "active" ]]; then
    echo "Mode: production"
  else
    echo "Mode: stopped"
  fi
}

print_status() {
  print_mode
  echo
  service_state "$PROD_SERVICE"
  service_state "$DEV_SERVICE"
  service_state "$OMI_WORKER_SERVICE"
  echo
  echo "Endpoint probes"
  echo "---------------"
  wait_for_http "Next root" "http://127.0.0.1:3000/" 1 || true
  wait_for_http "Jobs API" "http://127.0.0.1:3000/api/jobs/list" 1 || true
  wait_for_http "Mastra direct" "http://127.0.0.1:4111/" 1 || true
  wait_for_http "Mastra proxy" "http://127.0.0.1:3000/mastra" 1 || true
}

switch_to_dev() {
  install_units
  echo "Switching Agentic Journal to dev mode..."
  systemctl_cmd stop "$PROD_SERVICE" || true
  systemctl_cmd start "$DEV_SERVICE"
  echo
  echo "Verifying dev endpoints..."
  wait_for_http "Next root" "http://127.0.0.1:3000/"
  wait_for_http "Jobs API" "http://127.0.0.1:3000/api/jobs/list"
  wait_for_http "Mastra direct" "http://127.0.0.1:4111/"
  wait_for_http "Mastra proxy" "http://127.0.0.1:3000/mastra"
  echo
  print_status
}

switch_to_prod() {
  install_units
  echo "Switching Agentic Journal to production mode..."
  systemctl_cmd stop "$DEV_SERVICE" || true
  systemctl_cmd start "$PROD_SERVICE"
  systemctl_cmd start "$OMI_WORKER_SERVICE"
  echo
  echo "Verifying production endpoints..."
  wait_for_http "Next root" "http://127.0.0.1:3000/"
  wait_for_http "Jobs API" "http://127.0.0.1:3000/api/jobs/list"
  wait_for_http "Mastra direct" "http://127.0.0.1:4111/"
  wait_for_http "Mastra proxy" "http://127.0.0.1:3000/mastra"
  echo
  print_status
}

follow_logs() {
  if [[ "${1:-}" == "worker" || "${1:-}" == "omi" ]]; then
    journalctl_cmd -u "$OMI_WORKER_SERVICE" -f
    return
  fi

  local dev_active
  dev_active="$(systemctl is-active "$DEV_SERVICE" 2>/dev/null || true)"

  if [[ "$dev_active" == "active" ]]; then
    journalctl_cmd -u "$DEV_SERVICE" -f
  else
    journalctl_cmd -u "$PROD_SERVICE" -f
  fi
}

usage() {
  echo "Usage: npm run journal:dev|journal:prod|journal:status|journal:logs"
  echo "       bash scripts/journal-mode.sh dev|prod|status|logs [worker]"
}

require_command systemctl
require_command curl

case "${1:-}" in
  dev)
    switch_to_dev
    ;;
  prod | production)
    switch_to_prod
    ;;
  status)
    install_units
    print_status
    ;;
  logs)
    install_units
    follow_logs "${2:-}"
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
