// Take annotated, cropped screenshots of a local web app, driven by shots.json.
// Run through headless.cjs (see SKILL.md). Needs `python3 -m http.server 8765 --bind 127.0.0.1` in the folder that has shots.json.
// See SKILL.md for the shots.json format. Returns { "<out>": "ok" | "error: ..." }.
async (page) => {
  const base = 'http://127.0.0.1:8765/';
  const { dir, items, focus = true } = await (await page.request.get(base + 'shots.json')).json();
  // Browsers throttle hidden tabs (timers ~1/s), so loading is slow there. With focus (default),
  // bring this tab to the front once for the whole job (only when driving a real window).
  // headless.cjs sets this flag; there is no window to bring to the front.
  const headless = !!globalThis.__headlessShots;
  if (focus && !headless) await page.bringToFront();

  // A hidden tab pauses rAF, so app loaders never finish. Fake it, and say the tab is visible.
  await page.addInitScript(() => {
    window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);
    window.cancelAnimationFrame = (id) => clearTimeout(id);
    Object.defineProperty(document, 'visibilityState', { get: () => 'visible' });
    Object.defineProperty(document, 'hidden', { get: () => false });
  });

  // Block the user's real input on this tab while we work, so a stray hover or scroll does not
  // close a tooltip or move the page. Our own dispatchEvent() events are untrusted, so they pass.
  // Headless has no real user input, and the guard would block Playwright's own .click().
  const guard = (on) => headless ? Promise.resolve() : page.evaluate((on) => {
    const types = ['mousemove', 'mouseover', 'mouseout', 'mouseenter', 'mouseleave', 'mousedown', 'mouseup', 'click',
      'pointermove', 'pointerover', 'pointerout', 'pointerdown', 'pointerup', 'wheel', 'touchstart', 'touchmove', 'keydown', 'keyup'];
    window.__shotBlock ??= (e) => { if (e.isTrusted) { e.stopImmediatePropagation(); e.preventDefault(); } };
    types.forEach((t) => (on ? addEventListener : removeEventListener)(t, window.__shotBlock, { capture: true, passive: false }));
    document.getElementById('claude-shot-guard')?.remove();
    if (on) {
      const b = document.createElement('div');
      b.id = 'claude-shot-guard';
      b.textContent = 'Claude is taking screenshots. Input is paused on this tab.';
      b.style.cssText = 'position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:2147483647;background:#E53935;color:#fff;font:600 12px Helvetica,Arial,sans-serif;padding:4px 10px;border-radius:0 0 6px 6px;pointer-events:none';
      document.body.appendChild(b);
    }
  }, on).catch(() => {});
  const hideGuard = '#claude-shot-guard{display:none!important}';

  const results = {};
  for (const s of items) {
    try {
      // Optional steps before load, e.g. a page.route() mock. Runs with `page` in scope.
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      if (s.setup) await new Function('page', `return (async () => { ${s.setup} })()`)(page);
      // Headless only (headless.cjs): never resize a real window.
      const size = s.viewport ?? { width: 1440, height: 900 };
      const resized = headless && JSON.stringify(page.viewportSize()) !== JSON.stringify(size);
      if (resized) await page.setViewportSize(size);
      if (page.url() !== s.url || s.reload || s.setup || resized) {
        await page.goto(s.url, { waitUntil: 'domcontentloaded', timeout: 120000 });
      }
      await guard(true);
      if (s.waitFor) await page.getByText(s.waitFor).first().waitFor({ state: 'visible', timeout: 60000 });
      // Text can be "visible" under a loader overlay. Wait until no spinner or skeleton is on screen.
      // Also load lazy images (a hidden tab may never trigger them) and wait for them.
      await page.evaluate(() => document.querySelectorAll('img[loading=lazy]').forEach((i) => { i.loading = 'eager'; }));
      await page.waitForFunction(() => {
        const onScreen = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.bottom > 0 && r.top < innerHeight; };
        const busy = [...document.querySelectorAll('[role=progressbar],.MuiCircularProgress-root,.MuiSkeleton-root')].some(onScreen);
        const imgs = [...document.images].filter(onScreen).every((i) => i.complete);
        return !busy && imgs;
      }, null, { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(s.settleMs ?? 500);
      // Smooth scroll would move the page after we measure the crop.
      await page.addStyleTag({ content: `nextjs-portal{display:none!important}html,body{scroll-behavior:auto!important}${s.css ?? ''}` });
      // Optional steps before the shot, e.g. open a tooltip: "await page.getByText('X').dispatchEvent('mouseover')"
      if (s.before) await new Function('page', `return (async () => { ${s.before} })()`)(page);

      // Wrap each highlight text in a red box (only that substring), with an optional label pill.
      // Scroll first and let popups (tooltips, menus) settle at their new place, then highlight and measure.
      const first = s.area?.texts?.[0];
      if (first) {
        await page.getByText(first).first().evaluate((e) => e.scrollIntoView({ block: 'center' })).catch(() => {});
        await page.waitForTimeout(300);
      }
      // A hidden tab throttles CSS animations, so fade-ins can still be at opacity 0. Jump them to the end.
      await page.evaluate(() => document.getAnimations().forEach((a) => { try { a.finish(); } catch {} }));
      const mark = (k) => page.evaluate(({ highlights, areaTexts, k }) => {
        const RED = '#E53935';
        document.querySelectorAll('.shot-pill').forEach((e) => e.remove());
        // Re-runnable: undo the boxes of an earlier pass.
        document.querySelectorAll('.shot-box').forEach((b) => { const p = b.parentNode; b.replaceWith(...b.childNodes); p.normalize(); });
        // JSX like `{slot} banner` renders adjacent text nodes. Merge them, so "Top banner" is one match.
        document.body.normalize();
        // Intl money formats use a no-break space ("RM\u00a01.00"), so compare with plain spaces.
        const norm = (t) => t.replace(/\u00a0/g, ' ');
        // "=Text" matches a whole text node exactly, e.g. a heading that is also a word in a menu.
        const strip = (text) => text.replace(/^=/, '');
        // `nth` (1-based) picks a later visible match, e.g. the same label in the second column.
        const findText = (text, nth = 1) => {
          const want = strip(text);
          const hit = text.startsWith('=') ? (t) => t.trim() === want : (t) => t.includes(want);
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode: (n) => n.parentElement.closest('script,style,noscript') || !hit(norm(n.textContent))
              ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
          });
          // Visible nodes only.
          let seen = 0;
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            if (n.parentElement.getBoundingClientRect().width > 0 && ++seen === nth) return n;
          }
          return null;
        };
        // On a miss, list visible texts that share a word, so the caller can fix shots.json without a probe call.
        const near = (text) => {
          const words = strip(text).toLowerCase().split(/\W+/).filter((w) => w.length >= 3);
          const out = new Set();
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          for (let n = walker.nextNode(); n && out.size < 4; n = walker.nextNode()) {
            const t = norm(n.textContent).trim();
            if (t && n.parentElement.getBoundingClientRect().width > 0 && words.some((w) => t.toLowerCase().includes(w))) out.add(t.slice(0, 50));
          }
          return `"${text}"` + (out.size ? ` (near: ${[...out].map((t) => `"${t}"`).join(', ')})` : ' (no similar text)');
        };
        const lost = [];
        const warn = [];
        for (const h of highlights ?? []) {
          const node = findText(h.text, h.nth);
          if (!node) { lost.push(near(h.text)); continue; }
          const range = document.createRange();
          const want = strip(h.text);
          const start = norm(node.textContent).indexOf(want);
          range.setStart(node, start);
          range.setEnd(node, start + want.length);
          const box = document.createElement('span');
          box.className = 'shot-box';
          box.style.cssText = `outline:${3 * k}px solid ${RED};outline-offset:${3 * k}px;border-radius:${4 * k}px`;
          range.surroundContents(box);
          // The outline needs ~6px around the text. A parent with overflow hidden (ellipsis) cuts it off.
          const br = box.getBoundingClientRect();
          for (let a = box.parentElement; a && a !== document.body; a = a.parentElement) {
            const cs = getComputedStyle(a);
            if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
            const ar = a.getBoundingClientRect();
            if (br.left - 6 < ar.left || br.right + 6 > ar.right || br.top - 6 < ar.top || br.bottom + 6 > ar.bottom) {
              warn.push(`box clipped: "${h.text}" by <${a.tagName.toLowerCase()}> overflow:hidden (add css overflow:visible)`);
            }
            break;
          }
          if (h.label) {
            // Place the pill after the whole text line, so it does not cover the rest, e.g. " (16)".
            const r = box.getBoundingClientRect();
            const line = box.parentElement.getBoundingClientRect();
            const textRight = Math.min(line.right, Math.max(r.right, ...[...box.parentElement.getClientRects()].map((c) => c.right)));
            const pill = document.createElement('div');
            pill.className = 'shot-pill';
            pill.textContent = h.label;
            pill.style.cssText = `position:absolute;z-index:2147483647;background:${RED};color:#fff;font:700 ${12 * k}px/1 Helvetica,Arial,sans-serif;padding:${5 * k}px ${9 * k}px;border-radius:999px;white-space:nowrap`;
            document.body.appendChild(pill);
            // labelAt: right (default, falls back to above when it does not fit) | above | below
            let at = h.labelAt ?? 'right';
            if (at === 'right' && textRight + 12 + pill.offsetWidth > innerWidth) at = 'above';
            const left = at === 'right' ? textRight + 12 : r.left;
            const top = at === 'right' ? r.top + (r.height - pill.offsetHeight) / 2
              : at === 'above' ? r.top - pill.offsetHeight - 8 : r.bottom + 8;
            pill.style.left = `${left + scrollX}px`;
            pill.style.top = `${top + scrollY}px`;
            pill.dataset.box = '1';
          }
        }
        // Crop area: the box around all `areaTexts` and the label pills.
        let rect = null;
        if (areaTexts?.length) {
          const els = areaTexts.map((t) => [t, findText(t)?.parentElement]);
          els.filter(([, e]) => !e).forEach(([t]) => lost.push(`area: ${near(t)}`));
          const found = els.map(([, e]) => e).filter(Boolean);
          if (found.length) {
            const rs = [...found, ...document.querySelectorAll('.shot-pill')].map((e) => e.getBoundingClientRect());
            const x = Math.min(...rs.map((r) => r.left)), y = Math.min(...rs.map((r) => r.top));
            rect = { x, y, width: Math.max(...rs.map((r) => r.right)) - x, height: Math.max(...rs.map((r) => r.bottom)) - y };
          }
        }
        return { lost, rect, warn };
      }, { highlights: s.highlights, areaTexts: s.area?.texts, k });
      // The PR shows shots about 480px wide. A wide crop shrinks a lot there, so scale the boxes and labels up.
      let found = await mark(1);
      const k = found.rect ? Math.min(2.5, Math.max(1, found.rect.width / 700)) : 1;
      if (k > 1.15) found = await mark(k);
      const missing = found.lost;
      if (missing.length) { results[s.out] = `error: text not found: ${missing.join(' | ')}`; continue; }

      let b = found.rect;
      if (s.area?.selector) {
        const el = page.locator(s.area.selector).first();
        // With texts too, the page is already scrolled to them, so do not scroll again.
        if (!b) await el.evaluate((e) => e.scrollIntoView({ block: 'center' }));
        const sb = await el.boundingBox();
        // Both given: the crop is the box around the element and the texts (and pills).
        b = b && sb ? (({ x, y, r, btm }) => ({ x, y, width: r - x, height: btm - y }))({
          x: Math.min(b.x, sb.x), y: Math.min(b.y, sb.y),
          r: Math.max(b.x + b.width, sb.x + sb.width), btm: Math.max(b.y + b.height, sb.y + sb.height),
        }) : sb;
      }
      if (!b) { results[s.out] = 'error: set area.texts or area.selector'; continue; }
      const pad = s.pad ?? 16;
      const vp = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
      const x = Math.max(0, b.x - pad);
      const y = Math.max(0, b.y - pad - (s.padTop ?? 0));
      const w = b.width + pad * 2, h = b.height + pad * 2 + (s.padTop ?? 0) + (s.padBottom ?? 0);
      const clip = { x, y, width: Math.min(vp.w - x, w), height: Math.min(vp.h - y, h) };
      const warn = [...found.warn];
      if (headless && !s._grown && (clip.height < h - 4 || b.y - pad - (s.padTop ?? 0) < -4)) {
        items.push({ ...s, _grown: true, viewport: { width: size.width, height: Math.ceil(Math.max(size.height + 200, y + h + 100, h + 200)) } });
        continue;
      }
      if (clip.height < h - 4) warn.push(`crop cut at viewport bottom by ${Math.round(h - clip.height)}px (less padBottom, or pick area texts closer together)`);
      if (clip.width < w - 4) warn.push(`crop cut at viewport right by ${Math.round(w - clip.width)}px`);
      // Padding past the page edge is trimmed (fine). Only a cut-off box is a problem.
      if (b.x < -4 || b.y < -4) warn.push('box starts above or left of the viewport');
      await page.screenshot({ path: `${dir}/${s.out}`, style: hideGuard, clip });
      results[s.out] = warn.length ? `ok, warn: ${warn.join('; ')}` : `ok ${Math.round(clip.width)}x${Math.round(clip.height)}`;
    } catch (e) {
      results[s.out] = `error: ${String(e.message).split('\n')[0]}`;
    }
  }
  await guard(false);
  return results;
}
