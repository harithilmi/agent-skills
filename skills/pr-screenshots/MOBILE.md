# Mobile mode (React Native on a simulator)

Use this mode when the PR changes a React Native app. Skip steps 0–2. `headless.cjs shoot` is for web only. Step 3 and `publish` still apply.

## Who drives

- **Main chat never drives the sim.** Each tap re-sends its whole context (100k+), so one shot pair cost $1.30–1.70 that way. Invoke this skill instead: it forks on Sonnet with a small context.
- **Brief (skill args)**, one line per row:
  `<pr> | device <hostId>/<id> | bundle <id> | row <n> <name>: <screen>, testID <id>, state <what must show>, data <date/record>`
  Add the user's words ("retake row 2") and known traps.
- **Shoot each row in a fresh fork.** One row per invoke keeps the context small.

## Who sets the state

The fork can't wait for the user. So:

- **Easy state** (scroll to a card on a tab): the fork reaches it alone.
- **Data or account state** (pregnancy status, a note on a date, a profile field): never ask the user. Mutate it through the app's API (GraphQL/REST) with the app's own token, then reload. Find the token in the app's storage (`xcrun simctl get_app_container <device> <bundle> data`, then grep the MMKV/AsyncStorage files) and the endpoint in `.env`. Put it back after the shots if the user cares about it.
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
- **One sim, one Metro, no worktree.** Switch code with `git checkout <branch>` (or `main`) in the repo Metro serves. Then force a full reload: `curl -X POST localhost:8081/reload`, then wait 8 seconds. Fast Refresh can keep running the old bundle after a branch switch, and then the new `testID` is missing. A worktree would need its own `node_modules`, another Metro port and a re-pointed dev client. Not worth it.
  - Uncommitted user changes: `git stash` first, `git stash pop` after. Ask the main chat before you touch them.
- **Target by `testID`, not by guessing.** `--crop-on` takes only exact `id="..."` or `label="..."`. No prefix match. No snapshots, no rect math:
  ```bash
  $AD scroll top; $AD scroll down --until 'id="mood-card"'
  $AD screenshot <pr>-mood-before.png --pixel-density 3 --crop-on 'id="mood-card"'
  ```
- **No `testID` on that branch (often `main`):** add `testID="..."` to the root element as an uncommitted one-line patch. Wait 3 seconds, shoot, then `git restore <file>`. Do the same on the PR branch, or commit the `testID` there.
- **Reliable state, in this order:**
  1. Shoot every "after" on the branch first. Then switch to `main` once and patch all the temporary `testID`s in one go. Keep that patch until the last "before" is done.
  2. Run a full reload only after a branch switch. Fast Refresh picks up a `testID` patch by itself.
  3. After a reload, wait for text that comes from the API (`$AD wait text "<api text>" 20000`), then run `$AD wait stable 2500 15000`. If you tap during the refetch, the re-render can close a sheet you just opened.
  4. Tap once, then run `$AD wait stable 1500 10000` for the animation and the data.
  5. Verify with `$AD wait 'id="..."'` only on elements that have a `testID`. Bottom-sheet content may be missing from the accessibility tree, so a text grep that finds nothing proves nothing. Without a `testID`, check one 250px image.
  6. After 2 failed tries, return `NEEDS STATE` (see above).
- **Data:** the shot shows whatever the logged-in account has today. Before you shoot, check that it hits the state the PR changes, for example a value with no icon. If not, pick another date or record in the app.
- **Partly visible:** `scroll --until` stops as soon as part of the element shows, and `--crop-on` then crops only that part (for example 1110x170 instead of 1110x480). Run `$AD scroll down 0.3` and shoot again. Compare each size with the other shot.
- **Sizes:** the crop is tight on the element, with no padding. If before and after differ in height, pad the smaller one with `ffmpeg -vf pad=W:H:0:0:white`.
- **Check:** use one tile. `ffmpeg -i b.png -i a.png -filter_complex "[0]scale=500:-1[a];[1]scale=500:-1[b];[a][b]hstack" pair.png`. `Read` only `pair.png`.
- **LogBox** dev warnings sit at the screen bottom. Element crops avoid them. For full-screen shots, dismiss them first.
- **Upload:** name files `<pr>-<name>-before.png` and `<pr>-<name>-after.png`, then run `headless.cjs publish <pr> <dir>`. Mobile shots have no `jobs/<pr>.json` entry, so every shot comes back in `notSwapped` with its URL. Write the Before | After table in the PR body by hand with `gh pr edit --body-file`. `publish` adds "The red boxes show the changed parts." Delete that line, since mobile shots have no boxes.
