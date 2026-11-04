# Mobile mode (React Native on a simulator)

Use this mode when the PR changes a React Native app. Skip steps 0–2. `headless.cjs shoot` is for web only. Step 3 and `publish` still apply.

## Who drives

- **Main chat never drives the sim.** Each tap re-sends its whole context (100k+), so one shot pair cost $1.30–1.70 that way. Invoke this skill instead: it forks on Sonnet with a small context.
- **Brief (skill args)**, one line per row:
  `<pr> | AD <agent-device path> | bundle <id> | main patch <file> | gql <endpoint> <-H headers> | row <n> <name>: <screen>, testID <id>, taps <id,id>, wait-text <api text>, state <what must show>, data <setup + restore>`
  Add the user's words ("retake row 2") and known traps.
  - Main chat fills in every testID and the tap path, so the fork never reads app source.
  - **Main patch:** commit testIDs on the branch in their own commit, then `git show <commit> > /tmp/pr-shots/<pr>/testids.patch`. The fork runs `git apply` on `main` and `git apply -R` after. Never `sed -i` a patch.
  - Pass the `AD` path from the main chat's `device_open`, so the fork skips that call (3.5k chars).
  - **`data`:** if the row needs data state, the main chat writes the exact GraphQL body (query + variables) and the restore body. The fork never reads schema or source to build them (that cost one fork 20+ calls).
- **Budget:** about 10 calls for a shot row, 15 for a video row. Past that, or after 2 failed takes, stop and return `NEEDS STATE: <what is missing>`. Never write your own take script.
- **Shoot each row in a fresh fork.** One row per invoke keeps the context small.

## Shoot with `scripts/rn-shot.sh` (one call per shot)

```bash
AD=<path> scripts/rn-shot.sh /tmp/pr-shots/<pr>/<pr>-<name>-after.png <testID> \
  [--reload] [--wait-text "<api text>"] [--tap <testID>]... [--full]
```

**Video:** add `--record` and an `.mp4` out. It reaches `<testID>`, starts recording, runs the steps, holds each state 1.2s, stops. Steps run in order: `--tap <id>`, `--hold <id>` (long-press), `--back`. Prints `OK <file> <secs>s`. Check it with `$AD record contact-sheet <file>` and `Read` that one PNG.

It does the reload, LogBox dismiss, waits, scroll-to (from the top if needed), taps, one retry per step, crop, and the partly-visible nudge. It prints one line: `OK <file> WxH` or `FAIL <step>: <reason>`. Use `--reload` only after a branch switch or `git apply`. On `FAIL`, read the reason and fix that one thing. Don't take the steps over by hand.

**Never call `device_screenshot`.** Each image stays in context for every later call. Check only `pair.png` (see Check below).

## Who sets the state

The fork can't wait for the user. So:

- **Easy state** (scroll to a card on a tab): the fork reaches it alone.
- **Data or account state** (pregnancy status, a note on a date, a profile field): never ask the user. Run the brief's `data` body with `scripts/rn-gql.sh <bundle> <endpoint> <body.json|-> [-H …]`. It takes the token from the app's storage and prints capped JSON. Then `$AD open <bundle> --relaunch --metro-port <port>` + `$AD wait text "<api text>" 30000`. `metro reload` is not enough after a data change: the screen keeps the old API result. Run the restore body after the last shot.
- **Hard state** (sheet open mid-gesture, a flow with no API, a login that needs a password or OTP): don't try. Return `NEEDS STATE: <branch>, open <exact steps>`. The main chat relays it. The user replies "done", and the main chat re-invokes with `state ready`. Then the fork only crops (about 2 calls).
- **Fork failed twice** on an easy state: return `NEEDS STATE` too. Never retry a third time.

