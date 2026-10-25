// Cuts the duck's animation frames out of the four sprite sheets in assets/duck/source
// (sprites-walk.jpg, sprites-sit.jpg, sprites-wave.jpg; sprites-glasses.jpg isn't used yet).
// Each sheet is one row of six ducks on a light blue background, each standing on a blue shadow.
//
// For every frame it lifts the duck off the background with soft edges, and places it on a
// 600 x 600 see-through square so that all frames stand on the same spot: the middle of the
// shadow. Frames from different sheets are lined up by their first, standing duck. It also draws a
// blink (the standing duck with its eyes shut), and writes where the head is in every frame so the
// things the duck wears can follow it.
//
//   node scripts/duck-from-sheet/sprites.cjs   (run.mjs calls it)
const fs = require('fs');
const path = require('path');
const L = require('./lib.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'assets', 'duck', 'source');
const OUT = path.join(ROOT, 'assets', 'duck');

const SIZE = 600;
// The standing duck fills the square like the duck before it: feet at y 561, 461 tall, centred.
const STAND_BOTTOM = 561, STAND_HEIGHT = 461;

// Which frame of which sheet becomes which picture (frames counted from 1, left to right).
const FRAMES = [
  ['stand', 'walk', 1],
  // The walk sheet's second duck (a lunge, drawn smaller and tipped forward) jumps out of the loop, so
  // the walk uses the last four: foot up, step, other foot up, step.
  ['walk-1', 'walk', 3],
  ['walk-2', 'walk', 4],
  ['walk-3', 'walk', 5],
  ['walk-4', 'walk', 6],
  ['talk', 'wave', 6],
  ['wave', 'wave', 2],
  ['cheer', 'wave', 3],
  ['happy', 'wave', 4],
  ['sit', 'sit', 2],
  ['sleepy', 'sit', 3],
  ['content', 'sit', 4],
  ['dozing', 'sit', 5], // its faint Zz is cut away with the background; drawZzz() draws a clearer one
  ['asleep', 'sit', 6],
];

async function loadJpg(file) {
  // jimp-compact comes with Expo's own tools (@expo/image-utils), so there's nothing extra to install.
  const Jimp = require('jimp-compact');
  const img = await Jimp.read(file);
  const { width: w, height: h, data } = img.bitmap;
  return { w, h, rgb: (x, y) => { const o = (y * w + x) * 4; return [data[o], data[o + 1], data[o + 2]]; } };
}

const isDuckColour = ([r, g, b]) => r > 170 && r - b > 90; // yellow and orange, never the blue background
const isBackground = ([r, g, b]) => b > r + 8 || (r > 228 && g > 228 && b > 228);

/** The six ducks in a sheet, left to right: their outlines' boxes. */
function findDucks(img) {
  const y0 = Math.round(img.h * 0.28), y1 = Math.round(img.h * 0.75);
  const cols = new Int32Array(img.w);
  for (let x = 0; x < img.w; x++) for (let y = y0; y < y1; y += 2) if (isDuckColour(img.rgb(x, y))) cols[x]++;
  const runs = [];
  for (let x = 0; x < img.w; x++) {
    if (cols[x] < 3) continue;
    const last = runs[runs.length - 1];
    if (last && x - last[1] < 25) last[1] = x; else runs.push([x, x]);
  }
  const boxes = runs.filter(([a, b]) => b - a > 100).map(([a, b]) => {
    let top = img.h, bottom = 0;
    for (let y = y0; y < y1; y++) for (let x = a; x <= b; x += 2) if (isDuckColour(img.rgb(x, y))) { top = Math.min(top, y); bottom = Math.max(bottom, y); }
    return { x0: a, x1: b, y0: top, y1: bottom };
  });
  if (boxes.length !== 6) throw new Error(`expected 6 ducks in the sheet, found ${boxes.length}`);
  return boxes;
}

/**
 * Lifts one duck off the background. Returns an RGBA layer of the crop, plus the middle of its shadow.
 * Edge pixels get a see-through value from how far their colour sits between the background and the
 * duck's colour next to them, and take the duck's colour, so no blue fringe is left.
 */
function cutDuck(img, box) {
  const M = 36;
  const X0 = Math.max(0, box.x0 - M), Y0 = Math.max(0, box.y0 - M);
  const W = Math.min(img.w, box.x1 + M) - X0, H = Math.min(img.h, box.y1 + M) - Y0;
  const at = (x, y) => img.rgb(X0 + x, Y0 + y);
  const bg = L.background(img, X0, Y0, W, H, isBackground);

  // Distance (in steps) from the edge, inside and outside the duck.
  const dist = (fromBg) => {
    const d = new Int32Array(W * H).fill(1e9); const q = [];
    for (let i = 0; i < W * H; i++) if (!!bg[i] === fromBg) { d[i] = 0; q.push(i); }
    for (let h = 0; h < q.length; h++) { const i = q[h], x = i % W, y = (i / W) | 0;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) { if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const j = ny * W + nx; if (d[j] > d[i] + 1) { d[j] = d[i] + 1; q.push(j); } } }
    return d;
  };
  const dIn = dist(true), dOut = dist(false);
  // Nearest solid duck colour and nearest clean background colour, spread outwards from where they're sure.
  const spread = (isSource) => {
    const src = new Int32Array(W * H).fill(-1); const q = [];
    for (let i = 0; i < W * H; i++) if (isSource(i)) { src[i] = i; q.push(i); }
    for (let h = 0; h < q.length; h++) { const i = q[h], x = i % W, y = (i / W) | 0;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) { if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const j = ny * W + nx; if (src[j] < 0) { src[j] = src[i]; q.push(j); } } }
    return src;
  };
  const fgSrc = spread((i) => !bg[i] && dIn[i] >= 3);
  const bgSrc = spread((i) => bg[i] && dOut[i] >= 3);

  // The sheets are JPGs, so flat colours are grainy. Inside the duck, each pixel takes the average of
  // its neighbours of nearly the same colour: the grain goes (and the pictures get much smaller)
  // while the edges between colours stay sharp.
  const clean = new Map();
  const smooth = (i) => {
    if (clean.has(i)) return clean.get(i);
    const x = i % W, y = (i / W) | 0; const P = at(x, y); let r = 0, g = 0, b = 0, n = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H || bg[ny * W + nx] || dIn[ny * W + nx] < 2) continue;
      const q = at(nx, ny); if (Math.abs(q[0] - P[0]) + Math.abs(q[1] - P[1]) + Math.abs(q[2] - P[2]) > 30) continue;
      r += q[0]; g += q[1]; b += q[2]; n++;
    }
    const c = [Math.round(r / n), Math.round(g / n), Math.round(b / n)]; clean.set(i, c); return c;
  };

  const layer = L.layer(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; const P = at(x, y);
    if (!bg[i] && dIn[i] >= 3) { L.setPx(layer, x, y, smooth(i)); continue; }
    if (bg[i] && dOut[i] > 2) continue;
    const f = fgSrc[i], b = bgSrc[i];
    if (f < 0) continue;
    const F = smooth(f);
    if (b < 0) { if (!bg[i]) L.setPx(layer, x, y, F); continue; }
    const Bc = at(b % W, (b / W) | 0);
    const fb = [F[0] - Bc[0], F[1] - Bc[1], F[2] - Bc[2]];
    const len2 = fb[0] ** 2 + fb[1] ** 2 + fb[2] ** 2;
    let a = len2 < 300 ? (bg[i] ? 0 : 1) : ((P[0] - Bc[0]) * fb[0] + (P[1] - Bc[1]) * fb[1] + (P[2] - Bc[2]) * fb[2]) / len2;
    a = Math.max(0, Math.min(1, a));
    if (a < 0.06) continue;
    if (a > 0.94) a = 1;
    L.setPx(layer, x, y, F, Math.round(a * 255));
  }

  // The shadow: darker blue under the feet. Its middle is where the duck stands.
  let sx0 = 1e9, sx1 = -1, sy0 = 1e9, sy1 = -1;
  const bgRef = at(2, 2); const lum = ([r, g, b]) => 0.3 * r + 0.59 * g + 0.11 * b;
  for (let y = Math.round(H * 0.6); y < H; y++) for (let x = 0; x < W; x++) {
    if (!bg[y * W + x]) continue; const p = at(x, y);
    if (p[2] - p[0] > 30 && lum(p) < lum(bgRef) - 12) { sx0 = Math.min(sx0, x); sx1 = Math.max(sx1, x); sy0 = Math.min(sy0, y); sy1 = Math.max(sy1, y); }
  }
  // The duck's own outline box, in sheet pixels.
  let bx0 = 1e9, bx1 = -1, by0 = 1e9, by1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (layer.px[(y * W + x) * 4 + 3] > 128) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); }
  return {
    layer, X0, Y0,
    shadow: { cx: X0 + (sx0 + sx1) / 2, cy: Y0 + (sy0 + sy1) / 2, w: sx1 - sx0, h: sy1 - sy0 },
    box: { x0: X0 + bx0, x1: X0 + bx1, y0: Y0 + by0, y1: Y0 + by1 },
  };
}

