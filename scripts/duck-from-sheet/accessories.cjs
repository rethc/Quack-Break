// Lifts the beanie, bow, scarf and glasses off the accessories sheet: tile icons (256 x 256) and,
// except for the glasses, the same pictures placed on the standing duck (600 x 600, lined up with
// stand.png). In the app they follow the head from frame to frame (src/components/duck/layout.ts).
// The glasses the duck wears come from its own sprite sheet (glasses.cjs).
//   node scripts/duck-from-sheet/accessories.cjs   (run.mjs calls it)
const fs = require('fs');
const path = require('path');
const L = require('./lib.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'assets', 'duck');
const img = L.decode(path.join(OUT, 'source', 'accessories-sheet.png'));
const TILE = [226, 241, 244];
const isTileBg = ([r, g, b]) => Math.abs(r - TILE[0]) + Math.abs(g - TILE[1]) + Math.abs(b - TILE[2]) <= 10;
/** One item off the sheet, trimmed to its own outline. */
function cut([x0, y0, x1, y1]) {
  const W = x1 - x0, H = y1 - y0; const bg = L.erode(L.background(img, x0, y0, W, H, isTileBg), W, H);
  const Lr = L.layer(W, H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!bg[y * W + x]) L.setPx(Lr, x, y, img.rgb(x0 + x, y0 + y));
  // Only the item itself: little sparkles drawn around it are dropped.
  keepLargest(Lr);
  const b = L.bounds(Lr, 0); const T = L.layer(b.x1 - b.x0 + 1, b.y1 - b.y0 + 1);
  for (let y = 0; y < T.h; y++) Lr.px.copy(T.px, y * T.w * 4, ((b.y0 + y) * W + b.x0) * 4, ((b.y0 + y) * W + b.x1 + 1) * 4);
  return T;
}
/** Keeps the biggest connected shape in a layer (and anything a tenth of its size or more). */
function keepLargest(Lr) {
  const seen = new Int32Array(Lr.w * Lr.h).fill(-1); const sizes = [];
  for (let i = 0; i < Lr.w * Lr.h; i++) {
    if (seen[i] >= 0 || !Lr.px[i * 4 + 3]) continue;
    const id = sizes.length; let n = 0; const q = [i]; seen[i] = id;
    while (q.length) { const j = q.pop(); n++; const x = j % Lr.w, y = (j / Lr.w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= Lr.w || Y >= Lr.h) continue; const k = Y * Lr.w + X; if (seen[k] < 0 && Lr.px[k * 4 + 3]) { seen[k] = id; q.push(k); } } }
    sizes.push(n);
  }
  const big = Math.max(0, ...sizes);
  for (let i = 0; i < Lr.w * Lr.h; i++) if (seen[i] >= 0 && sizes[seen[i]] < big / 10) Lr.px[i * 4 + 3] = 0;
}

// Sheet crops, and where each sits on the standing duck (stand.png, 600 x 600): its middle, its width,
// and its top, middle or bottom edge. The head is a circle about 208 across, centred at (328, 232);
// the eyes' tops are at y 205, and the neck is at y 290.
const items = {
  beanie: { crop: [133, 484, 305, 652], on: { cx: 327, bottom: 207, width: 210 } },
  bow: { crop: [441, 534, 583, 614], on: { cx: 372, cy: 142, width: 96 } },
  scarf: { crop: [714, 496, 898, 662], on: { cx: 330, top: 276, width: 196 } },
  glasses: { crop: [104, 214, 334, 346] }, // icon only
};
for (const [name, it] of Object.entries(items)) {
  const Lr = cut(it.crop);
  // Tile icon: centred, 84% of the square.
  const iconScale = Math.min((256 * 0.84) / Lr.w, (256 * 0.84) / Lr.h);
  fs.writeFileSync(path.join(OUT, `icon-${name}.png`), L.encodeIndexed(256, 256, L.place(Lr, 256, iconScale, (256 - Lr.w * iconScale) / 2, (256 - Lr.h * iconScale) / 2)));
  // On the duck.
  const d = it.on; if (!d) continue; const k = d.width / Lr.w; const h = Lr.h * k;
  const top = d.bottom !== undefined ? d.bottom - h : d.top !== undefined ? d.top : d.cy - h / 2;
  fs.writeFileSync(path.join(OUT, `${name}.png`), L.encodeIndexed(600, 600, L.place(Lr, 600, k, d.cx - d.width / 2, top)));
  console.log(`${name}: ${d.width} x ${h.toFixed(0)}, top at ${top.toFixed(0)}`);
}
