// Mirror a next-start SSR page to a local file:// page with working JS.
// Generalized from the project's established screenshot pipeline.
// Usage: node mirror-page.mjs <port> <pagePath> <slug> <outBase>
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const WEB = new URL('../../', import.meta.url).pathname.replace(/\/$/, '');
const [, , port, pagePath, slug, outBase] = process.argv;
if (!port || !pagePath || !slug || !outBase) {
  console.error('usage: mirror-page.mjs <port> <pagePath> <slug> <outBase>');
  process.exit(1);
}
const ORIGIN = `http://127.0.0.1:${port}`;
const outDir = path.join(outBase, slug);
const curl = (u) => execFileSync('curl', ['-sL', '--max-time', '60', u]);

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

let html = curl(ORIGIN + pagePath).toString();
if (!html || html.length < 1000) {
  console.error(`page too small: ${pagePath} (${(html || '').length}b)`);
  process.exit(1);
}

const destNext = path.join(outDir, '_next', 'static');
fs.mkdirSync(path.join(outDir, '_next'), { recursive: true });
execFileSync('cp', ['-r', path.join(WEB, '.next/static'), destNext]);
for (const f of fs.readdirSync(path.join(destNext, 'chunks'))) {
  if (!f.startsWith('webpack-') || !f.endsWith('.js')) continue;
  const p = path.join(destNext, 'chunks', f);
  const src = fs.readFileSync(p, 'utf8');
  if (src.includes('d.p="/_next/"')) fs.writeFileSync(p, src.split('d.p="/_next/"').join('d.p="./_next/"'));
}
function walk(dir, fn) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, fn);
    else if (e.name.endsWith('.css')) fn(p);
  }
}
walk(destNext, (p) => {
  const src = fs.readFileSync(p, 'utf8');
  if (src.includes('url("/fonts/')) {
    fs.writeFileSync(p, src.split('url("/fonts/').join('url("../../fonts/'));
  }
});

const found = new Set();
for (const m of html.matchAll(/(?:src|href)="(\/[^"]*)"/g)) {
  const u = m[1].split('#')[0].split('?')[0];
  if (u.startsWith('/fonts/') || /^\/[a-z0-9_.-]+\.(jpg|png|webp|svg|ico|webmanifest)$/i.test(u)) found.add(u);
}
for (const u of found) {
  const dest = path.join(outDir, '.' + decodeURIComponent(u));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try { fs.writeFileSync(dest, curl(ORIGIN + u)); } catch (e) { console.error('asset failed:', u); }
}

html = html.replace(/(src|href)="\/_next\//g, '$1="./_next/');
html = html.replace(/(src|href)="\/fonts\//g, '$1="./fonts/');
html = html.replace(/(src|href)="\/(logo\.jpg|icon\.png|apple-icon\.png)"/g, '$1="./$2"');
html = html.replace(/(\.\/_next\/[^"']+?)\?[^"']*(["'])/g, '$1$2');

fs.writeFileSync(path.join(outDir, 'index.html'), html);
console.log(`mirrored ${pagePath} -> ${slug} (${html.length}b)`);