const lum = ([r, g, b]) => 0.3 * r + 0.59 * g + 0.11 * b;
const pxAt = (F, x, y) => { const o = (y * F.w + x) * 4; return [F.px[o], F.px[o + 1], F.px[o + 2], F.px[o + 3]]; };

/** The head's rows in a frame: from the top of the tuft down through the face. */
function headRows(F) { const b = L.bounds(F, 128); return { ...b, y1: Math.round(b.y0 + (b.y1 - b.y0) * 0.42) }; }

/** The two eyes of the standing duck: the two biggest dark spots in its head. */
function findEyes(F) {
  const h = headRows(F); const seen = new Uint8Array(F.w * F.h); const spots = [];
  const dark = (x, y) => { const p = pxAt(F, x, y); return p[3] > 200 && lum(p) < 110; };
  for (let y = h.y0; y <= h.y1; y++) for (let x = h.x0; x <= h.x1; x++) {
    if (seen[y * F.w + x] || !dark(x, y)) continue;
    const q = [[x, y]]; seen[y * F.w + x] = 1; let n = 0, x0 = x, x1 = x, y0 = y, y1 = y;
    while (q.length) { const [cx, cy] = q.pop(); n++; x0 = Math.min(x0, cx); x1 = Math.max(x1, cx); y0 = Math.min(y0, cy); y1 = Math.max(y1, cy);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= F.w || ny >= F.h || seen[ny * F.w + nx] || !dark(nx, ny)) continue; seen[ny * F.w + nx] = 1; q.push([nx, ny]); } }
    spots.push({ n, cx: (x0 + x1 + 1) / 2, cy: (y0 + y1 + 1) / 2, rx: (x1 - x0 + 1) / 2, ry: (y1 - y0 + 1) / 2 });
  }
  const eyes = spots.sort((a, b) => b.n - a.n).slice(0, 2).sort((a, b) => a.cx - b.cx);
  if (eyes.length !== 2) throw new Error('could not find both eyes on the standing duck');
  let ink = [0, 0, 0], k = 0;
  for (const e of eyes) for (let y = Math.round(e.cy - e.ry / 2); y < e.cy + e.ry / 2; y++) for (let x = Math.round(e.cx - e.rx / 2); x < e.cx + e.rx / 2; x++) {
    const p = pxAt(F, x, y); if (lum(p) < 90) { ink = ink.map((v, i) => v + p[i]); k++; } }
  return { eyes, ink: ink.map((v) => Math.round(v / k)) };
}

