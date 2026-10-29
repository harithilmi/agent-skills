---
name: marketplace-price-research
description: >-
  Use for any used/second-hand price question ("how much is a used X", "sell my X for", "harga second hand", FB Marketplace/Carousell MY) — researches listings and gives a buy/sell price.
metadata:
  author: harithilmi
---

# Marketplace Price Research

Playbook learned the hard way. Product-agnostic. Tested on FB Marketplace + Carousell MY; for other sites apply the same rules and verify selectors first.

## 0. Before starting

- Browser: **Helium only** (`mcp__playwright-helium__*`, see the `helium-browser` skill). Never bring tabs to front, never switch tabs, never message sellers.
- Ask once, if not given: **buying or selling?** (advice differs), exact variant (model/size/spec), must-exclude conditions. Default region: whole Malaysia, note location per listing.
- Confirm FB login before anything:
  ```js
  () => ({ loggedIn: document.cookie.includes('c_user') && !document.querySelector('input[name="email"]') })
  ```
  Not logged in → stop and tell user.

## 1. Timing rules (most important)

- Every `browser_run_code_unsafe` call must finish in **< ~20s**. Long loops time out or get cut by a new user message.
- **A cut-off script keeps running server-side** and hijacks the tab (navigates by itself). After any interrupted call, poll until idle before new work:
  ```js
  async (page) => { const s = []; for (let i = 0; i < 5; i++) { s.push([page.url(), await page.evaluate(() => scrollY)]); await page.waitForTimeout(2000); } return s; }
  ```
- Shape: setup call → short scroll calls → extract call. One status line per step so the user sees progress.

## 2. FB Marketplace

Search URL: `https://www.facebook.com/marketplace/<city>/search?query=<q>` (e.g. `kualalumpur`). Run 2–3 query variants; dedupe by item id.

- `window.scrollBy` does **not** load more. Use `page.mouse.wheel`.
- The list is **virtualized** (off-screen cards get removed). Collect while scrolling.
- Deep scroll drifts nationwide. Fine, but keep location.

Setup + first scrolls:
```js
async (page) => {
  await page.goto('https://www.facebook.com/marketplace/kualalumpur/search?query=' + encodeURIComponent('QUERY'));
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    window.__m = {};
    const grab = () => document.querySelectorAll('a[href*="/marketplace/item/"]').forEach(a => {
      const id = a.href.match(/item\/(\d+)/)?.[1];
      if (id) window.__m[id] = a.innerText.replace(/\n+/g, ' | '); // "price | old price? | title | location"
    });
    grab(); setInterval(grab, 500);
  });
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 5000); await page.waitForTimeout(1500); }
  return await page.evaluate(() => Object.keys(window.__m).length);
}
```
More scrolls + extract (repeat until count plateaus or results go off-topic):
```js
async (page) => {
  for (let i = 0; i < 7; i++) { await page.mouse.wheel(0, 5000); await page.waitForTimeout(1500); }
  return await page.evaluate(() => Object.entries(window.__m).filter(([, t]) => /MODEL_REGEX/i.test(t)));
}
```
First price on a card = current price; a second one = old crossed-out price.

Descriptions are **not** in fetched HTML (loaded via GraphQL). Open each listing, ~5s each, **4–5 per call**:
```js
async (page) => {
  const ids = ['ID1', 'ID2', 'ID3', 'ID4'];
  const out = {};
  for (const id of ids) {
    await page.goto(`https://www.facebook.com/marketplace/item/${id}/`);
    await page.waitForSelector('text=Details', { timeout: 6000 }).catch(() => {});
    const more = page.locator('[role="main"] >> text="See more"').first();
    if (await more.count()) await more.click({ timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(400);
    const t = await page.evaluate(() => (document.querySelector('[role="main"]') || document.body).innerText);
    out[id] = t.split(/Seller information|Location is approximate/)[0]
      .replace(/\n+/g, ' | ').replace('This listing is far from your current location. | See listings near me | ', '').slice(0, 1000);
  }
  return out;
}
```

## 3. Carousell MY

- Search defaults to the **"Certified" tab** (official refurb only). Always use `https://www.carousell.com.my/search/<q>/?tab=marketplace`.
- Pagination = **"Show more results" button**, not infinite scroll.

