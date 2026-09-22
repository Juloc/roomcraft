#!/usr/bin/env bash
set -euo pipefail

API_URL="${ROOMCRAFT_E2E_API_URL:-http://127.0.0.1:5050}"
WEB_URL="${ROOMCRAFT_E2E_WEB_URL:-http://127.0.0.1:5173}"
API_LOG="${RUNNER_TEMP:-/tmp}/roomcraft-e2e-api.log"
WEB_LOG="${RUNNER_TEMP:-/tmp}/roomcraft-e2e-web.log"
ASSET_DIR="${RUNNER_TEMP:-/tmp}/roomcraft-e2e-assets"

cleanup() {
  if [[ -n "${WEB_PID:-}" ]]; then
    kill "$WEB_PID" 2>/dev/null || true
    wait "$WEB_PID" 2>/dev/null || true
  fi
  if [[ -n "${API_PID:-}" ]]; then
    kill "$API_PID" 2>/dev/null || true
    wait "$API_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

rm -rf "$ASSET_DIR"
mkdir -p "$ASSET_DIR"

Assets__StoragePath="$ASSET_DIR" dotnet run \
  --project src/server/RoomCraft.Host/RoomCraft.Host.csproj \
  --configuration Release \
  --no-build \
  --no-launch-profile \
  --urls "http://localhost:5050" >"$API_LOG" 2>&1 &
API_PID=$!

npm run dev -w @roomcraft/web -- --host 127.0.0.1 >"$WEB_LOG" 2>&1 &
WEB_PID=$!

wait_for_url() {
  local url="$1"
  local process_id="$2"
  local log_file="$3"
  local label="$4"

  for _ in $(seq 1 45); do
    if curl --fail --silent "$url" >/dev/null; then
      return
    fi
    if ! kill -0 "$process_id" 2>/dev/null; then
      printf '%s stopped before becoming ready.\n' "$label" >&2
      cat "$log_file"
      exit 1
    fi
    sleep 1
  done

  printf '%s did not become ready.\n' "$label" >&2
  cat "$log_file"
  exit 1
}

wait_for_url "$API_URL/api/health" "$API_PID" "$API_LOG" "RoomCraft API"
wait_for_url "$WEB_URL" "$WEB_PID" "$WEB_LOG" "RoomCraft web"

if ! npm run test:e2e; then
  printf '\n--- API log ---\n' >&2
  cat "$API_LOG" >&2 || true
  printf '\n--- Web log ---\n' >&2
  cat "$WEB_LOG" >&2 || true
  exit 1
fi
