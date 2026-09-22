#!/usr/bin/env bash
set -euo pipefail

API_URL="${ROOMCRAFT_API_URL:-http://127.0.0.1:5050}"
ITEM_ID="catalog_ci_${GITHUB_RUN_ID:-local}_${GITHUB_RUN_ATTEMPT:-1}"
LOG_FILE="${RUNNER_TEMP:-/tmp}/roomcraft-catalog-api.log"
WORK_DIR="${RUNNER_TEMP:-/tmp}/roomcraft-catalog-smoke"

rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR"

cleanup() {
  if [[ -n "${API_PID:-}" ]]; then
    kill "$API_PID" 2>/dev/null || true
    wait "$API_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

dotnet run \
  --project src/server/RoomCraft.Host/RoomCraft.Host.csproj \
  --configuration Release \
  --no-build \
  --no-launch-profile \
  --urls "$API_URL" >"$LOG_FILE" 2>&1 &
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

CREATE_RESPONSE=$(cat <<JSON | curl --fail --silent --show-error \
  -X POST \
  -H "Content-Type: application/json" \
  --data-binary @- \
  "$API_URL/api/catalog/items"
{
  "id": "$ITEM_ID",
  "name": "CI Table",
  "category": "table",
  "manufacturer": "RoomCraft Labs",
  "sku": "CI-001",
  "productUrl": "https://example.com/ci-table",
  "version": {
    "assetId": "asset_model_v1",
    "thumbnailAssetId": "asset_thumb_v1",
    "widthMm": 1600,
    "depthMm": 900,
    "heightMm": 760,
    "metadata": {
      "source": "ci",
      "finish": "oak"
    }
  }
}
JSON
)

python3 - "$CREATE_RESPONSE" "$ITEM_ID" <<'PY'
import json, sys
payload = json.loads(sys.argv[1])
assert payload["id"] == sys.argv[2], payload
assert payload["currentVersion"] == 1, payload
assert payload["category"] == "table", payload
assert len(payload["versions"]) == 1, payload
version = payload["versions"][0]
assert version["version"] == 1, payload
assert version["assetId"] == "asset_model_v1", payload
assert version["thumbnailAssetId"] == "asset_thumb_v1", payload
assert version["metadata"]["finish"] == "oak", payload
PY

SEARCH_RESPONSE=$(curl --fail --silent --show-error \
  --get \
  --data-urlencode "query=CI Table" \
  --data-urlencode "category=table" \
  --data-urlencode "manufacturer=RoomCraft Labs" \
  "$API_URL/api/catalog/items")

python3 - "$SEARCH_RESPONSE" "$ITEM_ID" <<'PY'
import json, sys
payload = json.loads(sys.argv[1])
assert payload["total"] >= 1, payload
item = next(value for value in payload["items"] if value["id"] == sys.argv[2])
assert item["currentVersion"] == 1, item
assert item["version"]["widthMm"] == 1600, item
PY

VERSION_RESPONSE=$(cat <<JSON | curl --fail --silent --show-error \
  -X POST \
  -H "Content-Type: application/json" \
  --data-binary @- \
  "$API_URL/api/catalog/items/$ITEM_ID/versions"
{
  "assetId": "asset_model_v2",
  "thumbnailAssetId": "asset_thumb_v2",
  "widthMm": 1800,
  "depthMm": 900,
  "heightMm": 760,
  "metadata": {
    "source": "ci",
    "finish": "walnut"
  }
}
JSON
)

python3 - "$VERSION_RESPONSE" <<'PY'
import json, sys
payload = json.loads(sys.argv[1])
assert payload["version"] == 2, payload
assert payload["assetId"] == "asset_model_v2", payload
assert payload["widthMm"] == 1800, payload
PY

DETAIL_RESPONSE=$(curl --fail --silent --show-error \
  "$API_URL/api/catalog/items/$ITEM_ID")

python3 - "$DETAIL_RESPONSE" <<'PY'
import json, sys
payload = json.loads(sys.argv[1])
assert payload["currentVersion"] == 2, payload
assert [value["version"] for value in payload["versions"]] == [2, 1], payload
assert payload["versions"][0]["assetId"] == "asset_model_v2", payload
assert payload["versions"][1]["assetId"] == "asset_model_v1", payload
PY

UPDATE_RESPONSE=$(cat <<JSON | curl --fail --silent --show-error \
  -X PUT \
  -H "Content-Type: application/json" \
  --data-binary @- \
  "$API_URL/api/catalog/items/$ITEM_ID"
{
  "name": "CI Dining Table",
  "category": "dining",
  "manufacturer": "RoomCraft Labs",
  "sku": "CI-001",
  "productUrl": "https://example.com/ci-table-updated"
}
JSON
)

python3 - "$UPDATE_RESPONSE" <<'PY'
import json, sys
payload = json.loads(sys.argv[1])
assert payload["name"] == "CI Dining Table", payload
assert payload["category"] == "dining", payload
assert payload["currentVersion"] == 2, payload
assert payload["version"]["assetId"] == "asset_model_v2", payload
PY

INVALID_STATUS=$(cat <<JSON | curl --silent --show-error \
  -o "$WORK_DIR/invalid-response.json" \
  -w "%{http_code}" \
  -X POST \
  -H "Content-Type: application/json" \
  --data-binary @- \
  "$API_URL/api/catalog/items/$ITEM_ID/versions"
{
  "assetId": "asset_invalid",
  "thumbnailAssetId": null,
  "widthMm": 0,
  "depthMm": 900,
  "heightMm": 760,
  "metadata": {}
}
JSON
)

if [[ "$INVALID_STATUS" != "400" ]]; then
  cat "$WORK_DIR/invalid-response.json"
  printf 'Expected invalid catalog version to return 400, got %s\n' "$INVALID_STATUS" >&2
  exit 1
fi

printf 'Catalog smoke test passed.\n'