/** A curved line with smooth edges: a quadratic curve from p0, pulled towards c, to p1. */
function stroke(F, p0, c, p1, width, colour) {
  const pts = []; for (let i = 0; i <= 48; i++) { const t = i / 48, u = 1 - t; pts.push([u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]]); }
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  for (let y = Math.floor(Math.min(...ys) - width); y <= Math.max(...ys) + width; y++) for (let x = Math.floor(Math.min(...xs) - width); x <= Math.max(...xs) + width; x++) {
    let d = Infinity;
    for (let i = 0; i < pts.length - 1; i++) { const [ax, ay] = pts[i], [bx, by] = pts[i + 1]; const vx = bx - ax, vy = by - ay; const t = Math.max(0, Math.min(1, ((x + 0.5 - ax) * vx + (y + 0.5 - ay) * vy) / (vx * vx + vy * vy))); d = Math.min(d, Math.hypot(x + 0.5 - ax - t * vx, y + 0.5 - ay - t * vy)); }
    const cover = Math.max(0, Math.min(1, width / 2 + 0.5 - d)); if (!cover) continue;
    const o = (y * F.w + x) * 4; for (let ch = 0; ch < 3; ch++) F.px[o + ch] = Math.round(F.px[o + ch] * (1 - cover) + colour[ch] * cover);
  }
}

