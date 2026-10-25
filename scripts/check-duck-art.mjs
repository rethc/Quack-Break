// Checks the duck's pictures in assets/duck before you build: every file the app uses is there,
// is a PNG, is square, is see-through, and the duck's frames all share one size so they line up.
//
//   node scripts/check-duck-art.mjs        (or: npm run duck:check)
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LIST = join(ROOT, 'src', 'components', 'duck', 'pictures.ts');

// The files the app loads, read from its own list so this check never falls out of step.
const source = readFileSync(LIST, 'utf8');
const wearStart = source.indexOf('wearIcons');
const files = [...source.matchAll(/require\('\.\.\/\.\.\/\.\.\/(assets\/duck\/[^']+\.png)'\)/g)].map((m) => ({
  rel: m[1],
  icon: m.index > wearStart,
}));

/**
 * Header facts and, for 8-bit RGBA or 256-colour files, how many pixels show and whether the
 * corners are clear.
 */
function readPng(path) {
  const b = readFileSync(path);
  if (b.length < 33 || b.toString('hex', 0, 8) !== '89504e470d0a1a0a') return { png: false };
  const width = b.readUInt32BE(16);
  const height = b.readUInt32BE(20);
  const depth = b[24];
  const colorType = b[25];
  const interlaced = b[28] === 1;
  let trns = null;
  const idat = [];
  for (let o = 8; o + 8 <= b.length; ) {
    const len = b.readUInt32BE(o);
    const type = b.toString('ascii', o + 4, o + 8);
    if (type === 'IDAT') idat.push(b.subarray(o + 8, o + 8 + len));
    if (type === 'tRNS') trns = b.subarray(o + 8, o + 8 + len);
    o += 12 + len;
  }
  const alpha = colorType === 6 || colorType === 4 || trns !== null;
  const info = { png: true, width, height, alpha, bytes: b.length };
  if ((colorType !== 6 && colorType !== 3) || depth !== 8 || interlaced) return info;

  // Undo PNG's row filters to look at the pixels' see-through values.
  const bpp = colorType === 6 ? 4 : 1;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const up = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp] : 0;
      let v = row[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += up;
      else if (filter === 3) v += (a + up) >> 1;
      else if (filter === 4) {
        const p = a + up - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
      }
      px[y * stride + x] = v & 255;
    }
  }
  // A 256-colour file keeps each colour's see-through value in its tRNS list (missing means solid).
  const alphaAt = (x, y) => {
    if (bpp === 4) return px[y * stride + x * 4 + 3];
    const k = px[y * stride + x];
    return trns && k < trns.length ? trns[k] : 255;
  };
  let shown = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (alphaAt(x, y) > 8) shown++;
  const corners = [alphaAt(0, 0), alphaAt(width - 1, 0), alphaAt(0, height - 1), alphaAt(width - 1, height - 1)];
  return { ...info, shown: shown / (width * height), clearCorners: corners.every((v) => v <= 8) };
}

const problems = [];
const notes = [];
const sizes = new Map();
for (const f of files) {
  const path = join(ROOT, f.rel);
  const name = f.rel.replace('assets/duck/', '');
  if (!existsSync(path)) {
    problems.push(`${name} is missing. The app needs it, even if it's an empty see-through picture.`);
    continue;
  }
  const p = readPng(path);
  if (!p.png) {
    problems.push(`${name} isn't a PNG file. Save it as PNG, keeping the same name.`);
    continue;
  }
  if (p.width !== p.height) problems.push(`${name} is ${p.width} x ${p.height}. It has to be square.`);
  if (!p.alpha) problems.push(`${name} has no see-through background, so it would cover what's behind it.`);
  else if (p.clearCorners === false)
    problems.push(`${name} has a solid background in its corners. Remove the background so only the drawing shows.`);
  if (p.shown === 0) notes.push(`${name} is empty, so it won't show (that's fine if you meant it).`);
  if (statSync(path).size > 1_500_000) notes.push(`${name} is over 1.5 MB. Smaller files keep the app small.`);
  if (!f.icon) sizes.set(name, p.width);
  else if (p.width < 128) notes.push(`${name} is only ${p.width} pixels wide and may look blurry. 256 is a good size.`);
}

const widths = [...new Set(sizes.values())];
if (widths.length > 1) {
  const common = widths.sort((a, b) => [...sizes.values()].filter((v) => v === b).length - [...sizes.values()].filter((v) => v === a).length)[0];
  for (const [name, w] of sizes) if (w !== common) problems.push(`${name} is ${w} pixels wide, but the other duck pictures are ${common}. All duck pictures must be the same size to line up.`);
} else if (widths[0] && widths[0] < 400) {
  notes.push(`The duck pictures are ${widths[0]} pixels wide. 600 looks sharp on every phone.`);
} else if (widths[0] && widths[0] > 1200) {
  notes.push(`The duck pictures are ${widths[0]} pixels wide. 600 is plenty and uses less memory.`);
}

console.log(`Checked ${files.length} duck pictures in assets/duck.`);
for (const n of notes) console.log(`  note: ${n}`);
if (problems.length === 0) {
  console.log('All good.');
} else {
  for (const p of problems) console.log(`  PROBLEM: ${p}`);
  process.exitCode = 1;
}
