#!/usr/bin/env bash
set -euo pipefail

API_URL="${ROOMCRAFT_API_URL:-http://127.0.0.1:5050}"
PROJECT_ID="ci_project_${GITHUB_RUN_ID:-local}_${GITHUB_RUN_ATTEMPT:-1}"
LOG_FILE="${RUNNER_TEMP:-/tmp}/roomcraft-api.log"

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

project_document() {
  local name="$1"
  cat <<JSON
{"document":{"schemaVersion":4,"id":"$PROJECT_ID","name":"$name","settings":{"unitSystem":"metric","gridSizeMm":100,"angleSnapDeg":15},"levels":[{"id":"level_ground","name":"Ground floor","elevationMm":0,"defaultWallHeightMm":2500,"floorThicknessMm":200,"vertices":[],"walls":[],"openings":[],"objects":[],"blueprints":[]}]}}
JSON
}

CREATE_RESPONSE=$(project_document "CI Project" | curl --fail --silent --show-error \
  -X POST \
  -H "Content-Type: application/json" \
  --data-binary @- \
  "$API_URL/api/projects")

python3 - "$CREATE_RESPONSE" <<'PY'
import json, sys
payload = json.loads(sys.argv[1])
assert payload["revision"] == 1, payload
assert payload["document"]["name"] == "CI Project", payload
PY

GET_RESPONSE=$(curl --fail --silent --show-error "$API_URL/api/projects/$PROJECT_ID")
python3 - "$GET_RESPONSE" <<'PY'
import json, sys
payload = json.loads(sys.argv[1])
assert payload["revision"] == 1, payload
assert payload["document"]["schemaVersion"] == 4, payload
PY

UPDATE_RESPONSE=$(project_document "CI Project Updated" | curl --fail --silent --show-error \
  -X PUT \
  -H "Content-Type: application/json" \
  -H "If-Match: 1" \
  --data-binary @- \
  "$API_URL/api/projects/$PROJECT_ID")

python3 - "$UPDATE_RESPONSE" <<'PY'
import json, sys
payload = json.loads(sys.argv[1])
assert payload["revision"] == 2, payload
assert payload["document"]["name"] == "CI Project Updated", payload
PY

STALE_STATUS=$(project_document "Stale Update" | curl --silent --show-error \
  -o "${RUNNER_TEMP:-/tmp}/roomcraft-stale-response.json" \
  -w "%{http_code}" \
  -X PUT \
  -H "Content-Type: application/json" \
  -H "If-Match: 1" \
  --data-binary @- \
  "$API_URL/api/projects/$PROJECT_ID")

if [[ "$STALE_STATUS" != "409" ]]; then
  cat "${RUNNER_TEMP:-/tmp}/roomcraft-stale-response.json"
  printf 'Expected stale save to return 409, got %s\n' "$STALE_STATUS" >&2
  exit 1
fi

RACE_PROJECT_ID="${PROJECT_ID}_race"
RACE_BODY=$(cat <<JSON
{"document":{"schemaVersion":4,"id":"$RACE_PROJECT_ID","name":"Race Project","settings":{"unitSystem":"metric","gridSizeMm":100,"angleSnapDeg":15},"levels":[{"id":"level_ground","name":"Ground floor","elevationMm":0,"defaultWallHeightMm":2500,"floorThicknessMm":200,"vertices":[],"walls":[],"openings":[],"objects":[],"blueprints":[]}]}}
JSON
)

RACE_STATUS_ONE_FILE="${RUNNER_TEMP:-/tmp}/roomcraft-race-status-one.txt"
RACE_STATUS_TWO_FILE="${RUNNER_TEMP:-/tmp}/roomcraft-race-status-two.txt"
RACE_RESPONSE_ONE="${RUNNER_TEMP:-/tmp}/roomcraft-race-response-one.json"
RACE_RESPONSE_TWO="${RUNNER_TEMP:-/tmp}/roomcraft-race-response-two.json"

(
  printf '%s' "$RACE_BODY" | curl --silent --show-error \
    -o "$RACE_RESPONSE_ONE" \
    -w "%{http_code}" \
    -X POST \
    -H "Content-Type: application/json" \
    --data-binary @- \
    "$API_URL/api/projects" >"$RACE_STATUS_ONE_FILE"
) &
RACE_PID_ONE=$!

(
  printf '%s' "$RACE_BODY" | curl --silent --show-error \
    -o "$RACE_RESPONSE_TWO" \
    -w "%{http_code}" \
    -X POST \
    -H "Content-Type: application/json" \
    --data-binary @- \
    "$API_URL/api/projects" >"$RACE_STATUS_TWO_FILE"
) &
RACE_PID_TWO=$!

wait "$RACE_PID_ONE"
wait "$RACE_PID_TWO"

RACE_STATUS_ONE=$(cat "$RACE_STATUS_ONE_FILE")
RACE_STATUS_TWO=$(cat "$RACE_STATUS_TWO_FILE")

if ! {
  [[ "$RACE_STATUS_ONE" == "201" && "$RACE_STATUS_TWO" == "409" ]] ||
  [[ "$RACE_STATUS_ONE" == "409" && "$RACE_STATUS_TWO" == "201" ]]
}; then
  printf 'Expected concurrent create statuses 201/409, got %s/%s\n' \
    "$RACE_STATUS_ONE" "$RACE_STATUS_TWO" >&2
  cat "$RACE_RESPONSE_ONE" >&2 || true
  cat "$RACE_RESPONSE_TWO" >&2 || true
  exit 1
fi

LEGACY_PROJECT_ID="${PROJECT_ID}_legacy"
LEGACY_RESPONSE=$(cat <<JSON | curl --fail --silent --show-error \
  -X POST \
  -H "Content-Type: application/json" \
  --data-binary @- \
  "$API_URL/api/projects"
{"document":{"schemaVersion":1,"id":"$LEGACY_PROJECT_ID","name":"Legacy V1","settings":{"unitSystem":"metric","gridSizeMm":100,"angleSnapDeg":15},"levels":[{"id":"level_ground","name":"Ground floor","elevationMm":0,"defaultWallHeightMm":2500,"vertices":[],"walls":[],"openings":[],"objects":[]}]}}
JSON
)

python3 - "$LEGACY_RESPONSE" <<'PY'
import json, sys
payload = json.loads(sys.argv[1])
assert payload["revision"] == 1, payload
assert payload["document"]["schemaVersion"] == 1, payload
PY

printf 'Project persistence smoke test passed.\n'