/**
 * Three z's rising from the dozing duck's head, each bigger and lighter than the last. A mid blue
 * that shows on the day pond and on the night screen alike.
 */
function drawZzz(F) {
  const box = L.bounds(F, 128); // the duck; the z's start just above and right of its head
  const ink = [104, 118, 190];
  const zs = [
    { x: box.x1 - 6, y: box.y0 + 30, h: 26, a: 1 },
    { x: box.x1 + 26, y: box.y0 - 14, h: 36, a: 0.85 },
    { x: box.x1 + 66, y: box.y0 - 70, h: 48, a: 0.7 },
  ];
  for (const z of zs) {
    const w = z.h * 0.86, half = z.h * 0.13; // a bold, rounded z like the sheet's
    // Top bar, diagonal, bottom bar, tilted back a little.
    const tilt = (-8 * Math.PI) / 180, c = Math.cos(tilt), s = Math.sin(tilt);
    const pt = (u, v) => [z.x + (u - w / 2) * c - (v - z.h / 2) * s, z.y + (u - w / 2) * s + (v - z.h / 2) * c];
    const pts = [pt(0, 0), pt(w, 0), pt(0, z.h), pt(w, z.h)];
    for (let y = Math.floor(z.y - z.h); y <= z.y + z.h; y++) for (let x = Math.floor(z.x - z.h); x <= z.x + z.h; x++) {
      if (x < 0 || y < 0 || x >= F.w || y >= F.h) continue;
      let d = Infinity;
      for (let i = 0; i < 3; i++) { const [ax, ay] = pts[i], [bx, by] = pts[i + 1]; const vx = bx - ax, vy = by - ay; const t = Math.max(0, Math.min(1, ((x + 0.5 - ax) * vx + (y + 0.5 - ay) * vy) / (vx * vx + vy * vy))); d = Math.min(d, Math.hypot(x + 0.5 - ax - t * vx, y + 0.5 - ay - t * vy)); }
      const cover = Math.max(0, Math.min(1, half + 0.5 - d)) * z.a; if (!cover) continue;
      const o = (y * F.w + x) * 4; const a0 = F.px[o + 3] / 255; const a = cover + a0 * (1 - cover);
      for (let ch = 0; ch < 3; ch++) F.px[o + ch] = Math.round((ink[ch] * cover + F.px[o + ch] * a0 * (1 - cover)) / a);
      F.px[o + 3] = Math.round(a * 255);
    }
  }
}

/** The standing duck with its eyes shut, drawn like the sleeping duck's eyes. */
function makeBlink(stand) {
  const F = { w: stand.w, h: stand.h, px: Buffer.from(stand.px) };
  const { eyes, ink } = findEyes(stand);
  for (const e of eyes) {
    // Face colour from the yellow just around the eye (not the cheek or the beak).
    let sum = [0, 0, 0], n = 0;
    for (let t = 0; t < 360; t += 6) { const a = (t * Math.PI) / 180; const x = Math.round(e.cx + Math.cos(a) * (e.rx + 6)), y = Math.round(e.cy + Math.sin(a) * (e.ry + 6));
      const p = pxAt(stand, x, y); if (p[0] > 225 && p[1] > 175 && p[2] < 120) { sum = sum.map((v, i) => v + p[i]); n++; } }
    const face = sum.map((v) => Math.round(v / n));
    const gx = e.rx + 3, gy = e.ry + 3;
    for (let y = Math.floor(e.cy - gy - 2); y <= e.cy + gy + 2; y++) for (let x = Math.floor(e.cx - gx - 2); x <= e.cx + gx + 2; x++) {
      const r = Math.hypot((x + 0.5 - e.cx) / gx, (y + 0.5 - e.cy) / gy); const cover = Math.max(0, Math.min(1, (1 - r) * Math.min(gx, gy) + 0.5)); if (!cover) continue;
      const o = (y * F.w + x) * 4; for (let ch = 0; ch < 3; ch++) F.px[o + ch] = Math.round(F.px[o + ch] * (1 - cover) + face[ch] * cover);
    }
    const w = e.rx * 1.15;
    stroke(F, [e.cx - w, e.cy + e.ry * 0.1], [e.cx, e.cy + e.ry * 1.05], [e.cx + w, e.cy + e.ry * 0.1], Math.max(4, e.rx * 0.42), ink);
  }
  return { F, eyes, ink };
}

