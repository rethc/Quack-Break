// Small PNG helpers: decode (8-bit RGB/RGBA, non-interlaced), encode RGBA, place a layer on a canvas.
const fs = require('fs'), zlib = require('zlib');
exports.decode = function decode(path) {
  const b = fs.readFileSync(path); const w = b.readUInt32BE(16), h = b.readUInt32BE(20), ct = b[25];
  const bpp = ct === 6 ? 4 : 3; const idat = [];
  for (let o = 8; o + 8 <= b.length;) { const len = b.readUInt32BE(o); if (b.toString('ascii', o + 4, o + 8) === 'IDAT') idat.push(b.subarray(o + 8, o + 8 + len)); o += 12 + len; }
  const raw = zlib.inflateSync(Buffer.concat(idat)); const stride = w * bpp; const px = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) { const f = raw[y * (stride + 1)]; const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) { const a = x >= bpp ? px[y * stride + x - bpp] : 0, up = y ? px[(y - 1) * stride + x] : 0, c = x >= bpp && y ? px[(y - 1) * stride + x - bpp] : 0;
      let v = row[x]; if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1; else if (f === 4) { const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      px[y * stride + x] = v & 255; } }
  const rgb = (x, y) => { const o = (y * w + x) * bpp; return [px[o], px[o + 1], px[o + 2]]; };
  return { w, h, rgb };
};
exports.encode = function encode(w, h, rgba) {
  // Each row gets the PNG filter that leaves the smallest numbers, which makes the file much smaller.
  const stride = w * 4; const raw = Buffer.alloc((stride + 1) * h); const cand = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const row = y * stride; let best = -1, bestSum = Infinity;
    for (let f = 0; f <= 4; f++) {
      let sum = 0;
      for (let x = 0; x < stride; x++) {
        const v = rgba[row + x], a = x >= 4 ? rgba[row + x - 4] : 0, up = y ? rgba[row - stride + x] : 0, c = x >= 4 && y ? rgba[row - stride + x - 4] : 0;
        let p = 0; if (f === 1) p = a; else if (f === 2) p = up; else if (f === 3) p = (a + up) >> 1; else if (f === 4) { const q = a + up - c, pa = Math.abs(q - a), pb = Math.abs(q - up), pc = Math.abs(q - c); p = pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
        const d = (v - p) & 255; cand[x] = d; sum += d < 128 ? d : 256 - d;
      }
      if (sum < bestSum) { bestSum = sum; best = f; cand.copy(raw, y * (stride + 1) + 1); }
    }
    raw[y * (stride + 1)] = best;
  }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
};
/**
 * Writes RGBA pixels as a 256-colour PNG: a palette that includes see-through levels. Flat cartoon
 * art looks the same and the file is a fraction of the size. Colours are picked by median cut.
 */
