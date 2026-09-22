#!/usr/bin/env bash
set -euo pipefail

API_URL="${ROOMCRAFT_API_URL:-http://127.0.0.1:5050}"
LOG_FILE="${RUNNER_TEMP:-/tmp}/roomcraft-assets-api.log"
WORK_DIR="${RUNNER_TEMP:-/tmp}/roomcraft-assets-smoke"
ASSET_DIR="$WORK_DIR/storage"
IMAGE_FILE="$WORK_DIR/blueprint.png"
DOWNLOADED_FILE="$WORK_DIR/downloaded.png"

rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR"

cleanup() {
  if [[ -n "${API_PID:-}" ]]; then
    kill "$API_PID" 2>/dev/null || true
    wait "$API_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# 1x1 transparent PNG. The server validates the actual signature, not only the extension/MIME header.
printf '%s' 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='   | base64 --decode > "$IMAGE_FILE"

Assets__StoragePath="$ASSET_DIR" dotnet run   --project src/server/RoomCraft.Host/RoomCraft.Host.csproj   --configuration Release   --no-build   --no-launch-profile   --urls "$API_URL" >"$LOG_FILE" 2>&1 &
API_PID=$!

for _ in $(seq 1 30); do
  if curl --fail --silent "$API_URL/api/health" >/dev/null; then
    break
  fi
  if ! kill -0 "$API_PID" 2>/dev/null; then
    cat "$LOG_FILE"
    exit 1
  fi
  sleep 1
done

if ! curl --fail --silent "$API_URL/api/health" >/dev/null; then
  cat "$LOG_FILE"
  exit 1
fi

COOKIE_JAR="${RUNNER_TEMP:-/tmp}/roomcraft-auth-${BASHPID}.txt"
# shellcheck source=scripts/smoke-auth.sh
source scripts/smoke-auth.sh
roomcraft_authenticate "$API_URL" "$COOKIE_JAR"
curl() {
  command curl --cookie "$COOKIE_JAR" "$@"
}

UPLOAD_RESPONSE=$(curl --fail --silent --show-error   -X POST   -F "file=@$IMAGE_FILE;type=image/png"   "$API_URL/api/assets/blueprints")

ASSET_ID=$(python3 - "$UPLOAD_RESPONSE" <<'PY'
import json, sys
payload = json.loads(sys.argv[1])
assert payload["kind"] == "blueprint", payload
assert payload["contentType"] == "image/png", payload
assert payload["sizeBytes"] > 0, payload
assert payload["id"].startswith("asset_bp_"), payload
assert payload["contentUrl"].endswith("/content"), payload
print(payload["id"])
PY
)

METADATA_RESPONSE=$(curl --fail --silent --show-error "$API_URL/api/assets/$ASSET_ID")
python3 - "$METADATA_RESPONSE" "$ASSET_ID" <<'PY'
import json, sys
payload = json.loads(sys.argv[1])
assert payload["id"] == sys.argv[2], payload
assert len(payload["sha256"]) == 64, payload
PY

curl --fail --silent --show-error   "$API_URL/api/assets/$ASSET_ID/content"   -o "$DOWNLOADED_FILE"
cmp "$IMAGE_FILE" "$DOWNLOADED_FILE"

SECOND_UPLOAD=$(curl --fail --silent --show-error   -X POST   -F "file=@$IMAGE_FILE;type=image/png"   "$API_URL/api/assets/blueprints")

python3 - "$SECOND_UPLOAD" "$ASSET_ID" <<'PY'
import json, sys
payload = json.loads(sys.argv[1])
assert payload["id"] == sys.argv[2], payload
PY

INVALID_FILE="$WORK_DIR/not-an-image.png"
printf 'this is not a png' > "$INVALID_FILE"
INVALID_STATUS=$(curl --silent --show-error   -o "$WORK_DIR/invalid-response.json"   -w "%{http_code}"   -X POST   -F "file=@$INVALID_FILE;type=image/png"   "$API_URL/api/assets/blueprints")

if [[ "$INVALID_STATUS" != "400" ]]; then
  cat "$WORK_DIR/invalid-response.json"
  printf 'Expected invalid image upload to return 400, got %s\n' "$INVALID_STATUS" >&2
  exit 1
fi

printf 'Blueprint asset smoke test passed.\n'
