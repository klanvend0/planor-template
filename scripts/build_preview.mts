/**
 * Fold the web export into one file anyone can open.
 *
 * `npx expo export --platform web` leaves a folder of 57 files, which is fine
 * for a host and useless for "have a look at this". This inlines the stylesheet,
 * the bundle and the six font faces the app actually loads, so what comes out is
 * a single HTML file with no network dependencies at all — send it to someone,
 * open it on a plane, keep it next to a release as what that release looked
 * like.
 *
 * Usage:
 *   npx expo export --platform web --output-dir dist
 *   npm run preview:build            # writes preview/index.html
 *   cd preview && python3 -m http.server 8000
 *
 * It has to be *served*, not double-clicked: the router uses the history API,
 * which browsers refuse on `file://`. Any static server will do.
 *
 * @module scripts/build_preview
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const OUT_DIR = join(ROOT, 'preview');

/**
 * The faces the app loads at runtime.
 *
 * `@expo-google-fonts` ships every weight it has and the export copies all of
 * them — around 8MB of TTF nobody asks for. Inlining only these keeps the file
 * under 10MB.
 */
const FACES = [
  'Inter_500Medium',
  'Inter_700Bold',
  'Inter_800ExtraBold',
  'JetBrainsMono_500Medium',
  'JetBrainsMono_700Bold',
  'JetBrainsMono_800ExtraBold',
];

/** The page around the app: a phone's column, painted for either theme. */
const SHELL = `
      :root {
        --preview-ground: #e6edee;
        --preview-edge: rgba(11, 32, 40, 0.14);
        --preview-shadow: rgba(11, 32, 40, 0.18);
      }
      @media (prefers-color-scheme: dark) {
        :root:not([data-theme='light']) {
          --preview-ground: #060d11;
          --preview-edge: rgba(255, 255, 255, 0.08);
          --preview-shadow: rgba(0, 0, 0, 0.5);
        }
      }
      :root[data-theme='dark'] {
        --preview-ground: #060d11;
        --preview-edge: rgba(255, 255, 255, 0.08);
        --preview-shadow: rgba(0, 0, 0, 0.5);
      }
      body {
        margin: 0;
        background: var(--preview-ground);
        display: flex;
        justify-content: center;
      }
      #root {
        width: 100%;
        max-width: 430px;
        height: 100%;
        overflow: hidden;
        box-shadow:
          0 0 0 1px var(--preview-edge),
          0 24px 60px -24px var(--preview-shadow);
      }
`;

/**
 * Start the app at the root whatever path it is served from.
 *
 * The router reads the address bar, so a preview served at `/codeling.html`
 * opens on the app's own "route not found" screen. Serving the file as
 * `index.html` avoids this entirely; the rewrite is here for the times it is
 * not.
 */
const SHIM = `<script>
      try {
        if (window.location.pathname !== '/') window.history.replaceState(null, '', '/');
      } catch (error) {
        console.warn('preview: could not rewrite the path', error);
      }
    </script>
    `;

function only(directory: string, extension: string): string {
  const matches = readdirSync(directory).filter((name) => name.endsWith(extension));
  if (matches.length !== 1) {
    throw new Error(`expected one ${extension} in ${directory}, found ${matches.length}`);
  }
  return join(directory, matches[0]);
}

if (!existsSync(DIST)) {
  console.error('No dist/ yet. Run `npx expo export --platform web --output-dir dist` first.');
  process.exit(1);
}

let html = readFileSync(join(DIST, 'index.html'), 'utf8');
const css = readFileSync(only(join(DIST, '_expo/static/css'), '.css'), 'utf8');
let js = readFileSync(only(join(DIST, '_expo/static/js/web'), '.js'), 'utf8');

const fontPaths = [
  ...new Set(js.match(/\/assets\/node_modules\/@expo-google-fonts\/[^"]+?\.ttf/g) ?? []),
];

let inlined = 0;
for (const path of fontPaths) {
  const face = path.split('/').pop()!.split('.')[0];
  if (!FACES.includes(face)) continue;
  const data = readFileSync(join(DIST, path.slice(1))).toString('base64');
  js = js.split(`"${path}"`).join(`"data:font/ttf;base64,${data}"`);
  inlined += 1;
}

if (inlined !== FACES.length) {
  throw new Error(`inlined ${inlined} of ${FACES.length} fonts; has the font list changed?`);
}

// String surgery rather than a template: the bundle is full of backslashes that
// a replacement template would eat.
html = html.replace('<link rel="icon" href="/favicon.ico"/>', '');
const linkStart = html.indexOf('<link rel="preload"');
html = `${html.slice(0, linkStart)}<style>${css}</style>\n${html.slice(html.indexOf('</head>', linkStart))}`;
html = html.replace('</style>', `</style>\n    <style>${SHELL}</style>`);

const scriptStart = html.indexOf('<script src="/_expo');
const scriptEnd = html.indexOf('</script>', scriptStart) + '</script>'.length;
html = `${html.slice(0, scriptStart)}${SHIM}<script>${js}</script>${html.slice(scriptEnd)}`;

mkdirSync(OUT_DIR, { recursive: true });
const out = join(OUT_DIR, 'index.html');
writeFileSync(out, html);

console.log(`preview/index.html  ${(html.length / 1024 / 1024).toFixed(1)}MB`);
console.log('Serve it: cd preview && python3 -m http.server 8000');
