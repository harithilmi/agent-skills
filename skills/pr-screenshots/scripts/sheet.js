#!/usr/bin/env node
// Stack PNGs into one downscaled contact sheet, so one image read checks every shot.
// Usage: NODE_PATH=<repo>/node_modules node sheet.js out.png a.png b.png ...
const sharp = require('sharp');
const path = require('path');
const [out, ...files] = process.argv.slice(2);
const W = 900; // enough to read labels, cheap in image tokens
(async () => {
  const rows = [];
  let y = 0;
  for (const f of files) {
    const img = sharp(f).resize({ width: W, withoutEnlargement: true });
    const buf = await img.png().toBuffer();
    const { height, width } = await sharp(buf).metadata();
    const title = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="28"><text x="8" y="20" font-family="Helvetica" font-size="16" font-weight="700" fill="#333">${path.basename(f)} (${width}x${height})</text></svg>`);
    rows.push({ input: title, top: y, left: 0 }, { input: buf, top: y + 28, left: 0 });
    y += 28 + height + 12;
  }
  await sharp({ create: { width: W, height: y, channels: 3, background: '#ffffff' } }).composite(rows).png().toFile(out);
  console.log(out);
})();
