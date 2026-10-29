#!/usr/bin/env node
// Draw highlight boxes + label pills on a PNG.
// Usage: NODE_PATH=<repo>/node_modules node annotate-shot.js in.png out.png 'x,y,w,h[,label[,labelX,labelY]]' ...
// Coordinates are image pixels. Label defaults to just above the box.
const sharp = require('sharp');
const [input, output, ...specs] = process.argv.slice(2);
if (!input || !output || !specs.length) {
  console.error("usage: annotate-shot.js in.png out.png 'x,y,w,h[,label[,lx,ly]]' ...");
  process.exit(1);
}
const RED = '#E53935';
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

(async () => {
  const { width, height } = await sharp(input).metadata();
  const parts = specs.map((spec) => {
    const [x, y, w, h, label, lx, ly] = spec.split(',');
    const box = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="none" stroke="${RED}" stroke-width="4"/>`;
    if (!label) return box;
    const fs = 24;
    const pw = label.length * fs * 0.55 + 24; // rough text width, fine for short labels
    const px = lx ?? x;
    const py = ly ?? Math.max(0, +y - fs - 18);
    return `${box}<rect x="${px}" y="${py}" width="${pw}" height="${fs + 14}" rx="${(fs + 14) / 2}" fill="${RED}"/>` +
      // Centered in the pill, so a rough width estimate still looks right.
      `<text x="${+px + pw / 2}" y="${+py + (fs + 14) / 2}" text-anchor="middle" dominant-baseline="central" font-family="Helvetica, Arial, sans-serif" font-size="${fs}" font-weight="700" fill="#fff">${esc(label)}</text>`;
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${parts.join('')}</svg>`;
  await sharp(input).composite([{ input: Buffer.from(svg) }]).toFile(output);
  console.log(output);
})();
