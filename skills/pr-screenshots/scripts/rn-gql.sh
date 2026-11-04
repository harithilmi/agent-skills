#!/usr/bin/env bash
# Run one GraphQL request as the user logged in on the booted iOS sim. Sets data state for a shot.
# The token comes from the app's MMKV store (last JWT written = newest). Output is capped so it can't flood context.
#
# Usage: rn-gql.sh <bundle id> <endpoint> <body.json | -> [extra curl args, e.g. -H 'x-app-platform: mobile']
#   body.json: {"query":"mutation … ","variables":{…}}   ("-" reads stdin)
# Env: GQL_TOKEN overrides the token. GQL_MAX output chars (default 1500).
set -eu
[ $# -ge 3 ] || { echo "usage: rn-gql.sh <bundle> <endpoint> <body.json|-> [curl args]"; exit 2; }
bundle=$1 endpoint=$2 body=$3
shift 3

if [ -z "${GQL_TOKEN:-}" ]; then
  dir=$(xcrun simctl get_app_container booted "$bundle" data) || { echo "FAIL no booted sim with $bundle"; exit 1; }
  GQL_TOKEN=$(find "$dir" \( -path '*mmkv*' -o -path '*RCTAsyncLocalStorage*' \) -type f ! -name '*.crc' -exec strings -n 20 {} + 2>/dev/null \
    | grep -oE 'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+' | tail -1) || true
  [ -n "$GQL_TOKEN" ] || { echo "FAIL no JWT in app storage (logged out?)"; exit 1; }
fi

curl -sS -X POST "$endpoint" -H 'content-type: application/json' -H "authorization: Bearer $GQL_TOKEN" "$@" --data-binary @"$body" \
  | python3 -c 'import sys,json
raw=sys.stdin.read()
try:
  d=json.loads(raw)
  for e in d.get("errors") or []: e.pop("extensions",None); e.pop("locations",None)  # stacktraces flood context
  raw=json.dumps(d,separators=(",",":"))
except ValueError: pass
print(raw[:int(sys.argv[1])])' "${GQL_MAX:-1500}"
