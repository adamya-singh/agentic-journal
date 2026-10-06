#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/home/openclaw/projects/agentic-journal"
BACKEND_DIR="${ROOT_DIR}/src/backend"
MASTRA_OUTPUT_DIR="${BACKEND_DIR}/.mastra/output"
PROD_SERVICE="agentic-journal.service"
DEV_SERVICE="agentic-journal-dev.service"
OMI_WORKER_SERVICE="agentic-journal-omi-worker.service"
BOOKMARKS_WORKER_SERVICE="agentic-journal-bookmarks-worker.service"
MEDIA_WORKER_SERVICE="agentic-journal-media-worker.service"
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

# Hash of everything that decides whether an install or build is still current.
inputs_hash() {
  { node --version; cat "$@"; } | sha256sum | cut -d' ' -f1
}

backend_inputs_hash() {
  {
    node --version
    cd "$BACKEND_DIR"
    find src package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json -type f -print0 \
      | sort -z | xargs -0 sha256sum
  } | sha256sum | cut -d' ' -f1
}

# Stamps live inside the directories they describe, so deleting a directory also invalidates its stamp.
stamp_matches() {
  [[ -f "$1" && "$(cat "$1")" == "$2" ]]
}

require_command npm
require_command pnpm
require_command curl
require_command sudo

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "Required command not found: ffmpeg (needed by ${OMI_WORKER_SERVICE}; install with: sudo apt install -y ffmpeg)" >&2
  exit 1
fi

cd "$ROOT_DIR"

echo "Installing Agentic Journal service units..."
install_unit_if_changed "$PROD_SERVICE"
install_unit_if_changed "$DEV_SERVICE"
install_unit_if_changed "$OMI_WORKER_SERVICE"
install_unit_if_changed "$BOOKMARKS_WORKER_SERVICE"
install_unit_if_changed "$MEDIA_WORKER_SERVICE"
systemctl_cmd daemon-reload
systemctl_cmd enable "$PROD_SERVICE" >/dev/null
systemctl_cmd enable "$OMI_WORKER_SERVICE" >/dev/null
systemctl_cmd enable "$BOOKMARKS_WORKER_SERVICE" >/dev/null
systemctl_cmd enable "$MEDIA_WORKER_SERVICE" >/dev/null
systemctl_cmd disable "$DEV_SERVICE" >/dev/null 2>&1 || true

echo "Stopping Agentic Journal services..."
systemctl_cmd stop "$DEV_SERVICE" || true
systemctl_cmd stop "$OMI_WORKER_SERVICE" || true
systemctl_cmd stop "$BOOKMARKS_WORKER_SERVICE" || true
systemctl_cmd stop "$MEDIA_WORKER_SERVICE" || true
systemctl_cmd stop "$PROD_SERVICE" || true

echo
ROOT_DEPS_HASH="$(inputs_hash package-lock.json)"
ROOT_DEPS_STAMP="${ROOT_DIR}/node_modules/.deploy-inputs-hash"
if stamp_matches "$ROOT_DEPS_STAMP" "$ROOT_DEPS_HASH"; then
  echo "Root dependencies unchanged; skipping npm ci."
else
  echo "Installing root dependencies..."
  npm ci
  echo "$ROOT_DEPS_HASH" > "$ROOT_DEPS_STAMP"
fi

echo
echo "Building Next.js (keeping .next/cache for incremental webpack builds)..."
# A cold build takes ~8 minutes on this host; a warm webpack cache cuts it to ~1.5.
# Clear the old build output but keep the cache, and drop the cache if it grows past ~4 GB.
if [[ -d "${ROOT_DIR}/.next/cache" ]] && (( $(du -sm "${ROOT_DIR}/.next/cache" | cut -f1) > 4096 )); then
  echo "Next cache exceeds 4 GB; clearing it."
  rm -rf "${ROOT_DIR}/.next/cache"
fi
if [[ -d "${ROOT_DIR}/.next" ]]; then
  find "${ROOT_DIR}/.next" -mindepth 1 -maxdepth 1 ! -name cache -exec rm -rf {} +
fi
# Combine a bounded heap with Next's compiler memory optimizations on the shared host.
if [[ "${EUID}" -ne 0 ]] && command -v systemd-run >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
  systemd-run --user --wait --pipe --collect \
    -p "WorkingDirectory=${ROOT_DIR}" -p OOMScoreAdjust=800 \
    -p MemoryHigh=6G -p MemoryMax=7G -p MemorySwapMax=2G \
    /usr/bin/env "NODE_OPTIONS=--max-old-space-size=${NEXT_BUILD_HEAP_MB:-5120}" npm run build
else
  NODE_OPTIONS="--max-old-space-size=${NEXT_BUILD_HEAP_MB:-5120}" npm run build
fi
test -s "${ROOT_DIR}/.next/BUILD_ID"

echo
echo "Installing backend dependencies with pnpm..."
pnpm --dir "$BACKEND_DIR" install --frozen-lockfile

echo
BACKEND_HASH="$(backend_inputs_hash)"
BACKEND_STAMP="${MASTRA_OUTPUT_DIR}/.deploy-inputs-hash"
if stamp_matches "$BACKEND_STAMP" "$BACKEND_HASH" && [[ -s "${MASTRA_OUTPUT_DIR}/package.json" && -d "${MASTRA_OUTPUT_DIR}/node_modules" ]]; then
  echo "Mastra backend unchanged; reusing the existing build."
else
  echo "Building Mastra from a clean output directory..."
  rm -rf "${BACKEND_DIR}/.mastra"
  pnpm --dir "$BACKEND_DIR" run build
  test -s "${MASTRA_OUTPUT_DIR}/package.json"

  echo
  echo "Installing Mastra generated production dependencies..."
  npm --prefix "$MASTRA_OUTPUT_DIR" install --omit=dev
  echo "$BACKEND_HASH" > "$BACKEND_STAMP"
fi

echo
echo "Starting Agentic Journal service..."
systemctl_cmd start "$PROD_SERVICE"
systemctl_cmd start "$OMI_WORKER_SERVICE"
systemctl_cmd start "$BOOKMARKS_WORKER_SERVICE"
systemctl_cmd start "$MEDIA_WORKER_SERVICE"

echo
echo "Verifying local endpoints..."
wait_for_http "Next root" "http://127.0.0.1:3000/"
wait_for_http "Bookmarks API" "http://127.0.0.1:3000/api/bookmarks/status"
wait_for_http "Media API" "http://127.0.0.1:3000/api/media"
wait_for_http "Jobs API" "http://127.0.0.1:3000/api/jobs/list"
wait_for_http "Mastra direct" "http://127.0.0.1:4111/"
wait_for_http "Mastra proxy" "http://127.0.0.1:3000/mastra"

echo
echo "Service status:"
systemctl --no-pager --full status "$PROD_SERVICE"
systemctl --no-pager --full status "$OMI_WORKER_SERVICE"

systemctl --no-pager --full status "$BOOKMARKS_WORKER_SERVICE"
