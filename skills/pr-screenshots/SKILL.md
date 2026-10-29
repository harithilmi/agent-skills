---
name: pr-screenshots
description: >-
  Use when the user asks for PR screenshots ("add ss", "before/after"), or right after creating a UI PR of a web app: suggest adding them. Pass the PR numbers and the user's words (e.g. "retake") in args, plus dev server ports, test data or mocks if known.
compatibility: >-
  Requires macOS, a Chromium browser (Chrome, Helium, Brave, Edge, Arc or Chromium) logged in to GitHub, the gh CLI, Node, and sharp + playwright-core (repo node_modules or npx cache). The terminal needs Full Disk Access.
metadata:
  author: harithilmi
context: fork
agent: general-purpose
---

# PR screenshots

## Setup (once)

- macOS with a Chromium browser: Chrome, Helium, Brave, Edge, Arc or Chromium. Be logged in to GitHub and the dev site in it.
- `gh` CLI logged in. `sharp` and `playwright-core` in the repo's `node_modules`, or run `npx -y playwright-core --version` once.
- The first run asks for Keychain access ("<Browser> Safe Storage"). Click **Always Allow**, so the copied cookies can be read.
- Optional env vars: `PR_SHOTS_BROWSER` (`chrome`, `helium`, `brave`, `edge`, `arc`, `chromium`; default is the first one installed), `PR_SHOTS_PROFILE` (default: the profile you used last, e.g. `"Profile 1"`), `PR_SHOTS_REPO` (default: the git repo you run it from).

## Project notes

Each repo can have `<repo>/.claude/pr-screenshots.local.md`: what this skill learned about that repo (ports, login cookies, test data, traps). It is local to each person and never committed.

- **Start:** read it if it exists. Follow it over the defaults below.
- **Not ignored yet:** add `.claude/pr-screenshots.local.md` to `<repo>/.git/info/exclude` (local ignore, no commit).
- **After a fix that worked** (not a guess), append one line: the trap and the fix. Example: `- admin app: open http://admin.localhost:4333, needs the cookie below`.
- Keep it under 30 lines: merge or drop old lines. No tokens, passwords or other secrets.

## Input and output

This skill runs in a forked subagent, so it does not see the main chat. Everything it knows comes from the args below and from the repo, `gh` and the browser.

Args: $ARGUMENTS

- If the args do not say what a PR changed, read it: `gh pr view <n> --json title,body,headRefName` and `git diff origin/main...origin/<branch> --stat`.
- Use the **headless browser** through `scripts/headless.cjs` (below). It never touches the user's window, so there is no focus step, no hidden-tab slowness, and you may set `viewport`. Do not use browser MCP tools for this skill.
- Run `headless.cjs` from inside the repo: `cd <repo> && node <skill>/scripts/headless.cjs ...`. It finds the repo with `git`, and the PR URL with `gh`.
- **Main chat:** start the dev server with `run_in_background` and `timeout: 7200000` before you call this skill. The default 30 min limit kills it mid-run.
- **PR already has shots:** retake them and swap the new ones in, unless the args say to keep them.
- **Could not finish?** Say what blocks you and end with: "Fix that, then call pr-screenshots again. Do not take the shots by hand: only this skill uploads to the PR."
- **Reply to the main chat in 15 lines or fewer:** for each PR, the shots taken, the PR body updated (yes or no), and any shot you skipped and why. No image content and no logs. The main chat pays for every line you send back.

The goal is a few small, clearly marked shots with little time and few tokens. Most cost in past runs came from guessing: test data, crop coordinates, render conditions, and big tool outputs. Each step below removes one guess.