Search + extract:
```js
async (page) => {
  const grab = () => page.evaluate(() => {
    const m = {};
    document.querySelectorAll('a[href*="/p/"]').forEach(a => {
      const url = a.href.split('?')[0];
      let el = a; while (el && !/RM[\d,]+/.test(el.innerText || '')) el = el.parentElement;
      while (el?.parentElement && el.parentElement.querySelectorAll('a[href*="/p/"]').length === el.querySelectorAll('a[href*="/p/"]').length) el = el.parentElement;
      if (el) m[url] = el.innerText.replace(/\n+/g, ' | ');
    });
    return m;
  });
  await page.goto(`https://www.carousell.com.my/search/${encodeURIComponent('QUERY')}/?tab=marketplace`);
  await page.waitForTimeout(2500);
  const all = await grab();
  for (let i = 0; i < 2; i++) {
    const btn = page.getByRole('button', { name: /show more results/i });
    if (!(await btn.count())) break;
    await btn.click(); await page.waitForTimeout(2000);
    Object.assign(all, await grab());
  }
  return Object.entries(all).filter(([, t]) => /MODEL_REGEX/i.test(t));
}
```
Item page has structured fields (Condition, Screen, Body, Local/International set, Listed vs **Bumped** date, meet-up location):
```js
async (page) => {
  const out = {};
  for (const u of ['URL1', 'URL2', 'URL3', 'URL4', 'URL5']) {
    await page.goto(u); await page.waitForTimeout(2000);
    const t = (await page.evaluate(() => (document.querySelector('main') || document.body).innerText)).replace(/\n+/g, ' | ');
    const s = t.indexOf('Condition |'), e = t.indexOf('Meet the seller');
    out[u] = t.slice(s, e > 0 ? e : s + 1000).slice(0, 1000);
  }
  return out;
}
```
"Bumped 2 months ago" ≠ listed date. "Listed over a year ago" = stale.

## 4. Filtering traps

- **Titles lie.** Title regex is a pre-filter only. Read every description ("Clearance Sales" turned out to be a different model).
- **Keyword match ≠ defect.** Use word boundaries (`line` ⊂ `online`) and handle negation ("takde line", "no line", "tiada calar"). Read context before excluding.
- **Malay terms:** pecah / retak (cracked), rosak (broken), calar (scratch), kotak / fullset (box), nego, COD, ansuran (installment), swap / trade in, "sell only".
- **Shop duplicates:** dealers copy-paste one template across branches and platforms (seen ×8). For stats, count each shop+price once; in the table show "Shop ×N".
- **Bait prices:** trade-in shops list ~50% under market. Confirm by finding the same shop's other listings, then exclude as bait.
- **Variant traps:** import sets (SG / CN / KR / CH), wrong storage/size, "copy set" / clones, other brands sharing the model name.
- **Stale listings** (months old, still unsold) = overpriced signal, not market price.
- **No description** = flag "verify yourself", don't assume clean.
- Prices are **asking prices, not sold prices**. Always say so.

## 5. Output

- Stats on the deduped set, per platform + combined: n, min, median, max, avg, middle half (p25–p75). Median beats average here.
- Chart (load `dataviz` skill first, render via `html_preview` → `html_render`): dot plot, one row per platform plus an "Excluded" row; filled dot = shop, hollow = private, ✕ = excluded; stack equal prices (group within RM10); shade the recommended zone; hover tooltip with title/location/notes.
- Table: platform, price, title, location, condition notes, link. Sort by price.
- Excluded list grouped by reason, one line each.
- Recommendation as a ladder:
  - **Seller:** quick sale / list at → accept / premium (fullset + proof). Private sellers must undercut shops that add warranty.
  - **Buyer:** good deal / fair / walk away above.
- Seller tips that apply broadly: show proof of the key defect buyers fear (photo/video), list specs nobody else lists (e.g. battery %), post on both platforms.
