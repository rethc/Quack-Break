// Lifts the blue-light glasses off the glasses sprite sheet, placed on the standing duck (600 x 600,
// lined up with stand.png). Their tile icon comes from the accessories sheet (accessories.cjs).
//
// The first duck on sprites-glasses.jpg is the same drawing as the first duck on sprites-wave.jpg,
// plus the glasses. So each pixel near the glasses is compared with the plain duck: what changed is
// either navy rim or white glare laid over it, and how much tells how solid the glasses are there.
// The eyes changed too (the AI drew them looking up), so they are left out: the glasses go over the
// app's own eyes, which blink and close.
//   node scripts/duck-from-sheet/glasses.cjs   (run.mjs calls it)
const fs = require('fs');
const path = require('path');
const L = require('./lib.cjs');
const { loadJpg, findDucks, cutDuck, placement } = require('./sprites.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'assets', 'duck', 'source');
const OUT = path.join(ROOT, 'assets', 'duck');
const lum = ([r, g, b]) => 0.3 * r + 0.59 * g + 0.11 * b;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

(async () => {
  const withG = await loadJpg(path.join(SRC, 'sprites-glasses.jpg'));
  const plain = await loadJpg(path.join(SRC, 'sprites-wave.jpg'));
  const walk = await loadJpg(path.join(SRC, 'sprites-walk.jpg'));
  const gBox = findDucks(withG)[0];
  const gCut = cutDuck(withG, gBox);
  const { put } = placement(cutDuck(walk, findDucks(walk)[0]));

  // Line the plain duck up with the glasses duck, using the body below the head.
  const h = gBox.y1 - gBox.y0;
  let best = [0, 0], bestD = Infinity;
  for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
    let d = 0;
    for (let y = Math.round(gBox.y0 + h * 0.55); y < gBox.y1; y += 3) for (let x = gBox.x0; x < gBox.x1; x += 3) {
      const p = withG.rgb(x, y), q = plain.rgb(x + dx, y + dy); d += Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]);
    }
    if (d < bestD) { bestD = d; best = [dx, dy]; }
  }
  const [ax, ay] = best;
  const under = (x, y) => plain.rgb(x + ax, y + ay);

  // The rims: clearly navy where the plain duck wasn't. Their colour and their box.
  const isRim = (p) => lum(p) < 140 && p[2] - p[0] > 45;
  let rim = [0, 0, 0], n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = gBox.y0 - 20; y < gBox.y0 + h * 0.5; y++) for (let x = gBox.x0 - 60; x < gBox.x1 + 20; x++) {
    const p = withG.rgb(x, y); if (!isRim(p) || isRim(under(x, y))) continue;
    rim = rim.map((v, i) => v + p[i]); n++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  if (n < 200) throw new Error('could not find the glasses on sprites-glasses.jpg');
  rim = rim.map((v) => v / n);
  x0 -= 6; y0 -= 6; x1 += 6; y1 += 6;

  // The eyes, in either picture: dark, not navy, and not the soft edge of a rim (where navy blends
  // into the lens it turns grey). Left out, with a margin for their shine.
  const W = x1 - x0 + 1, H = y1 - y0 + 1;
  const nearRim = (x, y) => { for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (isRim(withG.rgb(x + dx, y + dy))) return true; return false; };
  const eye = new Uint8Array(W * H);
  const isEye = (p) => lum(p) < 125 && p[2] - p[0] < 40;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = x0 + x, sy = y0 + y;
    if (!((isEye(withG.rgb(sx, sy)) && !nearRim(sx, sy)) || isEye(under(sx, sy)))) continue;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < W && Y < H) eye[Y * W + X] = 1; }
  }

  const white = [255, 255, 255];
  const layer = L.layer(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (eye[y * W + x]) continue;
    const P = withG.rgb(x0 + x, y0 + y), U = under(x0 + x, y0 + y);
    // How far P has moved from the plain duck towards navy, or towards white, and how well that explains it.
    const fit = (C) => { const d = sub(C, U); const len = dot(d, d); if (len < 400) return { a: 0, miss: Infinity };
      const a = Math.max(0, Math.min(1, dot(sub(P, U), d) / len)); const m = sub(P, [U[0] + a * d[0], U[1] + a * d[1], U[2] + a * d[2]]); return { a, miss: Math.sqrt(dot(m, m)) }; };
    const navy = fit(rim), glare = fit(white);
    if (navy.a > 0.1 && navy.miss < 28) L.setPx(layer, x, y, rim.map(Math.round), Math.round(navy.a * 255));
    else if (glare.a > 0.12 && glare.miss < 18) L.setPx(layer, x, y, white, Math.round(Math.min(0.85, glare.a) * 255));
  }

  // On the duck: placed exactly like the glasses duck's own frame, which lines up with stand.png.
  const onDuck = put({ layer, X0: x0, Y0: y0, shadow: gCut.shadow });
  fs.writeFileSync(path.join(OUT, 'glasses.png'), L.encodeIndexed(600, 600, onDuck.px));
  console.log(`glasses: lined up by (${ax}, ${ay}), rim colour ${rim.map(Math.round)}, ${W} x ${H} sheet pixels`);
})().catch((e) => { console.error(e); process.exit(1); });
