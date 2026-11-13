#!/usr/bin/env bash
# Put back the builds a deploy set aside (.next-previous, src/backend/.mastra-previous).
#
#   recover-build.sh           only when the current build is incomplete: an interrupted deploy
#                              (reboot, kill, timeout) left the good build set aside. Runs before
#                              every deploy and before agentic-journal.service starts.
#   recover-build.sh --force   always: the deploy script rolls back with this when it fails.
#
# Never touches anything while a deploy is running, unless that deploy is the caller
# (DEPLOY_LOCK_HELD=1).
set -euo pipefail

ROOT_DIR="${AGENTIC_JOURNAL_ROOT:-/home/openclaw/projects/agentic-journal}"
NEXT_DIR="${ROOT_DIR}/.next"
NEXT_PREVIOUS="${ROOT_DIR}/.next-previous"
MASTRA_DIR="${ROOT_DIR}/src/backend/.mastra"
MASTRA_PREVIOUS="${ROOT_DIR}/src/backend/.mastra-previous"

if [[ "${DEPLOY_LOCK_HELD:-}" != "1" ]]; then
  lock_dir="${XDG_RUNTIME_DIR:-}"
  [[ -d "$lock_dir" ]] || lock_dir="/run/user/$(id -u)"
  [[ -d "$lock_dir" ]] || lock_dir="/tmp"
  exec 8>"${AGENTIC_JOURNAL_DEPLOY_LOCK:-${lock_dir}/agentic-journal-deploy.lock}"
  if ! flock -n 8; then
    echo "A deploy is running; leaving its builds alone." >&2
    exit 0
  fi
fi

next_complete() { [[ -s "${NEXT_DIR}/BUILD_ID" ]]; }
mastra_complete() { [[ -s "${MASTRA_DIR}/output/package.json" ]]; }

if [[ "${1:-}" != "--force" ]] && next_complete && mastra_complete; then
  exit 0
fi

# Both go back together, so the Journal never runs one build's pages on another's backend.
if [[ -s "${NEXT_PREVIOUS}/BUILD_ID" ]]; then
  echo "Restoring the previous Next build." >&2
  mkdir -p "$NEXT_DIR"
  find "$NEXT_DIR" -mindepth 1 -maxdepth 1 ! -name cache -exec rm -rf {} +
  find "$NEXT_PREVIOUS" -mindepth 1 -maxdepth 1 -exec mv -t "$NEXT_DIR" {} +
  rmdir "$NEXT_PREVIOUS"
fi
if [[ -s "${MASTRA_PREVIOUS}/output/package.json" ]]; then
  echo "Restoring the previous Mastra build." >&2
  rm -rf "$MASTRA_DIR"
  mv "$MASTRA_PREVIOUS" "$MASTRA_DIR"
fi
