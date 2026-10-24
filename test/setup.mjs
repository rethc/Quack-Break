// Loader for the service integration tests: lets src/services run in plain Node.
//
//   node --import ./test/setup.mjs --test "test/**/*.test.ts"
//
// - `@/x` resolves to `src/x`, and extensionless imports try .ts, .tsx and /index.ts (as Metro does).
// - Native and React Native packages resolve to the in-memory fakes in test/fakes/.
// - A `?gen=N` query on a project file is passed down to everything it imports from the project
//   (src/, modules/, test/fakes/). Importing a service with a new generation gives it a fresh
//   module graph: fresh module-level state, and fresh fakes. See helpers/world.mjs.
// - Project .ts files are loaded as TypeScript ES modules (Node strips the types itself).
//
// Uses module.registerHooks (synchronous, same thread): module.register() is deprecated in Node 26.
import { statSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

// Every time in the tests is computed in UTC, so quiet hours land at the same instants everywhere.
process.env.TZ = 'UTC';

const ROOT = new URL('../', import.meta.url);
const SRC = new URL('src/', ROOT);
const FAKES = new URL('test/fakes/', ROOT);
const NODE_MODULES = new URL('node_modules/', ROOT).href;

/** Packages replaced by fakes. Anything else from Expo or React Native is an error (see below). */
const FAKE_PACKAGES = {
  expo: 'expo.mjs',
  'expo-constants': 'expo-constants.mjs',
  'expo-file-system': 'expo-file-system.mjs',
  'expo-haptics': 'expo-haptics.mjs',
  'expo-notifications': 'expo-notifications.mjs',
  'expo-task-manager': 'expo-task-manager.mjs',
  'react-native': 'react-native.mjs',
};
/** Bare packages that may load for real. */
const REAL_PACKAGES = new Set(['react']);

const isFile = (path) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

const inProject = (href) => href.startsWith(ROOT.href) && !href.startsWith(NODE_MODULES);

/** Like Metro: the exact file, then with an extension, then a folder's index. */
function probe(base) {
  const path = fileURLToPath(base);
  if (isFile(path)) return base;
  for (const suffix of ['.ts', '.tsx', '.mjs', '.js', '/index.ts', '/index.tsx', '/index.mjs', '/index.js']) {
    if (isFile(path + suffix)) return new URL(base.href + suffix);
  }
  return null;
}

function genOf(parentURL) {
  if (!parentURL || !parentURL.startsWith('file:')) return null;
  return new URL(parentURL).searchParams.get('gen');
}

function withGen(url, gen) {
  if (gen === null || !inProject(url.href) || url.searchParams.has('gen')) return url;
  const out = new URL(url.href);
  out.searchParams.set('gen', gen);
  return out;
}

function fromProject(parentURL) {
  return !!parentURL && parentURL.startsWith('file:') && inProject(parentURL);
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const { parentURL } = context;
    const gen = genOf(parentURL);

    if (fromProject(parentURL) && !specifier.startsWith('node:')) {
      const bare = !/^(\.|\/|[a-z]+:|@\/)/i.test(specifier);
      if (bare) {
        const pkg = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
        if (Object.hasOwn(FAKE_PACKAGES, specifier)) {
          return { url: withGen(new URL(FAKE_PACKAGES[specifier], FAKES), gen).href, format: 'module', shortCircuit: true };
        }
        if (!REAL_PACKAGES.has(pkg) && !parentURL.startsWith(FAKES.href)) {
          // A native package with no fake would crash Node in confusing ways: say so instead.
          throw new Error(`No test fake for '${specifier}' (imported by ${parentURL}). Add one under test/fakes/.`);
        }
      } else {
        const base = specifier.startsWith('@/') ? new URL(specifier.slice(2), SRC) : new URL(specifier, parentURL);
        // A query on the specifier itself (world() asks for `x.ts?gen=N`) wins over the parent's.
        const ownSearch = base.search;
        base.search = '';
        const found = probe(base);
        if (found) {
          found.search = ownSearch;
          if (/\.(tsx|jsx)$/.test(found.pathname)) {
            throw new Error(
              `${parentURL} imports UI code (${found.pathname}). Services must not import .tsx/JSX files; ` +
                'Node cannot strip JSX, and the service layer should not depend on components.',
            );
          }
          const url = withGen(found, gen);
          return { url: url.href, format: /\.ts$/.test(found.pathname) ? 'module-typescript' : undefined, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    // Project TypeScript is ES modules; say so, so Node doesn't guess (and warn) per file.
    if (url.startsWith('file:') && inProject(url) && /\.ts$/.test(new URL(url).pathname)) {
      return nextLoad(url, { ...context, format: 'module-typescript' });
    }
    return nextLoad(url, context);
  },
});

export {};
