# Mobile mode (React Native on a simulator)

Use this mode when the PR changes a React Native app. `WEB.md` and `headless.cjs shoot` are for web only. Step 3 and step 4 (`publish`) of `SKILL.md` still apply.

## Contents

- Setup: what a mobile-only user needs
- Who drives: main chat or fork, and the brief format
- Shoot with `scripts/rn-shot.sh`: PNG, long shot, video
- Who sets the state: data, dev hooks, hard state
- Driving rules: device tools, reloads, testIDs, languages
- Check and upload: sizes, the one check image, the PR body

## Setup

- T3 Code with its device tools (`device_list`, `device_open`), and a booted iOS Simulator or Android Emulator with a dev build of the app.
- `gh`, logged in. Node. `ffmpeg`. `uv` (long shots only).
- Upload: a Chromium browser (Chrome, Brave, Edge, Arc, Helium or Chromium) logged in to GitHub. Run `npx -y playwright-core --version` once. The terminal needs Full Disk Access, so the script can copy the browser's cookies. Pick the browser with `PR_SHOTS_BROWSER` if more than one is installed.
- `scripts/rn-gql.sh` (data state) is for the iOS Simulator only.

## Who drives

- **Main chat never drives the sim.** Each tap re-sends the main chat's whole context. Invoke this skill instead: it forks with a small context. Retakes and "just one quick shot" too. `device_list` and `device_open` stay in the main chat, to get the `AD` path.
- **Brief (skill args)**, one line per row:
  `<pr> | AD <agent-device path> | bundle <id> | main patch <file> | gql <endpoint> <-H headers> | row <n> <name>: <screen>, testID <id>, taps <id,id>, wait-text <api text>, state <what must show>, data <setup + restore>, dev <url,url>`
  Add the user's words ("retake row 2") and known traps.
  - Main chat fills in every testID and the tap path, so the fork never reads app source.
  - **Main patch:** commit testIDs on the branch in their own commit, then `git show <commit> > /tmp/pr-shots/<pr>/testids.patch`. The fork runs `git apply` on `main` and `git apply -R` after. Never `sed -i` a patch.
  - **Check it applies to `main` before the brief:** `T=$(mktemp); GIT_INDEX_FILE=$T git read-tree main && GIT_INDEX_FILE=$T git apply --cached --check <patch>; rm -f $T`. It checks against `main` in a temp index: no checkout, no stash, so the working tree stays untouched. For `-3`, use a throwaway `git worktree add` instead. A PR that rewrites the same file makes the branch patch miss on `main`. If it fails, try a 3-way apply in a throwaway worktree. If that fails too, write a `main`-only patch by hand and pass both.
  - Pass the `AD` path from the main chat's `device_open`, so the fork skips that call.
  - **`data`:** if the row needs data state, the main chat writes the exact GraphQL body (query + variables) and the restore body. The fork never reads schema or source to build them.
  - **`dev`:** app-only state from an uncommitted dev hook (see "Who sets the state"). The main chat writes and applies the hook first, then lists the URLs in shot order plus `uncommitted dev hook: <files>`.
- **Budget:** about 10 calls for a shot row (15 for a 4-shot flow row or a video row). Past that, or after 2 failed takes, stop and return `NEEDS STATE: <what is missing>`. Never write your own take script.
- **Shoot each row in a fresh fork.** One row per invoke keeps the context small.
- **Plan the matrix first.** Before the first invoke, the main chat lists every shot: account states × languages × before/after. Order the rows so each switch happens once (all of state A in language 1, then state A in language 2, then state B…), and put each row's state in its brief. Account or language changes the user must make go in one ask, not one per row.
- **Static by default.** Shoot PNGs, even for a navigation flow: shoot the key states in order (e.g. `[form, button] → [where it lands]`) and put them side by side in the row. Video only when the brief says `video`: a video row takes several times the calls of a static row.

## Shoot with `scripts/rn-shot.sh` (one call per shot)

```bash
AD=<path> <skill>/scripts/rn-shot.sh /tmp/pr-shots/<pr>/<pr>-<name>-after.png <testID> \
  [--reload] [--wait-text "<api text>"] [--tap <testID>]... [--full]
```

