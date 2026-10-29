// Upload PNGs to GitHub user-attachments through the PR comment box. Never posts a comment.
// Run through headless.cjs (see SKILL.md) while the tab is on any github.com PR page.
// Needs `python3 -m http.server 8765 --bind 127.0.0.1` in the shots folder, with manifest.json = ["a.png", ...].
// Returns { "a.png": "https://github.com/user-attachments/assets/...", ... }
async (page) => {
  const base = 'http://127.0.0.1:8765/';
  if (!/github\.com\/.+\/pull\/\d+/.test(page.url())) return 'open a github PR page first';
  const files = await (await page.request.get(base + 'manifest.json')).json();
  // A tab that already did uploads gets stuck on "Uploading…", so start from a fresh page.
  await page.reload({ waitUntil: 'domcontentloaded' });
  // Encrypted cookies that fail to decrypt are dropped, so the page loads signed out.
  if (!(await page.locator('meta[name=user-login]').getAttribute('content').catch(() => null)))
    return { error: 'not signed in to GitHub in the headless browser: sign in to GitHub in your browser, and allow the "<Browser> Safe Storage" Keychain prompt (Always Allow)' };
  await page.locator('textarea#new_comment_field').waitFor({ state: 'attached', timeout: 30000 });
  const ta = page.locator('textarea#new_comment_field');
  const input = page.locator('input#fc-new_comment_field');
  await ta.fill('');
  // GitHub appends one <img alt="<name without .png>" src="..."> per upload; wait for each before the next.
  const urls = () => ta.inputValue().then((v) =>
    Object.fromEntries([...v.matchAll(/alt="([^"]+)" src="(https:\/\/github\.com\/user-attachments\/assets\/[^"]+)"/g)].map((m) => [m[1], m[2]])));
  const out = {};
  for (const name of files) {
    const res = await page.request.get(base + encodeURIComponent(name));
    if (!res.ok()) { out[name] = 'HTTP ' + res.status(); continue; }
    const buffer = await res.body();
    const key = name.replace(/\.png$/, '');
    out[name] = 'timeout';
    // Retry once if GitHub drops the upload.
    for (let attempt = 0; attempt < 2 && out[name] === 'timeout'; attempt++) {
      await input.setInputFiles({ name, mimeType: 'image/png', buffer });
      for (let i = 0; i < 30; i++) {
        const u = (await urls())[key];
        if (u) { out[name] = u; break; }
        await page.waitForTimeout(500);
      }
    }
  }
  await ta.fill('');
  return out;
}
