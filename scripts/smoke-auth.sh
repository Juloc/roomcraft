#!/usr/bin/env bash

roomcraft_authenticate() {
  local api_url="$1"
  local cookie_jar="$2"
  local username="ci-admin"
  local password="roomcraft-ci-password"
  local credentials

  rm -f "$cookie_jar"
  printf -v credentials '{"username":"%s","password":"%s"}' "$username" "$password"

  local session
  session="$(command curl --fail --silent --show-error "$api_url/api/auth/session")"
  local setup_required
  setup_required="$(python3 - "$session" <<'PY'
import json, sys
print("true" if json.loads(sys.argv[1])["setupRequired"] else "false")
PY
)"

  if [[ "$setup_required" == "true" ]]; then
    command curl       --fail       --silent       --show-error       --cookie-jar "$cookie_jar"       -X POST       -H "Content-Type: application/json"       --data-binary "$credentials"       "$api_url/api/auth/setup" >/dev/null
  else
    command curl       --fail       --silent       --show-error       --cookie-jar "$cookie_jar"       -X POST       -H "Content-Type: application/json"       --data-binary "$credentials"       "$api_url/api/auth/login" >/dev/null
  fi

  local authenticated
  authenticated="$(command curl --fail --silent --show-error --cookie "$cookie_jar" "$api_url/api/auth/session")"
  python3 - "$authenticated" <<'PY'
import json, sys
payload = json.loads(sys.argv[1])
assert payload["authenticated"] is True, payload
assert payload["user"]["username"] == "ci-admin", payload
PY
}