/**
 * How far the head has moved in a frame compared with the standing duck, found by matching its
 * picture. With `sizes`, also how much bigger the head was drawn (1 = the same size).
 */
function headOffset(ref, F, sizes = [1]) {
  const h = headRows(ref); const pts = []; const hx = (h.x0 + h.x1) / 2, hy = (h.y0 + h.y1) / 2;
  // Points on the head, and points just outside its edge that should stay see-through: together
  // they catch a head drawn bigger as well as one drawn smaller.
  const nearHead = (x, y) => { for (let d = -10; d <= 10; d += 5) for (const [ax, ay] of [[x + d, y], [x, y + d]]) if (pxAt(ref, ax, ay)[3] > 230) return true; return false; };
  for (let y = h.y0 - 12; y <= h.y1; y += 3) for (let x = h.x0 - 12; x <= h.x1 + 12; x += 3) {
    const p = pxAt(ref, x, y); if (p[3] > 230) pts.push([x, y, p]); else if (p[3] < 20 && y > h.y0 - 12 && nearHead(x, y)) pts.push([x, y, null]); }
  const cost = (s, dx, dy) => { let c = 0; for (const [x, y, p] of pts) { const nx = Math.round(hx + (x - hx) * s + dx), ny = Math.round(hy + (y - hy) * s + dy); if (nx < 0 || ny < 0 || nx >= F.w || ny >= F.h) { c += p ? 255 : 0; continue; }
    const q = pxAt(F, nx, ny); if (!p) { c += q[3] > 128 ? 255 : 0; continue; } c += q[3] < 128 ? 255 : (Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2])) / 3; } return c / pts.length; };
  let best = [1, 0, 0], bestC = Infinity;
  for (const s of sizes) for (let dy = -60; dy <= 120; dy += 3) for (let dx = -90; dx <= 90; dx += 3) { const c = cost(s, dx, dy); if (c < bestC) { bestC = c; best = [s, dx, dy]; } }
  const [bs, bx, by] = best;
  for (let dy = by - 3; dy <= by + 3; dy++) for (let dx = bx - 3; dx <= bx + 3; dx++) { const c = cost(bs, dx, dy); if (c < bestC) { bestC = c; best = [bs, dx, dy]; } }
  return { size: best[0], dx: best[1], dy: best[2], fit: +bestC.toFixed(1) };
}

/** The middle of the beak on the standing duck. */
function beakMiddle(F) {
  const h = headRows(F); let x0 = F.w, x1 = -1;
  for (let y = h.y0; y <= h.y1; y++) for (let x = h.x0; x <= h.x1; x++) { const [r, g, b, a] = pxAt(F, x, y); if (a > 200 && r > 225 && g > 110 && g < 185 && b < 100) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); } }
  return (x0 + x1 + 1) / 2;
}

/**
 * How a sheet's pixels map onto the 600 square. Every frame stands on the middle of its shadow;
 * the standing duck (`st`, cut from the walk sheet) sets the size and the spot.
 */
function placement(st) {
  const scale = STAND_HEIGHT / (st.box.y1 - st.box.y0 + 1);
  const ground = (c) => c.shadow.cy + c.shadow.h / 2; // the shadow's bottom edge: the same line in every frame
  const GX = SIZE / 2 - ((st.box.x0 + st.box.x1 + 1) / 2 - st.shadow.cx) * scale;
  const GY = STAND_BOTTOM - (st.box.y1 + 1 - ground(st)) * scale;
  /** A cut duck (or any layer with X0, Y0 and its frame's shadow) on the square, `k` times its sheet size. */
  const put = (c, k = scale) => ({ w: SIZE, h: SIZE, px: L.place(c.layer, SIZE, k, (c.X0 - c.shadow.cx) * k + GX, (c.Y0 - ground(c)) * k + GY) });
  return { scale, GX, GY, put };
}

