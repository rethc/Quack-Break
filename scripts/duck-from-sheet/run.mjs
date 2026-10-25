// Remakes the duck's pictures from the AI pictures in assets/duck/source, overwriting them: the
// animation frames and the things to wear (from the sprite sheets), the app icons and the opening
// screen (from the logo), then a guide showing every frame. Run: npm run duck:from-sheet
//
// The sheets are four AI pictures, each one row of six ducks (see assets/duck/README.md). New sheets
// with the same layout can replace them: the frames are found and lined up automatically. Which duck
// becomes which frame is the list at the top of sprites.cjs; where the hat, bow and scarf sit is at
// the top of accessories.cjs.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const OUT = join(ROOT, 'assets', 'duck');
const EDGE = process.env.EDGE ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const node = (script) => execFileSync(process.execPath, [join(HERE, script)], { stdio: 'inherit' });
node('sprites.cjs'); // the frames, plus src/components/duck/layout.ts
node('accessories.cjs'); // beanie, bow, scarf and their icons
node('glasses.cjs'); // blue-light glasses and their icon
node('logo.cjs'); // app icon, Android icon layers, opening screen, notification icon, store icon

// The guide: every frame with its name and when the app shows it.
const frames = [
  ['stand', 'Standing (most of the time)'],
  ['blink', 'Blink'],
  ['walk-1', 'Walking in, step 1'],
  ['walk-2', 'Walking in, step 2'],
  ['walk-3', 'Walking in, step 3'],
  ['walk-4', 'Walking in, step 4'],
  ['talk', 'Quack (beak open)'],
  ['wave', 'Waving: break time'],
  ['cheer', 'Wings up: break done'],
  ['happy', 'Happy, after a break'],
  ['sit', 'Sitting down'],
  ['sleepy', 'Getting sleepy'],
  ['content', 'Resting its eyes during a break'],
  ['dozing', 'Asleep, with a Zz'],
  ['asleep', 'Asleep: quiet hours'],
];
const cells = frames
  .map(([n, label]) => `<figure><img src="${pathToFileURL(join(OUT, `${n}.png`)).href}"><figcaption><b>${n}.png</b><br>${label}</figcaption></figure>`)
  .join('');
const work = mkdtempSync(join(tmpdir(), 'duck-guide-'));
const page = join(work, 'guide.html');
writeFileSync(
  page,
  `<!doctype html><html><head><style>
  html,body{margin:0;background:#e9f6fb;font:15px/1.3 system-ui,sans-serif;color:#1b2a3a}
  main{display:grid;grid-template-columns:repeat(5,220px);gap:12px;padding:16px}
  figure{margin:0;background:#fff;border-radius:12px;padding:8px;text-align:center}
  img{width:204px;height:204px;display:block;background:#cfeaf5;border-radius:8px}
  figcaption{margin-top:6px;min-height:38px}
  </style></head><body><main>${cells}</main></body></html>`,
);
mkdirSync(join(OUT, 'guide'), { recursive: true });
const out = join(OUT, 'guide', 'frames.png');
const r = spawnSync(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--allow-file-access-from-files', '--window-size=1180,880', `--screenshot=${out}`, pathToFileURL(page).href], { stdio: 'ignore', timeout: 60_000 });
rmSync(work, { recursive: true, force: true });
if (r.status !== 0 || !existsSync(out)) throw new Error('could not draw the guide (is EDGE set right?)');
console.log('wrote assets/duck/guide/frames.png');
