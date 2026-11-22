// Builds rooms.json from a Google Takeout "Saved" list (CSV).
// The CSV links hold no coordinates, so each link is opened in Chrome: Google Maps then shows
// the place's coordinates in the URL and its address on the page.
//
//   npm install            (once, installs playwright-core; uses the installed Google Chrome)
//   node tools/import-takeout.mjs "<path>/Takeout/Gespeichert/<list>.csv"
//
// Writes rooms.json and prints every room for a check. Rooms are matched by name: a room that was
// in rooms.json before keeps its id; a corrected position or address in rooms.json is kept too.
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync } from 'node:fs';

const src = process.argv[2];
if (!src) {
  console.error('usage: node tools/import-takeout.mjs <takeout list.csv>');
  process.exit(1);
}
const target = new URL('../rooms.json', import.meta.url);

// RFC 4180 CSV (quotes, commas and line breaks inside quotes).
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false; else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Takeout puts the list's description above the header row ("Titel,Notiz,URL,…" or "Title,Note,URL,…").
const all = parseCsv(readFileSync(src, 'utf8').replace(/^﻿/, ''));
const head = all.findIndex((r) => /^(titel|title)$/i.test((r[0] || '').trim()) && r.some((h) => /^url$/i.test(h.trim())));
if (head < 0) throw new Error('No header row with Title/Titel and URL found.');
const col = (re) => all[head].findIndex((h) => re.test(h.trim()));
const [ci, ni, ui] = [col(/^(titel|title)$/i), col(/^(notiz|note)$/i), col(/^url$/i)];
const entries = all.slice(head + 1)
  .map((r) => ({ name: (r[ci] || '').trim(), note: ni >= 0 ? (r[ni] || '').trim() : '', url: (r[ui] || '').trim() }))
  .filter((e) => e.name && e.url);

let before = [];
try { before = JSON.parse(readFileSync(target, 'utf8')); } catch { /* first import */ }
const old = new Map(before.map((r) => [r.name.toLowerCase(), r]));

const slug = (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const cleanAddress = (a) => (a || '').replace(/^Adresse:\s*/, '').replace(/(\d{5} [^,-]+)-Bezirk [^,]+/, '$1').replace(/\b([\d/]+)\/\1\b/, '$1').trim();

// Saved plain addresses have no address field on Google's page: ask OpenStreetMap instead (≤ 1 request/s).
async function reverseAddress({ lat, lon }) {
  await new Promise((r) => setTimeout(r, 1100));
  const q = new URLSearchParams({ lat, lon, format: 'jsonv2', zoom: '18', addressdetails: '1', 'accept-language': 'de' });
  const res = await fetch(`https://nominatim.openstreetmap.org/reverse?${q}`, { headers: { 'User-Agent': 'Schnittpunkt room import (github.com/moritz-poth/Schnittpunkt)' } });
  if (!res.ok) return '';
  const a = (await res.json()).address || {};
  const street = [a.road || a.pedestrian, a.house_number].filter(Boolean).join(' ');
  const place = [a.postcode, a.city || a.town].filter(Boolean).join(' ');
  return street ? [street, place].filter(Boolean).join(', ') : '';
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await (await browser.newContext({ locale: 'de-DE', viewport: { width: 1200, height: 900 } })).newPage();
const rooms = [];
const problems = [];
for (const e of entries) {
  const known = old.get(e.name.toLowerCase());
  await page.goto(e.url, { waitUntil: 'domcontentloaded' });
  const reject = page.locator('button:has-text("Alle ablehnen"), button:has-text("Reject all")').first();
  if (await reject.isVisible({ timeout: 3000 }).catch(() => false)) { await reject.click(); await page.waitForLoadState('domcontentloaded'); }
  let pos = null;
  for (let i = 0; i < 30 && !pos; i++) {
    const u = decodeURIComponent(page.url());
    const m = u.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || u.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (m) pos = { lat: Math.round(Number(m[1]) * 1e6) / 1e6, lon: Math.round(Number(m[2]) * 1e6) / 1e6 };
    else await page.waitForTimeout(500);
  }
  await page.waitForTimeout(1500);
  const shownAddress = await page.locator('button[data-item-id="address"]').first().getAttribute('aria-label', { timeout: 4000 }).catch(() => null);
  const room = {
    id: known?.id || slug(e.name),
    name: e.name,
    address: known?.address || cleanAddress(shownAddress) || (pos ? await reverseAddress(pos) : ''),
    lat: known?.lat ?? pos?.lat,
    lon: known?.lon ?? pos?.lon,
  };
  if (e.note) room.note = e.note;
  if (room.lat == null || !room.address) problems.push(e.name);
  else rooms.push(room);
  console.log(`${e.name.slice(0, 42).padEnd(42)} ${room.address || '–'} (${room.lat}, ${room.lon})`);
}
await browser.close();

const ids = new Set();
for (const r of rooms) {
  while (ids.has(r.id)) r.id += '-2';
  ids.add(r.id);
}
writeFileSync(target, JSON.stringify(rooms, null, 2) + '\n');
console.log(`\n${rooms.length} rooms written to rooms.json.`);
if (problems.length) console.log(`No position or address found, add by hand:\n  ${problems.join('\n  ')}`);
