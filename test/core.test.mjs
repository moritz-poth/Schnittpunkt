import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distanceKm, scoreRoom, rankRooms, pickCandidates, parseCoords, parseTime, monthGrid, decodePolyline } from '../core.js';

test('distance Alexanderplatz – Brandenburger Tor is about 2.6 km', () => {
  const d = distanceKm({ lat: 52.5219, lon: 13.4132 }, { lat: 52.5163, lon: 13.3777 });
  assert.ok(d > 2.3 && d < 2.8, d);
});

test('score: total and longest trip, incomplete when a route is missing', () => {
  assert.deepEqual(scoreRoom([10, 30, 20]), { total: 60, max: 30, complete: true });
  assert.equal(scoreRoom([10, null]).complete, false);
});

test('ranking: fair sorts by longest trip, total by sum, incomplete last', () => {
  const row = (id, m) => ({ room: { id }, score: scoreRoom(m) });
  const rows = [row('a', [5, 40]), row('b', [25, 25]), row('c', [null, 1]), row('d', [20, 26])];
  assert.deepEqual(rankRooms(rows, 'fair').map((r) => r.room.id), ['b', 'd', 'a', 'c']);
  assert.deepEqual(rankRooms(rows, 'total').map((r) => r.room.id), ['a', 'd', 'b', 'c']);
});

test('candidates: small lists stay whole, big lists keep the nearest', () => {
  const people = [{ lat: 52.52, lon: 13.40, mode: 'bike' }];
  const rooms = Array.from({ length: 40 }, (_, i) => ({ id: String(i), lat: 52.52 + i * 0.01, lon: 13.40 }));
  assert.equal(pickCandidates(rooms.slice(0, 10), people).length, 10);
  const picked = pickCandidates(rooms, people);
  assert.deepEqual(picked.map((r) => r.id), rooms.slice(0, 10).map((r) => r.id));
});

test('coordinates from Google Maps links and plain text', () => {
  assert.deepEqual(parseCoords('https://www.google.com/maps/place/X/@52.5200,13.4050,17z'), { lat: 52.52, lon: 13.405 });
  assert.deepEqual(parseCoords('https://www.google.com/maps/place/X/data=!3d52.51!4d13.38'), { lat: 52.51, lon: 13.38 });
  assert.deepEqual(parseCoords('https://www.google.com/maps/search/52.50,+13.30'), { lat: 52.5, lon: 13.3 });
  assert.deepEqual(parseCoords('https://maps.google.com/?q=52.4,13.2'), { lat: 52.4, lon: 13.2 });
  assert.deepEqual(parseCoords('52.5, 13.4'), { lat: 52.5, lon: 13.4 });
  assert.equal(parseCoords('Torstraße 1, Berlin'), null);
  assert.equal(parseCoords('https://www.google.com/maps/place/X/data=!4m2!3m1!1s0x47a8:0x1'), null);
});

test('rooms/<city>.json: every city has a list; unique ids, name, address, position inside the city', async () => {
  const { readFileSync } = await import('node:fs');
  const { cities } = await import('../config.js');
  for (const [id, city] of Object.entries(cities)) {
    const rooms = JSON.parse(readFileSync(new URL(`../rooms/${id}.json`, import.meta.url), 'utf8'));
    assert.ok(Array.isArray(rooms), id);
    assert.equal(new Set(rooms.map((r) => r.id)).size, rooms.length, id);
    const [west, north, east, south] = city.viewbox;
    for (const r of rooms) {
      assert.ok(r.name && r.address, `${id}/${r.id}`);
      assert.ok(r.lat > south && r.lat < north && r.lon > west && r.lon < east, `${id}/${r.id}`);
    }
  }
  assert.ok(JSON.parse(readFileSync(new URL('../rooms/berlin.json', import.meta.url), 'utf8')).length > 0);
});

test('time: messy input becomes HH:MM, nonsense is rejected', () => {
  for (const [input, want] of [['9', '09:00'], ['930', '09:30'], ['9:30', '09:30'], ['9.30', '09:30'], ['9 30', '09:30'],
    ['1030', '10:30'], ['10:30 Uhr', '10:30'], ['21h', '21:00'], [' 7:05 ', '07:05'], ['0', '00:00']]) {
    assert.equal(parseTime(input), want, input);
  }
  for (const bad of ['', '24', '9:60', 'abc', '12345', null]) assert.equal(parseTime(bad), null, String(bad));
});

test('month grid: 42 days starting on the Monday before the 1st', () => {
  const days = monthGrid(2026, 10); // November 2026 starts on a Sunday
  assert.equal(days.length, 42);
  assert.equal(days[0].getDay(), 1);
  assert.equal(days[6].getDate(), 1);
  assert.equal(days[6].getMonth(), 10);
  const june = monthGrid(2026, 5); // 1 June 2026 is a Monday
  assert.equal(june[0].getDate(), 1);
});

test('every own module and the style sheet carry the current stamp (run npm run stamp)', async () => {
  const { readFileSync } = await import('node:fs');
  const { FILES, contentHash } = await import('../tools/stamp.mjs');
  const v = contentHash();
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, new RegExp(`app\\.js\\?v=${v}"`));
  assert.match(html, new RegExp(`style\\.css\\?v=${v}"`));
  for (const f of FILES.filter((n) => n.endsWith('.js'))) {
    const text = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    for (const m of text.matchAll(/from '(\.\/[^']+)'/g)) assert.equal(m[1].split('?v=')[1], v, `${f}: ${m[1]}`);
  }
});

test('polyline: Google example (precision 5) and a round trip at precision 7', () => {
  assert.deepEqual(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@'), [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]);
  const pts = decodePolyline('quk{h^}ao{~FzfCtsB', 7);
  assert.equal(pts.length, 2);
  assert.ok(Math.abs(pts[0][0] - 52.5278) < 0.01 && Math.abs(pts[0][1] - 13.4159) < 0.01, String(pts[0]));
});
