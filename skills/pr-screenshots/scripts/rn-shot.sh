#!/usr/bin/env bash
# One React Native screenshot in one call. Waits, LogBox and retries happen here, not in the model.
# Prints one line: "OK <file> <W>x<H>" or "FAIL <step>: <last output>".
#
# Usage: AD=<agent-device path> rn-shot.sh <out.png> <testID> [options]
#   --reload            metro reload first (after a branch switch or git apply)
#   --wait-text "<t>"   wait for API-loaded text before touching anything
#   --tap <testID>      scroll to + press, then settle (repeatable, in order)
#   --full              full-screen shot once <testID> is visible (no crop)
set -u
AD=${AD:?set AD to the agent-device path from device_open}
[ $# -ge 2 ] || { echo "FAIL args: rn-shot.sh <out.png> <testID> [--reload] [--wait-text t] [--tap id]... [--full]"; exit 2; }
out=$1 target=$2
shift 2
reload='' text='' full='' taps=()
while [ $# -gt 0 ]; do
  case $1 in
    --reload) reload=1 ;;
    --full) full=1 ;;
    --wait-text) text=$2; shift ;;
    --tap) taps+=("$2"); shift ;;
    *) echo "FAIL args: unknown $1"; exit 2 ;;
  esac
  shift
done

log=$(mktemp)
ad() { "$AD" "$@" >"$log" 2>&1; }
fail() { echo "FAIL $1: $(tail -c 300 "$log" | tr '\n' ' ')"; exit 1; }
# Run once; on failure settle and retry once (covers refetch re-renders and slow animations).
try() { local step=$1; shift; ad "$@" || { ad wait stable 1500 10000; ad "$@"; } || fail "$step"; }
# LogBox blocks taps. No overlay -> command fails, which is fine.
calm() { ad react-native dismiss-overlay; ad wait stable 1500 10000; }
# scroll --until only searches downward, so retry from the top.
reach() { ad scroll down --until "id=\"$1\"" || { ad scroll top; ad scroll down --until "id=\"$1\""; } || fail "reach $1"; }
height() { sips -g pixelHeight "$1" 2>/dev/null | awk '/pixelHeight/{print $2}' | grep . || echo 0; }

if [ -n "$reload" ]; then try reload metro reload; ad wait stable 2500 20000; fi
if [ -n "$text" ]; then try "wait-text" wait text "$text" 20000; ad wait stable 2500 15000; fi
calm

for id in ${taps[@]+"${taps[@]}"}; do
  reach "$id"
  try "tap $id" press "id=\"$id\"" --settle
  calm
done

reach "$target"
ad wait stable 1000 8000
if [ -n "$full" ]; then
  try shot screenshot "$out" --pixel-density 3
else
  try shot screenshot "$out" --pixel-density 3 --crop-on "id=\"$target\""
  [ "$(height "$out")" -gt 0 ] || fail "shot (no image written)"
  # scroll --until stops when the element is only partly on screen. Nudge, reshoot, keep the taller crop.
  alt="${out%.png}.nudge.png"
  if ad scroll down 0.3 && ad wait stable 800 5000 && ad screenshot "$alt" --pixel-density 3 --crop-on "id=\"$target\"" \
    && [ "$(height "$alt")" -gt "$(height "$out")" ]; then mv "$alt" "$out"; else rm -f "$alt"; fi
fi

echo "OK $out $(sips -g pixelWidth "$out" | awk '/pixelWidth/{print $2}')x$(height "$out")"
rm -f "$log"