exports.encodeIndexed = function encodeIndexed(w, h, rgba, colours = 256) {
  // Pixels too faint to see become fully see-through.
  const keyOf = (i) => { const a = rgba[i * 4 + 3]; return a < 4 ? 0 : ((rgba[i * 4] << 24) | (rgba[i * 4 + 1] << 16) | (rgba[i * 4 + 2] << 8) | a) >>> 0; };
  const counts = new Map();
  for (let i = 0; i < w * h; i++) { const key = keyOf(i); counts.set(key, (counts.get(key) || 0) + 1); }
  counts.delete(0);
  // Colours are compared as they show (multiplied by how solid they are), so faint edge pixels
  // don't use up the palette that the eyes and beak need.
  const shown = (k) => { const a = k & 255; return [(k >>> 24) * a / 255, ((k >>> 16) & 255) * a / 255, ((k >>> 8) & 255) * a / 255, a]; };
  const cols = [...counts].map(([k, n]) => ({ c: shown(k), n }));
  const AW = 1.5; // see-through differences count a bit more than colour ones
  const axis = (c, i) => (i === 3 ? c[3] * AW : c[i]);
  // A box's error is how far its colours are from their average, counting every pixel. The box with
  // the most error is split next, along the direction its colours spread most.
  const describe = (list) => {
    let n = 0; const mean = [0, 0, 0, 0];
    for (const e of list) { n += e.n; for (let i = 0; i < 4; i++) mean[i] += axis(e.c, i) * e.n; }
    for (let i = 0; i < 4; i++) mean[i] /= n;
    const spread = [0, 0, 0, 0];
    for (const e of list) for (let i = 0; i < 4; i++) spread[i] += e.n * (axis(e.c, i) - mean[i]) ** 2;
    const best = spread.indexOf(Math.max(...spread));
    return { list, axis: best, n, error: spread.reduce((a, b) => a + b, 0) };
  };
  let boxes = cols.length ? [describe(cols)] : [];
  while (boxes.length < colours - 1) {
    let pick = -1, score = 0;
    boxes.forEach((b, i) => { if (b.list.length > 1 && b.error > score) { score = b.error; pick = i; } });
    if (pick < 0) break;
    const b = boxes[pick]; const sorted = [...b.list].sort((p, q) => axis(p.c, b.axis) - axis(q.c, b.axis));
    // Split where half the pixels are on each side. A colour that holds the halfway point on its own
    // (the main yellow, say) goes to the side away from the rest, so it isn't peeled one shade at a time.
    let acc = 0, mid = 0; for (let i = 0; i < sorted.length; i++) { acc += sorted[i].n; if (acc >= b.n / 2) { mid = i; break; } }
    const cut = Math.min(sorted.length - 1, Math.max(1, mid === 0 ? 1 : mid));
    boxes.splice(pick, 1, describe(sorted.slice(0, cut)), describe(sorted.slice(cut)));
  }
  // Each palette colour is its box's average as shown; stored back as plain colour plus see-through.
  const avg = boxes.map((b) => { const s = [0, 0, 0, 0]; for (const e of b.list) for (let i = 0; i < 4; i++) s[i] += e.c[i] * e.n; return s.map((v) => v / b.n); });
  const pal = [[0, 0, 0, 0], ...avg.map(([r, g, b, a]) => [r, g, b].map((v) => Math.min(255, Math.round((v * 255) / a))).concat(Math.round(a)))];
  const nearest = new Map([[0, 0]]);
  const indexOf = (key) => {
    let hit = nearest.get(key); if (hit !== undefined) return hit;
    const c = shown(key); let best = 1, bd = Infinity;
    for (let i = 0; i < avg.length; i++) { const p = avg[i]; const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2 + ((p[3] - c[3]) * AW) ** 2; if (d < bd) { bd = d; best = i + 1; } }
    nearest.set(key, best); return best;
  };
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = indexOf(keyOf(y * w + x));
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 3;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr),
    chunk('PLTE', Buffer.from(pal.flatMap((p) => p.slice(0, 3)))), chunk('tRNS', Buffer.from(pal.map((p) => p[3]))),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
};
/** Reads an 8-bit RGBA or 256-colour PNG (what encode() and encodeIndexed() write) as a layer: { w, h, px }. */
exports.decodeRGBA = function decodeRGBA(path) {
  const b = fs.readFileSync(path); const w = b.readUInt32BE(16), h = b.readUInt32BE(20), ct = b[25];
  if (b[24] !== 8 || (ct !== 6 && ct !== 3) || b[28]) throw new Error(`${path} must be an 8-bit RGBA or palette PNG, not interlaced`);
  const idat = []; let plte = null, trns = null;
  for (let o = 8; o + 8 <= b.length;) { const len = b.readUInt32BE(o); const type = b.toString('ascii', o + 4, o + 8); const data = b.subarray(o + 8, o + 8 + len);
    if (type === 'IDAT') idat.push(data); else if (type === 'PLTE') plte = data; else if (type === 'tRNS') trns = data; o += 12 + len; }
  const bpp = ct === 6 ? 4 : 1;
  const raw = zlib.inflateSync(Buffer.concat(idat)); const stride = w * bpp; const un = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) { const f = raw[y * (stride + 1)]; const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) { const a = x >= bpp ? un[y * stride + x - bpp] : 0, up = y ? un[(y - 1) * stride + x] : 0, c = x >= bpp && y ? un[(y - 1) * stride + x - bpp] : 0;
      let v = row[x]; if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1; else if (f === 4) { const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      un[y * stride + x] = v & 255; } }
  if (ct === 6) return { w, h, px: un };
  const px = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) { const k = un[i]; px[i * 4] = plte[k * 3]; px[i * 4 + 1] = plte[k * 3 + 1]; px[i * 4 + 2] = plte[k * 3 + 2]; px[i * 4 + 3] = trns && k < trns.length ? trns[k] : 255; }
  return { w, h, px };
};
/** Paints `top` over `base` (straight alpha, same size), in place. */
exports.over = function over(base, top) {
  for (let i = 0; i < base.px.length; i += 4) {
    const a1 = top.px[i + 3] / 255; if (!a1) continue; const a0 = base.px[i + 3] / 255; const a = a1 + a0 * (1 - a1);
    for (let c = 0; c < 3; c++) base.px[i + c] = Math.round((top.px[i + c] * a1 + base.px[i + c] * a0 * (1 - a1)) / a);
    base.px[i + 3] = Math.round(a * 255);
  }
  return base;
};
/** The box around a layer's visible pixels. */
exports.bounds = function bounds(Lr, min = 20) {
  let x0 = Lr.w, y0 = Lr.h, x1 = -1, y1 = -1;
  for (let y = 0; y < Lr.h; y++) for (let x = 0; x < Lr.w; x++) if (Lr.px[(y * Lr.w + x) * 4 + 3] > min) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1 };
};
/** A layer in source pixels: RGBA, w x h. */
exports.layer = (w, h) => ({ w, h, px: Buffer.alloc(w * h * 4) });
exports.setPx = (L, x, y, [r, g, b], a = 255) => { const o = (y * L.w + x) * 4; L.px[o] = r; L.px[o + 1] = g; L.px[o + 2] = b; L.px[o + 3] = a; };
/** Draws a layer onto a size x size canvas: canvas = source * scale + (ox, oy), smooth (premultiplied bilinear). */
exports.place = function place(L, size, scale, ox, oy) {
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const fx = (x + 0.5 - ox) / scale - 0.5, fy = (y + 0.5 - oy) / scale - 0.5;
    if (fx < -1 || fy < -1 || fx > L.w || fy > L.h) continue;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0; let r = 0, g = 0, b = 0, a = 0;
    for (const [dx, dy, wt] of [[0, 0, (1 - tx) * (1 - ty)], [1, 0, tx * (1 - ty)], [0, 1, (1 - tx) * ty], [1, 1, tx * ty]]) {
      const sx = x0 + dx, sy = y0 + dy; if (sx < 0 || sy < 0 || sx >= L.w || sy >= L.h) continue;
      const o = (sy * L.w + sx) * 4, al = L.px[o + 3] / 255 * wt; r += L.px[o] * al; g += L.px[o + 1] * al; b += L.px[o + 2] * al; a += al; }
    if (a <= 0.001) continue; const o = (y * size + x) * 4;
    out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a); out[o + 3] = Math.round(Math.min(1, a) * 255); }
  return out;
};
/** Flood-fills "background" from the edges of a crop; returns a mask (1 = background). */
exports.background = function background(img, X0, Y0, W, H, isBg) {
  const bg = new Uint8Array(W * H); const stack = [];
  for (let x = 0; x < W; x++) stack.push(x, 0, x, H - 1); for (let y = 0; y < H; y++) stack.push(0, y, W - 1, y);
  while (stack.length) { const y = stack.pop(), x = stack.pop(); if (x < 0 || y < 0 || x >= W || y >= H) continue; const i = y * W + x;
    if (bg[i] || !isBg(img.rgb(X0 + x, Y0 + y))) continue; bg[i] = 1; stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1); }
  return bg;
};
/** Grows the background by one pixel, removing the light rim left by anti-aliasing. */
exports.erode = function erode(bg, W, H) {
  const out = bg.slice();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (bg[y * W + x]) continue;
    if ((x > 0 && bg[y * W + x - 1]) || (x < W - 1 && bg[y * W + x + 1]) || (y > 0 && bg[(y - 1) * W + x]) || (y < H - 1 && bg[(y + 1) * W + x])) out[y * W + x] = 1; }
  return out;
};
