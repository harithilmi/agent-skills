#!/usr/bin/env bash
# One React Native screenshot or video in one call. Waits, LogBox and retries happen here, not in the model.
# Prints one line: "OK <file> <size>" or "FAIL <step>: <last output>".
#
# Usage: AD=<agent-device path> rn-shot.sh <out.png|out.mp4> <testID> [options]
#   --reload            metro reload first (after a branch switch or git apply)
#   --wait-text "<t>"   wait for API-loaded text before touching anything
#   --tap <testID>      scroll to + press, then settle (repeatable; steps run in order)
#   --hold <testID>     scroll to + long-press 1.5s, then settle (step)
#   --back              in-app back, then settle (step)
#   --full              full-screen shot once <testID> is visible (no crop)
#   --record            video: reach <testID>, start recording, run the steps, stop. <out> must be .mp4
set -u
AD=${AD:?set AD to the agent-device path from device_open}
[ $# -ge 2 ] || { echo "FAIL args: rn-shot.sh <out.png> <testID> [--reload] [--wait-text t] [--tap|--hold id]... [--back] [--full] [--record]"; exit 2; }
out=$1 target=$2
shift 2
reload='' text='' full='' record='' rec_on='' steps=()
while [ $# -gt 0 ]; do
  case $1 in
    --reload) reload=1 ;;
    --full) full=1 ;;
    --wait-text) text=$2; shift ;;
    --record) record=1 ;;
    --tap) steps+=("tap $2"); shift ;;
    --hold) steps+=("hold $2"); shift ;;
    --back) steps+=("back -") ;;
    *) echo "FAIL args: unknown $1"; exit 2 ;;
  esac
  shift
done

log=$(mktemp)
ad() { "$AD" "$@" >"$log" 2>&1; }
fail() { [ -n "$rec_on" ] && "$AD" record stop >/dev/null 2>&1; echo "FAIL $1: $(tail -c 300 "$log" | tr '\n' ' ')"; exit 1; }
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

run_steps() {
  local kind id
  for step in ${steps[@]+"${steps[@]}"}; do
    kind=${step%% *} id=${step#* }
    case $kind in
      tap) reach "$id"; try "tap $id" press "id=\"$id\"" --settle ;;
      hold) reach "$id"; try "hold $id" longpress "id=\"$id\"" 1500 --settle ;;
      back) try back back --in-app --settle ;;
    esac
    calm
    [ -n "$rec_on" ] && sleep 1.2 # let viewers see each state
  done
}

if [ -n "$record" ]; then
  reach "$target"; ad wait stable 1000 8000
  try "record start" record start "$out" --scope device; rec_on=1
  sleep 1
  run_steps
  sleep 1.5
  rec_on=''; try "record stop" record stop
  [ -s "$out" ] || fail "record (no video written)"
  echo "OK $out $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$out" 2>/dev/null | cut -d. -f1)s"
  rm -f "$log"; exit 0
fi

run_steps
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