async function main() {
  const sheets = {}; const cuts = {};
  for (const [name, sheet, n] of FRAMES) {
    if (!sheets[sheet]) { const img = await loadJpg(path.join(SRC, `sprites-${sheet}.jpg`)); sheets[sheet] = { img, boxes: findDucks(img) }; }
    cuts[name] = cutDuck(sheets[sheet].img, sheets[sheet].boxes[n - 1]);
  }
  const { scale, GX, GY, put } = placement(cuts.stand);
  const frames = {}; const resized = {};
  for (const [name] of FRAMES) frames[name] = put(cuts[name], scale);
  // The image AI drew a few frames a little bigger or smaller. Those are resized around the feet so
  // the duck keeps one size when the frames change.
  const sizes = []; for (let s = 0.86; s <= 1.141; s += 0.02) sizes.push(+s.toFixed(2));
  for (const [name] of FRAMES) {
    if (name === 'stand') continue;
    const { size } = headOffset(frames.stand, frames[name], sizes);
    if (Math.abs(size - 1) > 0.025) { frames[name] = put(cuts[name], scale / size); resized[name] = size; }
  }
  if (Object.keys(resized).length) console.log('resized (drawn this much bigger):', JSON.stringify(resized));
  drawZzz(frames.dozing);
  const blink = makeBlink(frames.stand);
  frames.blink = blink.F;

  const names = [...FRAMES.map(([n]) => n), 'blink'];
  const heads = {};
  for (const n of names) heads[n] = n === 'stand' || n === 'blink' ? { dx: 0, dy: 0, fit: 0 } : headOffset(frames.stand, frames[n]);
  const beak = beakMiddle(frames.stand);

  for (const n of names) {
    const file = path.join(OUT, `${n}.png`);
    fs.writeFileSync(file, L.encodeIndexed(SIZE, SIZE, frames[n].px));
    // The 256-colour file must look like the full-colour picture: check it, pixel by pixel.
    const back = L.decodeRGBA(file).px, src = frames[n].px; let err = 0, count = 0;
    for (let i = 0; i < src.length; i += 4) { const a = src[i + 3], b = back[i + 3]; if (!a && !b) continue; let e = Math.abs(a - b); for (let c = 0; c < 3; c++) e += Math.abs((src[i + c] * a - back[i + c] * b) / 255); err += e; count++; }
    if (err / count > 4) throw new Error(`${n}.png lost too much colour in the 256-colour file (average ${(err / count).toFixed(1)})`);
  }
  const r4 = (v) => +v.toFixed(4);
  const key = (n) => (/^[a-z]+$/.test(n) ? n : `'${n}'`);
  const ts = [
    '// Made by scripts/duck-from-sheet/sprites.cjs from the sprite sheets in assets/duck/source.',
    '// Run `npm run duck:from-sheet` to remake it, rather than editing it by hand.',
    '',
    "/** Where the head is in each frame compared with the standing duck, as a share of the picture's size. The things the duck wears follow it. */",
    'export const headOffset = {',
    ...names.map((n) => `  ${key(n)}: [${r4(heads[n].dx / SIZE)}, ${r4(heads[n].dy / SIZE)}],`),
    '} as const;',
    '',
    "/** The middle of the standing duck's beak, as a share of the picture's width to the right of its centre. The speech bubble's tail points at it. */",
    `export const BEAK_FROM_CENTRE = ${r4((beak - SIZE / 2) / SIZE)};`,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(ROOT, 'src', 'components', 'duck', 'layout.ts'), ts);

  console.log(`scale ${scale.toFixed(4)}, ground at (${GX.toFixed(1)}, ${GY.toFixed(1)}) on the ${SIZE} square`);
  console.log('eyes', JSON.stringify(blink.eyes.map((e) => [e.cx, e.cy, e.rx, e.ry])), 'ink', blink.ink, 'beak middle x', beak);
  for (const n of names) console.log(n.padEnd(8), 'head', heads[n].dx, heads[n].dy, 'fit', heads[n].fit, 'box', JSON.stringify(L.bounds(frames[n], 128)));
  return { names, heads };
}

module.exports = { FRAMES, SIZE, main, loadJpg, findDucks, cutDuck, placement };
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

