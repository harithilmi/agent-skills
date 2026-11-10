# Web mode (a web app in the headless browser)

Use this mode when the PR changes a web app. Do steps 0–2 here, then go back to `SKILL.md` for step 3 (check) and step 4 (upload).

- Use the **headless browser** through `scripts/headless.cjs` (below). It never touches the user's window, so there is no focus step, no hidden-tab slowness, and you may set `viewport`. Do not use browser MCP tools for this skill.
- **Main chat:** start the dev server with `run_in_background` and `timeout: 7200000` before you call this skill. The default 30 min limit kills it mid-run.

## 0. Preflight (one call)

`curl -s -o /dev/null -w "%{http_code}" --max-time 60 <url>` for each server you need. If it returns `000`, the server is down. Do not debug or restart it: reply "server down: <url>" and stop. The main chat starts servers with a long background timeout.

- Run every Bash command with absolute paths. Your shell does not start in the repo.
- Do not write your own Playwright or probe scripts, and do not read the script sources. To look at a page, run a `shots.json` item with no `highlights`. `waitFor` is optional.

## 1. Plan (no browser yet)

Write down each shot: the page URL, the text that proves the change, and the state it needs (a tooltip open, a fee greater than 0, ...).

- **Page shot before?** Run `grep -l '<url path>' <skill>/jobs/*.json`. If a job has it, copy that item's `url`, `setup`, `waitFor`, `css` and `area`. They worked before, so you do not need to read the code again.

- **Data:** find it with one API query before you start anything. Check the project notes for API headers and limits.
- **No data for that state:** mock it. Read the component's render condition first. Example: a row that shows only when there is a deposit needs `deposit` too, not only the field you care about.
- **"Before" shots:** take them from the real old code: a server already on `main` (usually the main checkout), or an `origin/main` worktree with its own server. Keep that worktree and write its path in the project notes. Next time, reuse it with `git checkout --detach origin/main`. A new one costs about 2 minutes (`node_modules` clone and first compile). Never fake "before" by editing the new code's responses in the browser. Mocks are for data (API responses) only, never for the code the PR changes.
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