Scripts are in `scripts/` next to this file (this skill's base directory, given when it loads; do not assume `~/.claude/skills`):

| Script             | What it does                                                                                                                                                                                                                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shoot.js`         | Reads `shots.json`. For each item it opens the page, waits until it is ready, highlights the text, crops and saves.                                                                                                                                                                                       |
| `upload.js`        | Reads `manifest.json` and uploads each PNG through a PR comment box. Returns the URLs. It never posts a comment.                                                                                                                                                                                          |
| `headless.cjs`     | Modes: `shoot <dir>`, `retake <dir> <out...>`, `publish <pr> <dir>`, `fresh`. Starts a headless copy of your browser (copy of the last-used profile's cookies, `~/.pr-shots-browser`, CDP 127.0.0.1:9333) if it is not up, serves the folder on :8765, runs `shoot.js` or `upload.js`, prints the result. |
| `sheet.js`         | Stacks the PNGs into one small image, so a single `Read` checks all shots.                                                                                                                                                                                                                                |
| `annotate-shot.js` | Draws boxes on an existing PNG (sharp). Fallback only. `shoot.js` highlights in the DOM, which is exact.                                                                                                                                                                                                  |

## 0. Preflight (one call)

`curl -s -o /dev/null -w "%{http_code}" --max-time 60 <url>` for each server you need. If it returns `000`, the server is down. Do not debug or restart it: reply "server down: <url>" and stop. The main chat starts servers with a long background timeout.

- Run every Bash command with absolute paths. Your shell does not start in the repo.
- Do not write your own Playwright or probe scripts, and do not read the script sources. To look at a page, run a `shots.json` item with no `highlights`. `waitFor` is optional.

## 1. Plan (no browser yet)

Write down each shot: the page URL, the text that proves the change, and the state it needs (a tooltip open, a fee greater than 0, ...).

- **Data:** find it with one API query before you start anything. Check the project notes for API headers and limits.
- **No data for that state:** mock it. Read the component's render condition first. Example: a row that shows only when there is a deposit needs `deposit` too, not only the field you care about.
- **"Before" shots:** take them from the real old code: a server already on `main` (usually the main checkout), or a temporary `origin/main` worktree with its own server. Never fake "before" by editing the new code's responses in the browser. Mocks are for data (API responses) only, never for the code the PR changes.
- **Worktree server:** Turbopack rejects a symlinked `node_modules`. Make an APFS clone first: `cp -cR <main>/node_modules node_modules`. Put the symlink back after.

## 2. Write shots.json, serve it, shoot

Make a folder, for example `/tmp/pr-shots/<pr>/`, and write `shots.json` in it. Nothing to copy and no server to start.

```json
{
  "dir": "/tmp/pr-shots/1295",
  "items": [
    {
      "out": "home-before.png",
      "url": "http://localhost:4444/home",
      "waitFor": "Medical Reports",
      "area": { "texts": ["All Appointment", "Medical Reports"] },
      "pad": 40,
      "padTop": 70,
      "highlights": [{ "text": "My Purchase", "label": "Old label" }]
    },
    {
      "out": "tooltip-after.png",
      "url": "http://localhost:4466/purchases/110907",
      "waitFor": "Handling Fee",
      "setup": "await page.route(/graphql/, async (r) => { const res = await r.fetch(); const j = await res.json(); /* edit j */ await r.fulfill({ response: res, json: j }); });",
      "before": "await page.getByText('Handling Fee', { exact: true }).locator('xpath=following-sibling::*[1]').dispatchEvent('mouseover'); await page.getByText('small order fee').waitFor();",
      "css": "[role=tooltip]:has(button){display:none!important}",
      "area": { "texts": ["Deposit", "small order fee"] },
      "highlights": [
        { "text": "$50.00", "label": "$ only", "labelAt": "below" }
      ]
    }
  ]
}
```

Fields:

| Field                        | Meaning                                                                                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `area.texts`                 | The crop is the box around these texts, plus the label pills. Pick texts at the corners of what you want to show.                                                               |
| `area.selector`              | A CSS selector for the crop, e.g. a menu `#market-menu .MuiPaper-root`. With `texts` too, the crop is the box around both, so label pills outside the menu stay in.             |
| `"=Text"`                    | In `area.texts` and `highlights[].text`: match a whole text node exactly. Use it for a heading that is also part of other text, e.g. `"=Bookings"` and not "View All Bookings". |
| `pad`, `padTop`, `padBottom` | Extra space around the crop, for example for icons above the labels.                                                                                                            |
| `highlights[].text`          | Gets a red box around only that substring.                                                                                                                                      |
| `highlights[].nth`           | Which visible match to box, 1-based. Default 1. Use it when the same text shows twice, e.g. `"nth": 2` for the second column.                                                   |
| `highlights[].labelAt`       | Where the label pill goes: `right` (default, after the whole text line), `above` or `below`. Use `below` inside dense blocks such as tooltips.                                  |
| `setup`                      | JavaScript that runs before the page loads. Use it for mocks: `page.route` for client queries, or edit `__NEXT_DATA__` in the document response for SSR data.                   |
| `before`                     | JavaScript that runs after the page loads. Use `dispatchEvent('mouseover')`, not hover or click. Those wait for "stable" and time out.                                          |
| `alt`                        | The PR body's `<img alt>` this shot replaces (or gets). `publish` swaps by this. Set it on every item.                                                                          |
| `cookies`                    | Top level, optional. Copies a login cookie from a logged-in site to the local app: `[{ "from": "https://dev.example.com", "name": "token", "to": "localhost" }]`. Save it in the project notes once it works. |
| `viewport`                   | Per item, e.g. `{ "width": 390, "height": 844 }` for mobile. Default 1440x900.                                                                                                  |

Then run `node <skill>/scripts/headless.cjs shoot /tmp/pr-shots/<pr>`. If the app or GitHub shows a login page, the cookie copy is old: run `node <skill>/scripts/headless.cjs fresh` and try again. Each result is one of:

| Result                                        | What to do                                                                    |
| --------------------------------------------- | ----------------------------------------------------------------------------- |
| `ok 900x231`                                  | Nothing. Do not look at the image yet.                                        |
| `ok, warn: box clipped ... by <h6>`           | Add the `css` it names and run that item again.                               |
| `ok, warn: crop cut at viewport bottom ...`   | Use less `padBottom`, or area texts closer together.                          |
| `error: text not found: "X" (near: "a", "b")` | Use one of the `near` texts. You do not need a probe call.                    |
| `error: ... Timeout`                          | A `waitFor` or `before` step did not happen. Check the condition in the code. |

Put a batch of items in one `shots.json`. Run again only the items that failed, not the whole batch.

`headless.cjs` and `shoot.js` handle these by itself, so do not do them by hand:

- the localhost login, when `shots.json` has `cookies` (copies each cookie from a site you are logged in to),
- a crop cut at the bottom or top: it retakes once with a taller viewport,
- big boxes and labels on wide crops, so they stay readable at 480px in the PR,
- `<name>-before.png` and `<name>-after.png` padded to the same size,
- saving every ok item to `jobs/<pr>.json`. To fix one shot later: `headless.cjs retake <dir> 1284-register.png`, no rebuild,
- waiting until spinners, skeletons and lazy images are done,
- finishing CSS animations, and turning off smooth scroll,
- hiding the Next dev overlay,

Gotchas from past runs:

- Adjacent JSX text (`{slot} banner`) is merged before matching, so `"Top banner"` matches. Text in separate elements is not merged.
- MUI Dialog: the paper itself has `role=dialog`. Use `.MuiDialog-paper` as `area.selector`, not `[role=dialog] .MuiDialog-paper`.
- Text matching ignores no-break spaces, so `"RM 1.00"` matches `Intl` money text. `<Trans>` splits text into nodes: `"<0>55 Services</0> available"` has no node "Services available". Use `"available"`.
- Each crop needs an area text at each edge you want. One text gives a narrow crop that cuts off the left or the bottom.
- After a sort or filter click, wait for the new result, not for a text that was already on the page. Example: `waitForFunction` until the first card is the expected one.
- An outline on a heading with ellipsis (`overflow:hidden`) gets clipped. Add `"css": "h6{overflow:visible!important}"`.
- The CDP connection has no `context.grantPermissions` or `setGeolocation`. Stub it in `setup`: `page.addInitScript(() => { navigator.geolocation.getCurrentPosition = (ok) => setTimeout(() => ok({ coords: { latitude: 3.139, longitude: 101.6869, accuracy: 10 }, timestamp: Date.now() }), 50); })`.
- Many PRs: use one worktree with a detached HEAD and one dev server. Switch with `git checkout --detach origin/<branch>`; Turbopack reloads in a few seconds. Take all "before" shots while it is on `origin/main`.
- `Read` only the contact sheet, never a full-size PNG (a 2000 px shot costs about 3x the tokens). To check a detail, crop and resize with sharp first.

If a tool call comes back "interrupted", look at the files before you run it again. The job usually finished.

## 3. Check with one image, once

`headless.cjs shoot` writes `<dir>/sheet.png` by itself after each run. `Read` that file, never a single shot PNG. For a sheet across several folders, make **one** contact sheet of **all** shots of the job, from all PRs:

```bash
NODE_PATH=<repo>/node_modules node <skill>/scripts/sheet.js /tmp/pr-shots/sheet.png <all pngs>
```

`Read` only `sheet.png`, and only once per job. Do not read a sheet for each batch, and never read a full-size PNG. The warnings in step 2 find most problems without images. The sheet finds what they cannot: wrong data on screen (for example a list that did not re-sort yet) or a label in a bad place. If a shot is bad, fix it, run it again, and check it with a sheet of only the fixed shots.

## 4. Upload and edit the PR

1. Run `node <skill>/scripts/headless.cjs publish <pr> <dir>`. It uploads every `<pr>-*.png` in the folder, swaps each into the `<img>` with the same `alt`, and adds the red-box note once. It lists any shot with no matching `alt` in `notSwapped`. Only those need a hand edit: add a row to the Screenshots table with that alt, then run `publish` again.

```markdown
The red boxes show the changed text.

| Before                                | After                                 |
| ------------------------------------- | ------------------------------------- |
| <img src="URL" alt="..." width="480"> | <img src="URL" alt="..." width="480"> |
```

2. If you used a mock, say so in one sentence, and name the fields you changed.
