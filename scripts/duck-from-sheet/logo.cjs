// Makes the app icons and the opening-screen picture from the logo (assets/duck/source/logo.jpg):
// the duck in blue-light glasses on a blue tile.
//
// The logo's rounded tile and its border are dropped (phones and the store cut their own shape), and
// the tile's blue gradient is rebuilt cleanly, full bleed. The duck is lifted off it with soft
// edges; the see-through part of the lens counts as background. Its shadow is redrawn as a soft oval.
//   node scripts/duck-from-sheet/logo.cjs   (run.mjs calls it)
const fs = require('fs');
const path = require('path');
const L = require('./lib.cjs');
const { loadJpg } = require('./sprites.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'assets');
const lum = ([r, g, b]) => 0.3 * r + 0.59 * g + 0.11 * b;
const diff = (p, q) => Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]);

// Where things are on the 2048 logo (found by sampling it).
const TILE = { top: 205, bottom: 1790 }; // the tile's inside, top to bottom
const AREA = { x0: 440, y0: 330, x1: 1620, y1: 1765 }; // around the duck and its shadow
const SHADOW_FROM = 1520; // below here, blue that isn't background is the shadow

(async () => {
  const img = await loadJpg(path.join(ROOT, 'assets', 'duck', 'source', 'logo.jpg'));

  // The background: a top-to-bottom gradient. Sampled where the tile is empty, then smoothed into a
  // curve per colour channel (least squares), so it has no JPEG grain.
  const samples = [];
  const take = (y, xs) => { for (const [a, b] of xs) for (let x = a; x <= b; x += 4) samples.push([y, img.rgb(x, y)]); };
  for (let y = 230; y <= 370; y += 4) take(y, [[500, 800], [1150, 1500]]);
  for (let y = 480; y <= 1740; y += 4) take(y, [[300, 440], [1660, 1740]]);
  const t = (y) => (y - 1000) / 1000;
  const fit = (ch) => {
    // Normal equations for a + b t + c t².
    const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], R = [0, 0, 0];
    for (const [y, p] of samples) { const v = [1, t(y), t(y) ** 2]; for (let i = 0; i < 3; i++) { R[i] += v[i] * p[ch]; for (let j = 0; j < 3; j++) S[i][j] += v[i] * v[j]; } }
    // Solve 3 x 3 (Cramer's rule).
    const det = (M) => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
    const D = det(S); return [0, 1, 2].map((k) => det(S.map((row, i) => row.map((v, j) => (j === k ? R[i] : v)))) / D);
  };
  const coef = [fit(0), fit(1), fit(2)];
  const bgAt = (y) => { const u = t(Math.max(TILE.top, Math.min(TILE.bottom, y))); return coef.map(([a, b, c]) => a + b * u + c * u * u); };

  // Duck or background. Anything close to the gradient is background, even inside the lens.
  const W = AREA.x1 - AREA.x0 + 1, H = AREA.y1 - AREA.y0 + 1;
  const at = (x, y) => img.rgb(AREA.x0 + x, AREA.y0 + y);
  const bg = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (diff(at(x, y), bgAt(AREA.y0 + y)) < 30) bg[y * W + x] = 1;
  // Close the shadow off: blue below the body is shadow, which is drawn separately.
  const shadowPx = [];
  for (let y = SHADOW_FROM - AREA.y0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = at(x, y); if (bg[y * W + x] || p[2] - p[0] < 35) continue;
    bg[y * W + x] = 1; shadowPx.push([x, y, p]);
  }
  // The logo outlines the duck in a thin light blue, which would show as a blue edge on any other
  // background: light blue reachable from outside counts as background too. (The eyes' shine is
  // light blue as well, but it's enclosed, so it stays.)
  {
    const lightBlue = (p) => p[2] - p[0] > 40 && lum(p) > 150;
    const q = [];
    for (let x = 0; x < W; x++) q.push(x, (H - 1) * W + x); for (let y = 0; y < H; y++) q.push(y * W, y * W + W - 1);
    const seen = new Uint8Array(W * H);
    while (q.length) { const i = q.pop(); if (seen[i]) continue; seen[i] = 1; const x = i % W, y = (i / W) | 0;
      if (!bg[i] && !lightBlue(at(x, y))) continue; bg[i] = 1;
      for (const [X, Y] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) if (X >= 0 && Y >= 0 && X < W && Y < H && !seen[Y * W + X]) q.push(Y * W + X); }
  }
  // Tiny specks left in the background (JPEG noise) go too: keep the big shapes only.
  {
    const seen = new Int32Array(W * H).fill(-1); const sizes = [];
    for (let i = 0; i < W * H; i++) { if (bg[i] || seen[i] >= 0) continue; const id = sizes.length; let n = 0; const q = [i]; seen[i] = id;
      while (q.length) { const j = q.pop(); n++; const x = j % W, y = (j / W) | 0; for (const [X, Y] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) { if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const k = Y * W + X; if (!bg[k] && seen[k] < 0) { seen[k] = id; q.push(k); } } }
      sizes.push(n); }
    for (let i = 0; i < W * H; i++) if (!bg[i] && sizes[seen[i]] < 40) bg[i] = 1;
  }

  // Soft edges, as for the sprite frames: how far each edge pixel sits between the duck's colour
  // and the background's, and the duck's colour without the blue fringe.
  const dist = (fromBg) => {
    const d = new Int32Array(W * H).fill(1e9); const q = [];
    for (let i = 0; i < W * H; i++) if (!!bg[i] === fromBg) { d[i] = 0; q.push(i); }
    for (let h = 0; h < q.length; h++) { const i = q[h], x = i % W, y = (i / W) | 0;
      for (const [X, Y] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) { if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const j = Y * W + X; if (d[j] > d[i] + 1) { d[j] = d[i] + 1; q.push(j); } } }
    return d;
  };
  const dIn = dist(true), dOut = dist(false);
  const spread = (isSource) => {
    const src = new Int32Array(W * H).fill(-1); const q = [];
    for (let i = 0; i < W * H; i++) if (isSource(i)) { src[i] = i; q.push(i); }
    for (let h = 0; h < q.length; h++) { const i = q[h], x = i % W, y = (i / W) | 0;
      for (const [X, Y] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) { if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const j = Y * W + X; if (src[j] < 0) { src[j] = src[i]; q.push(j); } } }
    return src;
  };
  const fgSrc = spread((i) => !bg[i] && dIn[i] >= 3);
  const bgSrc = spread((i) => bg[i] && dOut[i] >= 3);
  const clean = new Map();
  const smooth = (i) => {
    if (clean.has(i)) return clean.get(i);
    const x = i % W, y = (i / W) | 0; const P = at(x, y); let r = 0, g = 0, b = 0, n = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H || bg[Y * W + X] || dIn[Y * W + X] < 2) continue;
      const q = at(X, Y); if (diff(q, P) > 30) continue; r += q[0]; g += q[1]; b += q[2]; n++; }
    const c = n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : P; clean.set(i, c); return c;
  };
  const duck = L.layer(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; const P = at(x, y);
    if (!bg[i] && dIn[i] >= 3) { L.setPx(duck, x, y, smooth(i)); continue; }
    if (bg[i] && dOut[i] > 2) continue;
    const f = fgSrc[i], b = bgSrc[i]; if (f < 0) continue;
    const F = smooth(f); const B = b >= 0 ? at(b % W, (b / W) | 0) : bgAt(AREA.y0 + y);
    const fb = [F[0] - B[0], F[1] - B[1], F[2] - B[2]]; const len2 = fb[0] ** 2 + fb[1] ** 2 + fb[2] ** 2;
    let a = len2 < 300 ? (bg[i] ? 0 : 1) : ((P[0] - B[0]) * fb[0] + (P[1] - B[1]) * fb[1] + (P[2] - B[2]) * fb[2]) / len2;
    a = Math.max(0, Math.min(1, a)); if (a < 0.06) continue; if (a > 0.94) a = 1;
    L.setPx(duck, x, y, F, Math.round(a * 255));
  }

  // Where a lens hangs past the head, the logo shows its blue background through the glass, which
  // breaks into specks once lifted. That part is drawn as clean glass instead: faintly white, with
  // the glare a little stronger. (The eyes and their shine are left alone.)
  {
    const isRim = (p) => p[2] - p[0] > 40 && lum(p) < 110;
    // The beak is drawn in front of the far lens's rim, so it closes that ring.
    const isBeak = (p) => p[0] > 215 && p[1] > 120 && p[1] < 190 && p[2] < 130;
    const outside = new Uint8Array(W * H); const q = [];
    for (let x = 0; x < W; x++) q.push(x, (H - 1) * W + x); for (let y = 0; y < H; y++) q.push(y * W, y * W + W - 1);
    while (q.length) { const i = q.pop(); if (outside[i]) continue; const x = i % W, y = (i / W) | 0; if (isRim(at(x, y)) || isBeak(at(x, y))) continue; outside[i] = 1;
      for (const [X, Y] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) if (X >= 0 && Y >= 0 && X < W && Y < H && !outside[Y * W + X]) q.push(Y * W + X); }
    // The eyes: solid round blobs of their purple-blue (the rim's soft inner edge has the same colour,
    // but as a thin ring, so blobs that don't fill their box are left out).
    const eyeInk = (i) => { const p = at(i % W, (i / W) | 0); return !outside[i] && p[2] - p[0] > 40 && lum(p) >= 100 && lum(p) < 160; };
    const eye = new Uint8Array(W * H); const seenE = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) {
      if (seenE[i] || !eyeInk(i)) continue;
      const blob = []; const st = [i]; seenE[i] = 1; let bx0 = W, by0 = H, bx1 = 0, by1 = 0;
      while (st.length) { const j = st.pop(); blob.push(j); const x = j % W, y = (j / W) | 0; bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y);
        for (const [X, Y] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) { const k = Y * W + X; if (X >= 0 && Y >= 0 && X < W && Y < H && !seenE[k] && eyeInk(k)) { seenE[k] = 1; st.push(k); } } }
      const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1; // eyes are round: the far arm seen through the lens is long and thin
      if (blob.length < 800 || blob.length / (bw * bh) < 0.45 || bw / bh > 1.6 || bh / bw > 1.6) continue;
      for (const j of blob) { const x = j % W, y = (j / W) | 0; for (let dy = -9; dy <= 9; dy++) for (let dx = -9; dx <= 9; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < W && Y < H) eye[Y * W + X] = 1; } }
    }
    let glass = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (outside[i] || eye[i] || isRim(at(x, y)) || isBeak(at(x, y))) continue;
      const p = at(x, y); const o = i * 4;
      const overBackground = bg[i] || (p[2] - p[0] > 40 && lum(p) > 120);
      // Over the head the lens stays as drawn. Over the background it becomes see-through glass:
      // faint white, stronger white for the glare, and the far arm seen through it in soft navy.
      if (!overBackground) continue;
      const [c, a] = lum(p) > 205 ? [[255, 255, 255], 0.4] : lum(p) < 170 && !bg[i] ? [[50, 69, 137], 0.6] : [[255, 255, 255], 0.14];
      duck.px[o] = c[0]; duck.px[o + 1] = c[1]; duck.px[o + 2] = c[2]; duck.px[o + 3] = Math.round(a * 255); glass++;
    }
    console.log(`  glass drawn over ${glass} pixels`);
  }

  // The shadow, redrawn: an oval as wide and tall as the logo's, as dark as its middle.
  let sx0 = 1e9, sx1 = -1, sy0 = 1e9, sy1 = -1; const darks = [];
  for (const [x, y, p] of shadowPx) { sx0 = Math.min(sx0, x); sx1 = Math.max(sx1, x); sy0 = Math.min(sy0, y); sy1 = Math.max(sy1, y); darks.push(lum(bgAt(AREA.y0 + y)) - lum(p)); }
  darks.sort((a, b) => a - b); const depth = darks[Math.floor(darks.length * 0.5)];
  const shadowInk = [40, 120, 190]; const shadowAlpha = Math.min(0.6, depth / (lum(bgAt(AREA.y0 + sy1)) - lum(shadowInk)));
  const shadow = L.layer(W, H);
  const ecx = (sx0 + sx1) / 2, ecy = (sy0 + sy1) / 2, erx = (sx1 - sx0) / 2, ery = (sy1 - sy0) / 2;
  for (let y = Math.floor(ecy - ery - 3); y <= ecy + ery + 3; y++) for (let x = Math.floor(ecx - erx - 3); x <= ecx + erx + 3; x++) {
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const r = Math.hypot((x + 0.5 - ecx) / erx, (y + 0.5 - ecy) / ery); const edge = Math.max(0, Math.min(1, (1 - r) * Math.min(erx, ery) / 2 + 0.5));
    if (edge > 0) L.setPx(shadow, x, y, shadowInk, Math.round(edge * shadowAlpha * 255));
  }
  const withShadow = L.over({ w: W, h: H, px: Buffer.from(shadow.px) }, duck);

  // --- the pictures ---
  /** A layer scaled so its visible part is `height` tall, its middle at (cx, cy) on a size x size square. */
  const placed = (layer, size, height, cx, cy) => {
    const b = L.bounds(layer, 20); const k = height / (b.y1 - b.y0 + 1);
    return L.place(layer, size, k, cx - ((b.x0 + b.x1 + 1) / 2) * k, cy - ((b.y0 + b.y1 + 1) / 2) * k);
  };
  /** The gradient on a size x size square, with the tile's top at y `from` and its bottom at `to`. */
  const gradient = (size, from, to) => {
    const px = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y++) { const c = bgAt(TILE.top + ((y + 0.5 - from) / (to - from)) * (TILE.bottom - TILE.top)).map((v) => Math.round(Math.max(0, Math.min(255, v))));
      for (let x = 0; x < size; x++) { const o = (y * size + x) * 4; px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255; } }
    return { w: size, h: size, px };
  };
  const write = (name, size, rgba) => { fs.writeFileSync(path.join(OUT, name), L.encode(size, size, rgba)); console.log(`wrote assets/${name}`); };
  /** How far the duck reaches from the middle of the square, to check it stays in Android's safe circle. */
  const reach = (px, size) => { let m = 0; for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (px[(y * size + x) * 4 + 3] > 25) m = Math.max(m, Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2)); return m; };

  // App icon and store icon: the gradient full bleed, the duck about three-quarters of the height.
  const icon = L.over(gradient(1024, 0, 1024), { w: 1024, h: 1024, px: placed(withShadow, 1024, 770, 512, 530) });
  write('icon.png', 1024, icon.px);

  // Android: the background layer is the gradient, filling the part that shows (the middle 72 of 108 dp);
  // the duck stays inside the 66 dp circle no launcher shape ever cuts.
  write('android-icon-background.png', 1024, gradient(1024, 171, 853).px);
  let fgHeight = 560, fg;
  for (;;) { fg = placed(withShadow, 1024, fgHeight, 512, 520); if (reach(fg, 1024) <= 306) break; fgHeight -= 10; }
  write('android-icon-foreground.png', 1024, fg);
  console.log(`  foreground duck ${fgHeight} tall, reaches ${reach(fg, 1024).toFixed(0)} of 312 from the middle`);

  // One-colour versions (themed icon, status bar): the duck's shape with its eyes and the glasses'
  // rims cut out, so the glasses still read. Rims at the edge of the shape (the far lens, the arm)
  // stay solid. `grow` widens the cut-outs for the tiny status-bar icon.
  const shape = (rgb, grow = 0) => {
    const s = { w: W, h: H, px: Buffer.from(duck.px) };
    const inked = (x, y) => { const o = (y * W + x) * 4; const p = [duck.px[o], duck.px[o + 1], duck.px[o + 2]]; return duck.px[o + 3] > 128 && p[2] - p[0] > 40 && lum(p) < 150; };
    const nearEmpty = (x, y, r) => { for (let dy = -r; dy <= r; dy += 3) for (let dx = -r; dx <= r; dx += 3) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H || duck.px[(Y * W + X) * 4 + 3] < 40) return true; } return false; };
    const hole = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inked(x, y) && !nearEmpty(x, y, 14)) hole[y * W + x] = 1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4; s.px[o] = rgb[0]; s.px[o + 1] = rgb[1]; s.px[o + 2] = rgb[2];
      let cut = hole[y * W + x];
      if (!cut && grow) for (let dy = -grow; dy <= grow && !cut; dy += 2) for (let dx = -grow; dx <= grow && !cut; dx += 2) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < W && Y < H && hole[Y * W + X]) cut = 1; }
      // The lenses' white glare would leave specks; it's see-through glass anyway.
      if (cut || lum([duck.px[o], duck.px[o + 1], duck.px[o + 2]]) > 225) s.px[o + 3] = 0;
    }
    // Specks still on their own are cleared.
    const seen = new Int32Array(W * H).fill(-1); const sizes = [];
    for (let i = 0; i < W * H; i++) { if (s.px[i * 4 + 3] < 40 || seen[i] >= 0) continue; const id = sizes.length; let n = 0; const q = [i]; seen[i] = id;
      while (q.length) { const j = q.pop(); n++; const x = j % W, y = (j / W) | 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const k = Y * W + X; if (seen[k] < 0 && s.px[k * 4 + 3] >= 40) { seen[k] = id; q.push(k); } } }
      sizes.push(n); }
    const big = Math.max(...sizes);
    for (let i = 0; i < W * H; i++) if (seen[i] >= 0 && sizes[seen[i]] < big / 200) s.px[i * 4 + 3] = 0;
    return s;
  };
  write('android-icon-monochrome.png', 1024, placed(shape([0, 0, 0]), 1024, fgHeight * 0.92, 512, 512));
  write('notification-icon.png', 96, placed(shape([255, 255, 255], 8), 96, 82, 48, 48));

  // Opening screen: the same duck, no shadow (it sits on the plain splash colour).
  write('splash-icon.png', 512, placed(duck, 512, 430, 256, 256));

  // Store icon (512): the app icon, halved by averaging each 2 x 2 block.
  const store = Buffer.alloc(512 * 512 * 4);
  for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) for (let c = 0; c < 4; c++) {
    let s = 0; for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) s += icon.px[((y * 2 + dy) * 1024 + x * 2 + dx) * 4 + c]; store[(y * 512 + x) * 4 + c] = Math.round(s / 4);
  }
  fs.writeFileSync(path.join(ROOT, 'store', 'google-play', 'icon-512.png'), L.encode(512, 512, store));
  console.log('wrote store/google-play/icon-512.png');
  console.log(`  background ${bgAt(TILE.top).map(Math.round)} to ${bgAt(TILE.bottom).map(Math.round)}, shadow ${(shadowAlpha * 100).toFixed(0)}%`);
})().catch((e) => { console.error(e); process.exit(1); });
