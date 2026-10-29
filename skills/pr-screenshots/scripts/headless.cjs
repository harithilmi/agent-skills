// Run shoot.js or upload.js in a headless copy of your Chromium browser, so your window is never touched.
//   node headless.cjs shoot  <dir>            (dir has shots.json)
//   node headless.cjs upload <dir> <pr-url>   (dir has manifest.json)
//   node headless.cjs fresh                   (copy the login cookies again and restart)
//   node headless.cjs retake  <dir> <out...>  (shoot saved items again, from jobs/<pr>.json)
//   node headless.cjs publish <pr> <dir>      (upload <dir>/<pr>-*.png, swap them into the PR body by alt)
// Run it from inside the repo (or set PR_SHOTS_REPO). Every ok item is saved to ../jobs/<pr>.json
// (pr = leading digits of `out`), so a retake needs no rebuild.
// The headless browser uses a copy of your profile's cookies and storage in ~/.pr-shots-browser
// (mode 700), with extensions off, on CDP port 9333 (127.0.0.1 only).
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 9333;
const SUPPORT = path.join(os.homedir(), 'Library/Application Support');
// Chromium browsers on macOS: [app, binary, user data dir]. First installed one wins.
// Override with PR_SHOTS_BROWSER=<name>, e.g. PR_SHOTS_BROWSER=brave.
const BROWSERS = {
  chrome: ['Google Chrome', 'Google Chrome', 'Google/Chrome'],
  helium: ['Helium', 'Helium', 'net.imput.helium'],
  brave: ['Brave Browser', 'Brave Browser', 'BraveSoftware/Brave-Browser'],
  edge: ['Microsoft Edge', 'Microsoft Edge', 'Microsoft Edge'],
  arc: ['Arc', 'Arc', 'Arc/User Data'],
  chromium: ['Chromium', 'Chromium', 'Chromium'],
};
const pick = () => {
  const want = process.env.PR_SHOTS_BROWSER?.toLowerCase();
  const names = want ? [want] : Object.keys(BROWSERS);
  for (const name of names) {
    const [app, bin, data] = BROWSERS[name] ?? [];
    const exe = app && `/Applications/${app}.app/Contents/MacOS/${bin}`;
    if (exe && fs.existsSync(exe) && fs.existsSync(path.join(SUPPORT, data))) return { exe, src: path.join(SUPPORT, data) };
  }
  throw new Error(`no Chromium browser found${want ? ` for PR_SHOTS_BROWSER=${want}` : ''} (${Object.keys(BROWSERS).join(', ')})`);
};
const { exe: BROWSER, src: SRC } = pick();
const DATA = path.join(os.homedir(), '.pr-shots-browser');
// The profile you used last (where you are logged in). Override with PR_SHOTS_PROFILE="Profile 1".
const PROFILE = process.env.PR_SHOTS_PROFILE
  ?? (() => { try { return JSON.parse(fs.readFileSync(path.join(SRC, 'Local State'), 'utf8')).profile.last_used; } catch {} })()
  ?? 'Default';
const REPO = process.env.PR_SHOTS_REPO ?? execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const JOBS = path.join(__dirname, '..', 'jobs');
const prOf = (out) => out.match(/^(\d+)-/)?.[1];
const readJob = (pr) => { try { return JSON.parse(fs.readFileSync(path.join(JOBS, `${pr}.json`), 'utf8')); } catch { return {}; } };

// playwright-core from the repo, or from the npx cache (any `npx playwright` run fills it).
const pwPath = () => {
  try { return require.resolve('playwright-core', { paths: [REPO] }); } catch {}
  const npx = path.join(os.homedir(), '.npm/_npx');
  for (const d of fs.existsSync(npx) ? fs.readdirSync(npx) : []) {
    const p = path.join(npx, d, 'node_modules/playwright-core');
    if (fs.existsSync(path.join(p, 'package.json'))) return p; // skip half-installed npx dirs
  }
  throw new Error('playwright-core not found: run `npx -y playwright-core --version` once');
};

const up = () => fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.ok, () => false);

