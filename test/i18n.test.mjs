import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STRINGS, LANGS } from '../i18n.js';
import { MODES } from '../core.js';

const root = new URL('../', import.meta.url);
const app = readFileSync(new URL('app.js', root), 'utf8');
const html = readFileSync(new URL('index.html', root), 'utf8');
const used = new Set([
  ...[...app.matchAll(/\bt\('(\w+)'/g)].map((m) => m[1]),
  ...[...app.matchAll(/key: '(\w+)'/g)].map((m) => m[1]),
  ...[...app.matchAll(/'(\w+)' : '(\w+)' : '(\w+)'/g)].flatMap((m) => m.slice(1)),
  ...[...html.matchAll(/data-i18n="(\w+)"/g)].map((m) => m[1]),
  ...MODES.map((m) => `mode_${m}`),
  'sort_fair', 'sort_total', 'sortHint_fair', 'sortHint_total', 'tab_plan', 'tab_rooms',
]);

test('every language has exactly the English keys', () => {
  const en = Object.keys(STRINGS.en).sort();
  for (const [code] of LANGS) assert.deepEqual(Object.keys(STRINGS[code]).sort(), en, code);
});

test('every key used in the UI exists', () => {
  for (const key of used) assert.ok(key in STRINGS.en, key);
});

test('placeholders match across languages', () => {
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
  for (const [code] of LANGS) {
    for (const key of Object.keys(STRINGS.en)) assert.equal(vars(STRINGS[code][key]), vars(STRINGS.en[key]), `${code}.${key}`);
  }
});
