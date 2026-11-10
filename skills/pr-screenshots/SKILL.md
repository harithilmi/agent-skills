---
name: pr-screenshots
description: >-
  Takes before/after screenshots of a web or React Native app and puts them in the GitHub PR body. Use when the user asks for PR screenshots ("add ss", "before/after"), or right after creating a UI PR of a web or React Native app: suggest adding them. Pass the PR numbers and the user's words (e.g. "retake") in args, plus dev server ports, test data or mocks if known. React Native: invoke this skill instead of driving the simulator from the main chat; brief format in MOBILE.md.
compatibility: >-
  Requires macOS, a Chromium browser (Chrome, Helium, Brave, Edge, Arc or Chromium) logged in to GitHub, the gh CLI, Node, and sharp + playwright-core (repo node_modules or npx cache). The terminal needs Full Disk Access. Mobile mode: an iOS Simulator or Android Emulator, either the T3 Code device tools or Maestro, ffmpeg, and uv (long shots).
metadata:
  author: harithilmi
context: fork
agent: general-purpose
model: sonnet
effort: medium
---

# PR screenshots

This file holds what both platforms share. Read the one file for your PR now, take the shots with it, then come back for step 3 (check) and step 4 (upload):

- **Web app:** [WEB.md](WEB.md), steps 0–2.
- **React Native app (simulator or emulator):** [MOBILE.md](MOBILE.md).

## Options

Env vars: `PR_SHOTS_BROWSER` (`helium`, `chrome`, `brave`, `edge`, `arc`, `chromium`; default is the first one installed, Helium first), `PR_SHOTS_PROFILE` (default: the profile used last, e.g. `"Profile 1"`), `PR_SHOTS_REPO` (default: the git repo you run it from). `PR_SHOTS_COOKIES` (`<site>=<host>` pairs, comma-separated: copy the site's cookies to a local host, e.g. `https://dev.example.com=localhost` when the local app reuses the dev login; set it per repo in the project notes).

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
- Run `headless.cjs` from inside the repo: `cd <repo> && node <skill>/scripts/headless.cjs ...`. It finds the repo with `git`, and the PR URL with `gh`.
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

If a tool call comes back "interrupted", look at the files before you run it again. The job usually finished.

## 3. Check with one image, once

`headless.cjs shoot` writes `<dir>/sheet.png` by itself after each run. For a sheet across several folders, make **one** contact sheet of **all** shots of the job, from all PRs:

```bash
NODE_PATH=<repo>/node_modules node <skill>/scripts/sheet.js /tmp/pr-shots/sheet.png <all pngs>
```

`Read` only `sheet.png`, and only once per job. Do not read a sheet for each batch, and never read a full-size PNG: to check a detail, crop and resize with sharp first. The warnings in step 2 find most problems without images. The sheet finds what they cannot: wrong data on screen (for example a list that did not re-sort yet) or a label in a bad place. If a shot is bad, fix it, run it again, and check it with a sheet of only the fixed shots.

## 4. Upload and edit the PR

1. Run `node <skill>/scripts/headless.cjs publish <pr> <dir>`. It uploads every `<pr>-*.png` in the folder, swaps each into the `<img>` with the same `alt`, and adds the red-box note once. It lists any shot with no matching `alt` in `notSwapped`. Only those need a hand edit: add a row to the Screenshots table with that alt, then run `publish` again.

```markdown
The red boxes show the changed text.

| Before                                | After                                 |
| ------------------------------------- | ------------------------------------- |
| <img src="URL" alt="..." width="480"> | <img src="URL" alt="..." width="480"> |
```

2. If you used a mock, say so in one sentence, and name the fields you changed.