- **Driver:** use the T3 Code device tools. Call `device_list`, then `device_open` with its `hostId` and `id`. Every tap, scroll and screenshot goes through the `agent-device` command it returns (`$AD` below). Never use `simctl` or `adb` for input.
  - **Maestro** (`~/.maestro/bin/maestro`) is the fallback, only when the device tools are missing. It is not headless: it drives the same visible sim. On one shot it was about 2× slower (20s against 11s) for the same tokens. Its errors are also buried in `~/.maestro/tests/<run>/commands-*.json`. Write a flow without `launchApp` and run `maestro test flow.yaml 2>&1 | tail -3`. Maestro adds `.png` to `path`.
    ```yaml
    appId: <bundle id>
    ---
    - scrollUntilVisible: { element: { id: mood-card } }
    - takeScreenshot: { path: /tmp/pr-shots/<pr>/<pr>-mood-before, cropOn: { id: mood-card } }
    ```
- **One sim, one Metro, no worktree.** Switch code with `git checkout <branch>` (or `main`) in the repo Metro serves. Then force a full reload with `$AD metro reload` (`rn-shot.sh --reload` does it). Never `curl …/reload`: it prints the whole Expo manifest (~10k chars) into context. Fast Refresh can keep running the old bundle after a branch switch, and then the new `testID` is missing. A worktree would need its own `node_modules`, another Metro port and a re-pointed dev client. Not worth it.
  - Uncommitted user changes: `git stash` first, `git stash pop` after. Ask the main chat before you touch them.
- **agent-device cheat-sheet** (don't run `help`): `press <sel> --settle` · `longpress <sel> 1500 --settle` · `back --in-app --settle` · `scroll down --until '<sel>'` · `scroll top` · `wait text "<t>" 20000` · `record start <f.mp4> --scope device` / `record stop` · `record contact-sheet <f.mp4> --out <png>`. Selectors: `id="…"`, `label="…"`. Coordinates only when the element has no `testID` and no label: then return `NEEDS TESTID <element>` instead of guessing pixels.
- **Target by `testID`, not by guessing.** `--crop-on` takes only exact `id="..."` or `label="..."`. No prefix match. No snapshots, no rect math:
  ```bash
  $AD scroll top; $AD scroll down --until 'id="mood-card"'
  $AD screenshot <pr>-mood-before.png --pixel-density 3 --crop-on 'id="mood-card"'
  ```
- **No `testID` on that branch (often `main`):** `git apply` the main patch from the brief, shoot, then `git apply -R`.
- **Reliable state, in this order:**
  1. Shoot every "after" on the branch first. Then switch to `main` once and patch all the temporary `testID`s in one go. Keep that patch until the last "before" is done.
  2. Run a full reload only after a branch switch. Fast Refresh picks up a `testID` patch by itself.
  3. Waits after reload, taps and animations are in `rn-shot.sh`. Always pass `--wait-text` with text from the API: tapping during a refetch can close a sheet you just opened. Bottom-sheet content may be missing from the accessibility tree, so verify by `testID` only.
  4. After 2 failed tries, return `NEEDS STATE` (see above).
- **Data:** the shot shows whatever the logged-in account has today. Before you shoot, check that it hits the state the PR changes, for example a value with no icon. If not, pick another date or record in the app.
- **Sizes:** the crop is tight on the element, with no padding. If before and after differ in height, pad the smaller one with `ffmpeg -vf pad=W:H:0:0:white`.
- **Check:** use one tile. `ffmpeg -i b.png -i a.png -filter_complex "[0]scale=500:-1[a];[1]scale=500:-1[b];[a][b]hstack" pair.png`. `Read` only `pair.png`.
- **Upload:** name files `<pr>-<name>-before.png` and `<pr>-<name>-after.png`, then run `headless.cjs publish <pr> <dir>`. Mobile shots have no `jobs/<pr>.json` entry, so every shot comes back in `notSwapped` with its URL. Write the Before | After table in the PR body by hand with `gh pr edit --body-file`. `publish` adds "The red boxes show the changed parts." Delete that line, since mobile shots have no boxes.
