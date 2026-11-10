# Stitch scrolled phone frames into one long shot. Each seam is cut on a quiet row where both frames agree,
# so it never slices a button or a text line. Usage: stitch.py <out.png> <frame.png>...
# Run with: uv run -q --with pillow --with numpy python stitch.py ...
import sys, numpy as np
from PIL import Image

out, files = sys.argv[1], sys.argv[2:]
im = [Image.open(f).convert('RGB') for f in files]
a = [np.asarray(i).astype(np.int16) for i in im]
W, H = im[0].size
# Scroll area: below the status bar, above the tab bar. ponytail: fixed fractions of an iPhone frame
TOP, BOT = int(H * 0.08), int(H * 0.887)
ranges, start = [], 0
for k in range(1, len(a)):
    prev, cur = a[k - 1], a[k]
    s = min(range(20, BOT - TOP - 40), key=lambda s: np.abs(prev[TOP + s:BOT] - cur[TOP:BOT - s]).mean())
    rows = np.arange(TOP + s + 10, BOT - 10)
    diff = np.abs(prev[rows] - cur[rows - s]).mean(axis=(1, 2))
    flat = prev[rows].std(axis=(1, 2))
    cut = rows[np.argmin(diff + flat)]
    ranges.append((k - 1, start, cut))
    start = cut - s
ranges.append((len(a) - 1, start, H))
res = Image.new('RGB', (W, sum(y1 - y0 for _, y0, y1 in ranges)))
y = 0
for f, y0, y1 in ranges:
    res.paste(im[f].crop((0, y0, W, y1)), (0, y))
    y += y1 - y0
res.save(out)
print(f'{res.size[0]}x{res.size[1]}')