const copyLogin = () => {
  try { fs.accessSync(path.join(SRC, 'Local State'), fs.constants.R_OK); }
  catch { throw new Error(`macOS blocks reading ${SRC}: give your terminal app Full Disk Access (System Settings > Privacy & Security), or set PR_SHOTS_BROWSER`); }
  fs.mkdirSync(path.join(DATA, PROFILE), { recursive: true, mode: 0o700 });
  fs.chmodSync(DATA, 0o700);
  fs.copyFileSync(path.join(SRC, 'Local State'), path.join(DATA, 'Local State'));
  for (const f of ['Cookies', 'Cookies-journal']) fs.copyFileSync(path.join(SRC, PROFILE, f), path.join(DATA, PROFILE, f));
  for (const d of ['Local Storage', 'Session Storage'])
    fs.cpSync(path.join(SRC, PROFILE, d), path.join(DATA, PROFILE, d), { recursive: true, force: true });
};

const start = async (fresh) => {
  if (fresh) {
    execSync(`pkill -f "user-data-dir=${DATA}" || true`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (await up()) return;
  copyLogin();
  spawn(BROWSER, [
    '--headless=new', `--user-data-dir=${DATA}`, `--profile-directory=${PROFILE}`,
    `--remote-debugging-port=${PORT}`, '--remote-debugging-address=127.0.0.1',
    '--no-first-run', '--disable-extensions', '--window-size=1440,900', 'about:blank',
  ], { detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 40 && !(await up()); i++) await new Promise((r) => setTimeout(r, 250));
  if (!(await up())) throw new Error('headless browser did not start');
};

// Make before/after pairs the same size, so they line up in the PR table. Pads with the corner color.
const matchPairs = async (dir, outs) => {
  const sharp = require(path.join(REPO, 'node_modules/sharp'));
  for (const before of outs.filter((o) => o.endsWith('-before.png'))) {
    const after = before.replace(/-before\.png$/, '-after.png');
    if (!fs.existsSync(path.join(dir, after))) continue;
    const files = [before, after].map((f) => path.join(dir, f));
    const meta = await Promise.all(files.map((f) => sharp(f).metadata()));
    const W = Math.max(...meta.map((m) => m.width)), H = Math.max(...meta.map((m) => m.height));
    for (const [i, f] of files.entries()) {
      if (meta[i].width === W && meta[i].height === H) continue;
      const { data } = await sharp(f).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
      const buf = await sharp(f).extend({ right: W - meta[i].width, bottom: H - meta[i].height, background: { r: data[0], g: data[1], b: data[2] } }).toBuffer();
      fs.writeFileSync(f, buf);
    }
  }
};

const saveJobs = (items, out) => {
  fs.mkdirSync(JOBS, { recursive: true });
  for (const it of items) {
    const pr = prOf(it.out);
    if (!pr || !String(out[it.out]).startsWith('ok')) continue;
    const job = readJob(pr);
    const { _grown, ...clean } = it;
    job[it.out] = clean;
    fs.writeFileSync(path.join(JOBS, `${pr}.json`), JSON.stringify(job, null, 1));
  }
};

// Swap each uploaded image into the PR body: the <img> whose alt matches the item's `alt`.
const swapBody = (pr, urls) => {
  const job = readJob(pr);
  let body = execSync(`gh pr view ${pr} --json body --jq .body`, { cwd: REPO, encoding: 'utf8' });
  const missing = [];
  for (const [file, url] of Object.entries(urls)) {
    const alt = job[file]?.alt;
    const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = alt && new RegExp(`(<img[^>]*?alt="${esc(alt)}"[^>]*?src=")[^"]+|(<img[^>]*?src=")[^"]+("[^>]*?alt="${esc(alt)}")`);
    if (!re || !re.test(body)) { missing.push(`${file} (alt: ${alt ?? 'none'}) -> ${url}`); continue; }
    body = body.replace(re, (m, a, b, c) => (a ? a + url : b + url + c));
  }
  const note = 'The red boxes show the changed parts.';
  if (!body.includes(note)) body = body.replace(/(## Screenshots[^\n]*\n)/, `$1\n${note}\n`);
  const f = path.join(os.tmpdir(), `pr-body-${pr}.md`);
  fs.writeFileSync(f, body);
  execSync(`gh pr edit ${pr} --body-file ${JSON.stringify(f)}`, { cwd: REPO, stdio: 'ignore' });
  return missing;
};

(async () => {
  let [mode, dir, prUrl, ...rest] = process.argv.slice(2);
  if (mode === 'retake') {
    const outs = [prUrl, ...rest].filter(Boolean);
    const items = outs.map((o) => readJob(prOf(o))[o]).filter(Boolean);
    if (items.length !== outs.length) throw new Error('not in jobs/: ' + outs.filter((o) => !readJob(prOf(o))[o]).join(', '));
    fs.mkdirSync(dir, { recursive: true });
    const prev = (() => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'shots.json'), 'utf8')); } catch { return {}; } })();
    fs.writeFileSync(path.join(dir, 'shots.json'), JSON.stringify({ ...prev, dir, items }, null, 1));
    mode = 'shoot';
  }
  let pr;
  if (mode === 'publish') {
    [pr, dir] = [dir, prUrl];
    const files = fs.readdirSync(dir).filter((f) => f.startsWith(`${pr}-`) && f.endsWith('.png'));
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(files));
    prUrl = execSync(`gh pr view ${pr} --json url --jq .url`, { cwd: REPO, encoding: 'utf8' }).trim();
  }
  if (mode === 'fresh') {
    execSync(`pkill -f "user-data-dir=${DATA}" || true`);
    copyLogin();
    return console.log('fresh login copied');
  }
  await start(false);

  // shoot.js and upload.js read their files from this server.
  const server = spawn('python3', ['-m', 'http.server', '8765', '--bind', '127.0.0.1'], { cwd: dir, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  globalThis.__headlessShots = true;
  const { chromium } = require(pwPath());
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const ctx = browser.contexts()[0];
  // PR_SHOTS_COOKIES="https://dev.example.com=localhost,..." copies a dev site's cookies to a local
  // host, for local apps that reuse the dev site's login.
  for (const pair of (process.env.PR_SHOTS_COOKIES ?? '').split(',').filter(Boolean)) {
    const [site, host] = pair.split('=');
    const cookies = await ctx.cookies(site);
    await ctx.addCookies(cookies.map(({ name, value }) => ({ name, value, domain: host, path: '/' })));
  }
  // Optional login copy for local apps, from shots.json `cookies`:
  // [{ "from": "https://dev.example.com", "name": "token", "to": "localhost" }]
  const { cookies = [] } = mode === 'shoot' ? JSON.parse(fs.readFileSync(path.join(dir, 'shots.json'), 'utf8')) : {};
  for (const { from, name, to } of cookies) {
    const c = (await ctx.cookies(from)).find((c) => c.name === name);
    if (c) await ctx.addCookies([{ name, value: c.value, domain: to, path: '/' }]);
  }
  const page = await ctx.newPage();
  const upload = mode === 'upload' || mode === 'publish';
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    if (upload) await page.goto(prUrl, { waitUntil: 'domcontentloaded' });
    const src = fs.readFileSync(path.join(__dirname, upload ? 'upload.js' : 'shoot.js'), 'utf8');
    const out = await new Function('page', 'return (' + src + ')(page)')(page);
    if (mode === 'shoot') {
      const items = JSON.parse(fs.readFileSync(path.join(dir, 'shots.json'), 'utf8')).items;
      await matchPairs(dir, Object.keys(out).filter((k) => String(out[k]).startsWith('ok')));
      saveJobs(items, out);
    }
    if (mode === 'publish' && !out.error) {
      const urls = Object.fromEntries(Object.entries(out).filter(([, u]) => String(u).startsWith('https://')));
      const missing = swapBody(pr, urls);
      out.swapped = Object.keys(urls).length - missing.length;
      if (missing.length) out.notSwapped = missing;
    }
    console.log(JSON.stringify(out, null, 1));
    // One contact sheet of this run's good shots, so the check is a single image read.
    const ok = mode === 'shoot' ? Object.keys(out).filter((k) => String(out[k]).startsWith('ok')).map((k) => path.join(dir, k)) : [];
    if (ok.length) {
      execSync(`node ${JSON.stringify(path.join(__dirname, 'sheet.js'))} ${JSON.stringify(path.join(dir, 'sheet.png'))} ${ok.map((f) => JSON.stringify(f)).join(' ')}`,
        { env: { ...process.env, NODE_PATH: path.join(REPO, 'node_modules') } });
      console.log('sheet: ' + path.join(dir, 'sheet.png') + ' (Read only this image)');
    }
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
    server.kill();
    // Never leave the second browser running.
    execSync(`pkill -f "user-data-dir=${DATA}" || true`);
  }
})().catch((e) => { console.log('error: ' + String(e.message).split('\n')[0]); process.exit(1); });
