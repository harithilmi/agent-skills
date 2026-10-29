---
name: helium-browser
description: >-
  Load before ANY browser work (Helium via playwright-helium, never Chrome). Use when a task needs a web page — localhost/staging, "check if it works", "see how it looks", console/network errors, Figma/GitHub, scraping, or WebFetch/curl can't read a page — or when playwright-helium is slow, stuck, failing or missing. Not for Playwright test code or PR screenshots (use pr-screenshots).
metadata:
  author: harithilmi
---

# Helium browser

`playwright-helium` drives the user's real Helium window through the "Playwright MCP Bridge" extension. They are logged in there (Figma, GitHub, the dev app). Treat it like their desk: work in your own tab and leave everything else as it was.

## Connect

1. Load the tools: `ToolSearch` with `select:mcp__playwright-helium__browser_navigate,mcp__playwright-helium__browser_run_code_unsafe,mcp__playwright-helium__browser_tabs`. MCP tools load only at session start. If they are missing, tell the user to restart the chat. Do not fall back to Chrome.
2. The first `browser_navigate` can fail with "extension did not connect within 30s". Call it one more time before you report a failure.
3. Use `browser_run_code_unsafe` for anything with more than one step. One call that does goto, wait, act and return costs much less than many small tool calls.

## Hidden tab

Do not steal focus: do not call `page.bringToFront()`, and do not select or switch tabs. (`pr-screenshots` uses its own headless browser, so it never touches this.)

**Open a fresh tab per job, and close it at the end.** The MCP's own `page` goes hidden once the user looks elsewhere. Measured 2026-10-26 on a three.js app: hidden reused tab = 1 fps, timers ~1/s. A fresh `newPage()` stayed visible (115 fps, normal timers) even with Helium minimized.

```js
async (page) => {
  const p = await page.context().newPage();
  try { await p.goto(url); /* work */ return result; } finally { await p.close(); }
}
```

Do not use the old rAF → `setTimeout` shim. It does not help: in a hidden tab, `setTimeout` is throttled too.

| In a hidden tab | What happens | What to do |
|---|---|---|
| `requestAnimationFrame`, timers | rAF ~1 fps, timers ~1/s, so loaders crawl | Use a fresh tab (above). Wait for a condition (`waitFor`, `waitForFunction`), not a fixed time. Check real visibility with `Object.getOwnPropertyDescriptor(Document.prototype,'hidden').get.call(document)` |
| `click()`, `hover()` | Time out waiting for "stable" | `dispatchEvent('click')`, `dispatchEvent('mouseover')`, or `click({ force: true })` |
| Figma canvas input | Does not arrive | Ask the user to open a separate Helium window where your tab is active |
| `screenshot()`, `evaluate`, `goto`, `reload` | Work | Nothing to do |

## Rules

- Do not resize the window and do not close the user's tabs.
- Downloads (for example Figma exports) go to `~/Downloads`. Playwright gets no download event.
- `browser_run_code_unsafe { filename }` loads files only from `<repo>/.playwright-mcp/` and the repo. The tool echoes the whole file in its output, so keep that file small. Get large data through `page.request.get('http://127.0.0.1:<port>/...')` from a local `python3 -m http.server`. `page.request` runs on the local Playwright side, so it reaches localhost.
- Never print cookie or token values.
- Don't navigate the tab to a PDF: Chrome's PDF viewer is a separate target and Playwright detaches. Render it with pdf.js on a local page instead.

## Welcome tabs and groups

- Each Claude chat starts its own `playwright-helium` MCP. The extension gives each one a "Welcome" tab (`connect.html`) in its own "Playwright · claude-code" group. When the chat closes normally, the extension closes the group.
- A group is a live connection. Do not close it while that chat still uses the browser.
- A Welcome tab outside any group comes from an MCP process that died suddenly (a restart mid-session changes the relay port). It is safe to close. Tell the user; do not close it yourself.
- **Clean up when the browser work for a task is done** (tested 2026-10-29). Close this chat's own Welcome tab by its relay port. The next browser call reconnects by itself and opens a new Welcome tab.
  1. `browser_tabs` `list` → read the port in `mcpRelayUrl=ws%3A%2F%2F%5B%3A%3A1%5D%3A<port>%2F`.
  2. Close only that tab:
     ```sh
     osascript <<'EOF'
     tell application "Helium"
       repeat with w in windows
         repeat with t in (tabs of w)
           if URL of t contains "%3A<port>%2F" then
             close t
             return -- the tab list just shrank; looping on errors with "Invalid index"
           end if
         end repeat
       end repeat
     end tell
     EOF
     ```
  - Get the port from earlier tool output if you can. `browser_tabs list` reconnects if the tab is already gone, which opens a new Welcome tab.
  - Do not use `browser_close` for this. It disconnects but leaves the Welcome tab behind, dead, and the next call adds another one.
- Too many groups? Find the old MCP processes: `ps -o pid,ppid,lstart,command -ax | grep 'playwright/mcp@latest --extension'`. The parent is the `claude` session that owns each one.

## Repair

- Server `playwright-helium`, user scope, in `~/.claude.json`: `npx @playwright/mcp@latest --extension --executable-path /Applications/Helium.app/Contents/MacOS/Helium`.
- The env var `PLAYWRIGHT_MCP_EXTENSION_TOKEN` holds the extension token. With it, there is no approve prompt. Never print the token.
- Check: `claude mcp get playwright-helium`.
- Add again: `claude mcp add playwright-helium -s user -e PLAYWRIGHT_MCP_EXTENSION_TOKEN=<token> -- npx @playwright/mcp@latest --extension --executable-path /Applications/Helium.app/Contents/MacOS/Helium`.
