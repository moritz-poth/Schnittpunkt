// Pure logic: no DOM, no network. Tested in test/core.test.mjs.

export const MODES = ['transit', 'bike', 'car', 'walk'];

// Rough speeds for the straight-line pre-filter only (km/h, detour factor, fixed minutes).
const ESTIMATE = {
  walk: { speed: 4.8, detour: 1.3, extra: 0 },
  bike: { speed: 15, detour: 1.3, extra: 0 },
  car: { speed: 24, detour: 1.35, extra: 3 },
  transit: { speed: 18, detour: 1.0, extra: 8 },
};

export function distanceKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

export function estimateMinutes(from, to, mode) {
  const e = ESTIMATE[mode];
  return (distanceKm(from, to) * e.detour / e.speed) * 60 + e.extra;
}

// Summary of one room: total and longest trip; null minutes mean "no route found".
export function scoreRoom(minutes) {
  if (minutes.some((m) => m == null)) return { total: null, max: null, complete: false };
  return { total: minutes.reduce((s, m) => s + m, 0), max: Math.max(...minutes), complete: true };
}

// criterion 'fair' = shortest longest trip first, 'total' = smallest sum first.
// Rooms where someone has no route go last.
export function rankRooms(rows, criterion) {
  const [first, second] = criterion === 'fair' ? ['max', 'total'] : ['total', 'max'];
  return [...rows].sort((a, b) => {
    if (a.score.complete !== b.score.complete) return a.score.complete ? -1 : 1;
    if (!a.score.complete) return 0;
    return a.score[first] - b.score[first] || a.score[second] - b.score[second];
  });
}

// Pick the rooms worth routing exactly: the best `perList` by estimated longest trip
// plus the best `perList` by estimated total. Keeps the number of API requests small.
export function pickCandidates(rooms, people, perList = 10) {
  if (rooms.length <= perList * 1.5) return rooms;
  const est = rooms.map((room) => scoreRoom(people.map((p) => estimateMinutes(p, room, p.mode))));
  const order = (key) => rooms.map((_, i) => i).sort((a, b) => est[a][key] - est[b][key]).slice(0, perList);
  const keep = new Set([...order('max'), ...order('total')]);
  return rooms.filter((_, i) => keep.has(i));
}

// Reads coordinates from a pasted Google Maps link or a plain "52.5, 13.4".
export function parseCoords(text) {
  if (!text) return null;
  const patterns = [
    /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,
    /@(-?\d+\.\d+),(-?\d+\.\d+)/,
    /[?&](?:q|query|ll|destination)=(-?\d+\.\d+)(?:,|%2C)\s*(-?\d+\.\d+)/i,
    /\/maps\/search\/(-?\d+\.\d+)(?:,|%2C)\+?\s*(-?\d+\.\d+)/i,
    /^\s*(-?\d{1,2}\.\d+)\s*[,;]\s*(-?\d{1,3}\.\d+)\s*$/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const lat = Number(m[1]);
      const lon = Number(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lat, lon };
    }
  }
  return null;
}

export function newId() {
  return Math.random().toString(36).slice(2, 10);
}
