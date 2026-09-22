#!/usr/bin/env bash
set -euo pipefail

API_URL="${ROOMCRAFT_API_URL:-http://127.0.0.1:5052}"
LOG_FILE="${RUNNER_TEMP:-/tmp}/roomcraft-model-assets-api.log"
WORK_DIR="${RUNNER_TEMP:-/tmp}/roomcraft-model-assets-smoke"
ASSET_DIR="$WORK_DIR/storage"
MODEL_FILE="$WORK_DIR/chair.glb"
DOWNLOADED_FILE="$WORK_DIR/downloaded.glb"
INVALID_FILE="$WORK_DIR/invalid.glb"

rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR"

cleanup() {
  if [[ -n "${API_PID:-}" ]]; then
    kill "$API_PID" 2>/dev/null || true
    wait "$API_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

python3 - "$MODEL_FILE" <<'PY'
import json
import struct
import sys

payload = {
    "asset": {"version": "2.0", "generator": "RoomCraft smoke test"},
    "scene": 0,
    "scenes": [{}],
}
json_bytes = json.dumps(payload, separators=(",", ":")).encode("utf-8")
json_bytes += b" " * ((4 - len(json_bytes) % 4) % 4)
length = 12 + 8 + len(json_bytes)

with open(sys.argv[1], "wb") as handle:
    handle.write(b"glTF")
    handle.write(struct.pack("<I", 2))
    handle.write(struct.pack("<I", length))
    handle.write(struct.pack("<I", len(json_bytes)))
    handle.write(struct.pack("<I", 0x4E4F534A))
    handle.write(json_bytes)
PY

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

UPLOAD_RESPONSE=$(curl --fail --silent --show-error   -X POST   -F "file=@$MODEL_FILE;type=model/gltf-binary"   "$API_URL/api/assets/models")

ASSET_ID=$(python3 - "$UPLOAD_RESPONSE" <<'PY'
import json, sys
payload = json.loads(sys.argv[1])
assert payload["kind"] == "model", payload
assert payload["contentType"] == "model/gltf-binary", payload
assert payload["sizeBytes"] > 20, payload
assert payload["id"].startswith("asset_glb_"), payload
assert len(payload["sha256"]) == 64, payload
assert payload["contentUrl"].endswith("/content"), payload
print(payload["id"])
PY
)

curl --fail --silent --show-error   "$API_URL/api/assets/$ASSET_ID/content"   -o "$DOWNLOADED_FILE"
cmp "$MODEL_FILE" "$DOWNLOADED_FILE"

SECOND_UPLOAD=$(curl --fail --silent --show-error   -X POST   -F "file=@$MODEL_FILE;type=application/octet-stream"   "$API_URL/api/assets/models")

python3 - "$SECOND_UPLOAD" "$ASSET_ID" <<'PY'
import json, sys
payload = json.loads(sys.argv[1])
assert payload["id"] == sys.argv[2], payload
PY

printf 'not a glb' > "$INVALID_FILE"
INVALID_STATUS=$(curl --silent --show-error   -o "$WORK_DIR/invalid-response.json"   -w "%{http_code}"   -X POST   -F "file=@$INVALID_FILE;type=model/gltf-binary"   "$API_URL/api/assets/models")

if [[ "$INVALID_STATUS" != "400" ]]; then
  cat "$WORK_DIR/invalid-response.json"
  printf 'Expected invalid GLB upload to return 400, got %s\n' "$INVALID_STATUS" >&2
  exit 1
fi

python3 - "$MODEL_FILE" "$WORK_DIR/wrong-length.glb" <<'PY'
import struct
import sys

data = bytearray(open(sys.argv[1], "rb").read())
data[8:12] = struct.pack("<I", len(data) + 4)
open(sys.argv[2], "wb").write(data)
PY

WRONG_LENGTH_STATUS=$(curl --silent --show-error   -o "$WORK_DIR/wrong-length-response.json"   -w "%{http_code}"   -X POST   -F "file=@$WORK_DIR/wrong-length.glb;type=model/gltf-binary"   "$API_URL/api/assets/models")

if [[ "$WRONG_LENGTH_STATUS" != "400" ]]; then
  cat "$WORK_DIR/wrong-length-response.json"
  printf 'Expected malformed GLB length to return 400, got %s\n' "$WRONG_LENGTH_STATUS" >&2
  exit 1
fi

printf 'GLB model asset smoke test passed.\n'
