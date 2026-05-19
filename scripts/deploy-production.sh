#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/home/rpi5/projects/agentic-journal"
BACKEND_DIR="${ROOT_DIR}/src/backend"
MASTRA_OUTPUT_DIR="${BACKEND_DIR}/.mastra/output"
PROD_SERVICE="agentic-journal.service"
DEV_SERVICE="agentic-journal-dev.service"
SYSTEMD_DIR="${ROOT_DIR}/systemd"

systemctl_cmd() {
  if [[ "${EUID}" -eq 0 ]]; then
    systemctl "$@"
  else
    sudo systemctl "$@"
  fi
}

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command not found: ${command_name}" >&2
    exit 1
  fi
}

install_unit_if_changed() {
  local service_name="$1"
  local source_path="${SYSTEMD_DIR}/${service_name}"
  local target_path="/etc/systemd/system/${service_name}"

  test -f "$source_path"

  if [[ ! -f "$target_path" ]] || ! cmp -s "$source_path" "$target_path"; then
    echo "Installing ${service_name}..."
    if [[ "${EUID}" -eq 0 ]]; then
      install -m 0644 "$source_path" "$target_path"
    else
      sudo install -m 0644 "$source_path" "$target_path"
    fi
  fi
}

wait_for_http() {
  local label="$1"
  local url="$2"
  local attempts="${3:-30}"

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

require_command npm
require_command pnpm
require_command curl
require_command sudo

cd "$ROOT_DIR"

echo "Installing Agentic Journal service units..."
install_unit_if_changed "$PROD_SERVICE"
install_unit_if_changed "$DEV_SERVICE"
systemctl_cmd daemon-reload
systemctl_cmd enable "$PROD_SERVICE" >/dev/null
systemctl_cmd disable "$DEV_SERVICE" >/dev/null 2>&1 || true

echo "Stopping Agentic Journal services..."
systemctl_cmd stop "$DEV_SERVICE" || true
systemctl_cmd stop "$PROD_SERVICE" || true

echo
echo "Installing root dependencies..."
npm ci

echo
echo "Building Next.js from a clean output directory..."
rm -rf "${ROOT_DIR}/.next"
rm -rf "${BACKEND_DIR}/.mastra"
npm run build
test -s "${ROOT_DIR}/.next/BUILD_ID"

echo
echo "Installing backend dependencies with pnpm..."
pnpm --dir "$BACKEND_DIR" install --frozen-lockfile

echo
echo "Building Mastra from a clean output directory..."
pnpm --dir "$BACKEND_DIR" run build
test -s "${MASTRA_OUTPUT_DIR}/package.json"

echo
echo "Installing Mastra generated production dependencies..."
pnpm --dir "$MASTRA_OUTPUT_DIR" install --prod

echo
echo "Starting Agentic Journal service..."
systemctl_cmd start "$PROD_SERVICE"

echo
echo "Verifying local endpoints..."
wait_for_http "Next root" "http://127.0.0.1:3000/"
wait_for_http "Jobs API" "http://127.0.0.1:3000/api/jobs/list"
wait_for_http "Mastra direct" "http://127.0.0.1:4111/"
wait_for_http "Mastra proxy" "http://127.0.0.1:3000/mastra"

echo
echo "Service status:"
systemctl --no-pager --full status "$PROD_SERVICE"
