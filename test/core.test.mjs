import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distanceKm, scoreRoom, rankRooms, pickCandidates, parseCoords, parseCsv, takeoutRows, validRooms } from '../core.js';

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

test('CSV with quotes, commas and line breaks', () => {
  assert.deepEqual(parseCsv('a,b\r\n"x, y","say ""hi""\nthere"\n'), [['a', 'b'], ['x, y', 'say "hi"\nthere']]);
});

test('Takeout rows by header name', () => {
  const csv = '﻿Title,Note,URL,Comment\nRoom One,2nd floor,"https://www.google.com/maps/search/52.5,13.4",\n,,,\n';
  assert.deepEqual(takeoutRows(csv), [{ name: 'Room One', note: '2nd floor', url: 'https://www.google.com/maps/search/52.5,13.4' }]);
});

test('room list validation', () => {
  assert.ok(validRooms([{ id: 'a', name: 'X', lat: 1, lon: 2 }]));
  assert.ok(!validRooms([{ id: 'a', name: ' ', lat: 1, lon: 2 }]));
  assert.ok(!validRooms([{ id: 'a', name: 'X', lat: null, lon: 2 }]));
});
