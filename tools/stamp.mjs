// Puts a content hash on every own script and style link (app.js?v=…), so after a deploy a browser
// never mixes cached old modules with new ones (GitHub Pages caches each file for 10 minutes).
// Run before every commit that changes a .js or .css file: npm run stamp. The test fails if it was forgotten.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
export const FILES = ['index.html', 'app.js', 'core.js', 'services.js', 'i18n.js', 'config.js', 'style.css'];
export const STAMP = /(\.(?:js|css))\?v=[0-9a-f]+/g;

const read = (f) => readFileSync(new URL(f, root), 'utf8');

// Hash over the contents with the stamps taken out, so stamping does not change it.
export function contentHash() {
  const h = createHash('sha256');
  for (const f of FILES) h.update(read(f).replace(STAMP, '$1'));
  return h.digest('hex').slice(0, 10);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const v = contentHash();
  for (const f of FILES) {
    const text = read(f);
    const next = text.replace(STAMP, `$1?v=${v}`);
    if (next !== text) writeFileSync(new URL(f, root), next);
  }
  console.log(`stamp v=${v}`);
}