**Long shot (whole screen, top to bottom):** `rn-shot.sh <out.png> - --long`. It scrolls to the top, pans and shoots until two frames match, and stitches on quiet rows, so a seam never cuts a button. One call, about 1 min. Set `PAN_Y` if the pan start lands on a horizontal carousel (the page won't move). Use `width="280"` in the PR.

**Video (only when the brief says `video`):** add `--record` and an `.mp4` out. It reaches `<testID>`, starts recording, runs the steps, stops, then cuts every frozen stretch to 0.8s (`HOLD=1.2` for slower) and scales to 590px. A 60s take becomes about 11s and under 1MB, ready to upload. The raw clip stays at `<out>.raw.mp4`. Steps run in order: `--tap <id>`, `--hold <id>` (long-press), `--back`. Prints `OK <file> <secs>s`. A video call takes 1–3 min (recording export): run it in the foreground with Bash `timeout: 600000`. Never background it and poll. Check it with `$AD record contact-sheet <file>` and `Read` that one PNG.

It does the reload, LogBox dismiss, waits, scroll-to (from the top if needed), taps, one retry per step, crop, and the partly-visible nudge. It prints one line: `OK <file> WxH` or `FAIL <step>: <reason>`. Use `--reload` only after a branch switch or `git apply`. On `FAIL`, read the reason and fix that one thing. Don't take the steps over by hand.

**Never call `device_screenshot`.** Each image stays in context for every later call. Check only `pair.png` (see Check below).

## Who sets the state

The fork can't wait for the user. So:

- **Easy state** (scroll to a card on a tab): the fork reaches it alone.
- **Data or account state** (a subscription status, a record on a date, a profile field): never ask the user. Run the brief's `data` body with `scripts/rn-gql.sh <bundle> <endpoint> <body.json|-> [-H …]`. It takes the token from the app's storage and prints capped JSON. Then `$AD open <bundle> --relaunch --metro-port <port>` + `$AD wait text "<api text>" 30000`. `metro reload` is not enough after a data change: the screen keeps the old API result. Run the restore body after the last shot.
- **App-only state** (a store value, a feature flag, mock data, a screen not reachable yet, the language): the **main chat** adds a throwaway dev hook before invoking. It stays uncommitted, and the brief lists its URLs. The fork just opens them: `$AD open <bundle> <scheme>://dev/<verb>/<arg>`. Cheaper than tapping through settings, and it works where no path exists yet.
  - **Pattern:** one `__DEV__`-only `Linking.addEventListener('url', …)` that matches `dev/<verb>/<arg>` and sets state directly (`useXStore.getState().setY(arg)`, `i18n.changeLanguage(arg)`). For a screen nothing links to yet, add a `__DEV__`-only path to the React Navigation linking config (`dev/nav/<Route>`).
  - **Catch-all trap:** if the linking config has a `'*'` route, the dev URL also navigates there. Add `filter: (url) => !(__DEV__ && url.includes('dev/'))` to `linking`, unless the hook *is* a nav path.
    ```ts
    // app/devtools/devLinks.ts (uncommitted). Call listenDevLinks() in the app's __DEV__ block.
    export const listenDevLinks = () =>
      Linking.addEventListener('url', ({ url }) => {
        const [verb, arg] = url.split('dev/')[1]?.split('/') ?? [];
        if (verb === 'lang') i18n.changeLanguage(arg);
        if (verb === 'premium') useUserStore.getState().setPremium(arg === '1');
      });
    ```
  - **Never commit it.** Stage by path, never `git add -A`. A hunk in a shared file (`app.tsx`, the navigator) goes through `git add -p`. The brief says `uncommitted dev hook: <files>`, so the fork never stashes it away. Keep reusable hooks as a patch in `<skill>/patches/<repo>-<name>.patch` (gitignored: it holds app code, so it stays local), write its URLs in the project notes, and `git apply` it on whatever branch you shoot. Don't open a PR for it: it is sim tooling, not app code.
  - **Not for API data:** data the backend owns goes through `rn-gql.sh` (above). A hook faking it shows a state the real app can't reach.
  - **Fork side:** a state that needs a hook and the brief has none → `NEEDS STATE: dev hook <what it must set>`. Never tap through 5 settings screens instead.
- **Hard state** (sheet open mid-gesture, a flow with no API, a login that needs a password or OTP): don't try. Return `NEEDS STATE: <branch>, open <exact steps>`. The main chat relays it. The user replies "done", and the main chat re-invokes with `state ready`. Then the fork only crops (about 2 calls).
- **Fork failed twice** on an easy state: return `NEEDS STATE` too. Never retry a third time.

## Driving rules

- **Driver:** use the T3 Code device tools. Call `device_list`, then `device_open` with its `hostId` and `id`. Every tap, scroll and screenshot goes through the `agent-device` command it returns (`$AD` below). Never use `simctl` or `adb` for input.
  - **Maestro** (`~/.maestro/bin/maestro`) is the fallback, only when the device tools are missing. It is not headless: it drives the same visible sim, and it is slower. Its errors are also buried in `~/.maestro/tests/<run>/commands-*.json`. Write a flow without `launchApp` and run `maestro test flow.yaml 2>&1 | tail -3`. Maestro adds `.png` to `path`.
    ```yaml
    appId: <bundle id>
    ---
    - scrollUntilVisible: { element: { id: mood-card } }
    - takeScreenshot:
        { path: /tmp/pr-shots/<pr>/<pr>-mood-before, cropOn: { id: mood-card } }
    ```
- **One sim, one Metro, no worktree.** Switch code with `git checkout <branch>` (or `main`) in the repo Metro serves. Then force a full reload with `$AD metro reload` (`rn-shot.sh --reload` does it). Never `curl …/reload`: it prints the whole Expo manifest (~10k chars) into context. Fast Refresh can keep running the old bundle after a branch switch, and then the new `testID` is missing. A worktree would need its own `node_modules`, another Metro port and a re-pointed dev client. Not worth it.
  - Uncommitted user changes ride along through `git checkout`. Leave them alone. Stash only if `checkout` refuses, and `git stash pop` right after the shots.
- **agent-device cheat-sheet** (don't run `help`): `press <sel> --settle` · `longpress <sel> 1500 --settle` · `back --in-app --settle` · `scroll down --until '<sel>'` · `scroll top` · `wait text "<t>" 20000` · `record start <f.mp4> --scope device` / `record stop` · `record contact-sheet <f.mp4> --out <png>`. Selectors: `id="…"`, `label="…"`. Coordinates only when the element has no `testID` and no label: then return `NEEDS TESTID <element>` instead of guessing pixels.
- **Target by `testID`, not by guessing.** `--crop-on` takes only exact `id="..."` or `label="..."`. No prefix match. No snapshots, no rect math:
  ```bash
  $AD scroll top; $AD scroll down --until 'id="mood-card"'
  $AD screenshot <pr>-mood-before.png --pixel-density 3 --crop-on 'id="mood-card"'
  ```
- **No `testID` on that branch (often `main`):** `git apply` the main patch from the brief, shoot, then `git apply -R`.
- **Reliable state, in this order:**
  1. Shoot every "after" on the branch first. Then switch to `main` once and patch all the temporary `testID`s in one go. Keep that patch until the last "before" is done.
  2. Reload (`--reload`) after every branch switch and every `git apply`/`-R`. Fast Refresh may miss either.
  3. Waits after reload, taps and animations are in `rn-shot.sh`. Always pass `--wait-text` with text from the API: tapping during a refetch can close a sheet you just opened. Bottom-sheet content may be missing from the accessibility tree, so verify by `testID` only.
  4. After 2 failed tries, return `NEEDS STATE` (see above).
- **Per-locale shots: use a dev language link, not the Language screen** (an app-only state hook, see "Who sets the state"). Check the project notes for one before navigating through settings. If the notes name a patch, `git apply` it, reload, and `git apply -R` it when done if the branch didn't have it.
  ```bash
  $AD open <bundle> <scheme>://dev/lang/<code>
  ```
  - It switches language in place: no navigation, and an open dialog stays open. So shoot one screen, switch, shoot again.
  - Use a URL scheme that is in the iOS Info.plist. Any other scheme fails with "Simulator device failed to open".
  - Restore the first language after the last shot.
- **Data:** the shot shows whatever the logged-in account has today. Before you shoot, check that it hits the state the PR changes, for example a value with no icon. If not, pick another date or record in the app.
## Check and upload

- **Sizes:** the crop is tight on the element, with no padding. If before and after differ in height, pad the smaller one with `ffmpeg -vf pad=W:H:0:0:white`.
- **Check:** use one tile. `ffmpeg -i b.png -i a.png -filter_complex "[0]scale=500:-1[a];[1]scale=500:-1[b];[a][b]hstack" pair.png`. `Read` only `pair.png`.
- **Upload:** name files `<pr>-<name>-before.png` and `<pr>-<name>-after.png`, then run `headless.cjs publish <pr> <dir>`. Mobile shots have no `jobs/<pr>.json` entry, so every shot comes back in `notSwapped` with its URL. Write the PR body by hand with `gh pr edit --body-file`. Layout: one `### <n>. <screen>` section per row, a line saying what to do, then a 2-column table: a text row (`| <before behaviour> | <after behaviour> |`) and an image row (`<img width="360">`, 280 for full screens). No wide 5-column table: it squeezes the images. Videos: a bare `https://github.com/user-attachments/assets/...` URL on its own line under `**Before:** …` and `**After:** …`. GitHub embeds that as a player; a `<video>` tag inside a table cell does not render inline. `publish` adds "The red boxes show the changed parts." Delete that line, since mobile shots have no boxes.
- **PR body edits:** `gh pr view <pr> --json body -q .body > /tmp/pr-shots/<pr>/body.backup.md` first. Before `gh pr edit --body-file`, check the new file is non-empty and still has the headings of the old body. Never write `#<number>` in prose: GitHub links it to that issue or PR. Run `gh` from the repo dir (it fails in `/tmp`).
- **Traps:** a vertical swipe that starts on a `react-native-reanimated-carousel` doesn't scroll the page (start pans below it). Python image work: `uv run -q --with pillow --with numpy python …` (no system PIL). `rm` with variables: `rm "${DIR:?}/${NAME:?}.png"` or the safety check refuses it.
