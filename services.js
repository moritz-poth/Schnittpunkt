// All network access: geocoding (Nominatim), street routing (OSRM), public transport (Transitous).
import { config } from './config.js';

const OSRM = {
  car: 'https://routing.openstreetmap.de/routed-car/table/v1/driving/',
  bike: 'https://routing.openstreetmap.de/routed-bike/table/v1/bike/',
  walk: 'https://routing.openstreetmap.de/routed-foot/table/v1/foot/',
};
const TRANSITOUS = 'https://api.transitous.org/api/v1/plan';

async function getJson(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Nominatim allows at most one request per second and forbids search-as-you-type.
let lastGeocode = 0;
export async function geocode(query, lang) {
  // Reserve the slot before waiting, so parallel calls queue up instead of firing together.
  const at = Math.max(Date.now(), lastGeocode + 1100);
  lastGeocode = at;
  if (at > Date.now()) await new Promise((r) => setTimeout(r, at - Date.now()));
  const c = config.city;
  const params = new URLSearchParams({
    q: query, format: 'jsonv2', limit: '5', addressdetails: '1',
    viewbox: c.viewbox.join(','), countrycodes: c.countrycodes, 'accept-language': lang,
  });
  const list = await getJson(`https://nominatim.openstreetmap.org/search?${params}`);
  return list.map((p) => ({ label: shortAddress(p), full: p.display_name, lat: Number(p.lat), lon: Number(p.lon) }));
}

// "Torstraße 1, 10119 Berlin" instead of Nominatim's long display name.
function shortAddress(p) {
  const a = p.address || {};
  const street = [a.road || a.pedestrian || a.square, a.house_number].filter(Boolean).join(' ');
  const place = [a.postcode, a.city || a.town || a.village || a.suburb].filter(Boolean).join(' ');
  const short = [street, place].filter(Boolean).join(', ');
  return street ? short : p.display_name;
}

// Minutes from one person to every room (null = no route). One request per person.
export async function streetMinutes(person, rooms, signal) {
  const coords = [person, ...rooms].map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  const data = await getJson(`${OSRM[person.mode]}${coords}?sources=0&annotations=duration`, { signal });
  if (data.code !== 'Ok') throw new Error(data.code);
  return data.durations[0].slice(1).map((s) => (s == null ? null : s / 60));
}

// Minutes by public transport (or on foot, if faster) arriving by `arriveBy` (Date).
export async function transitMinutes(person, room, arriveBy, signal) {
  const params = new URLSearchParams({
    fromPlace: `${person.lat},${person.lon}`, toPlace: `${room.lat},${room.lon}`,
    time: arriveBy.toISOString(), arriveBy: 'true',
  });
  const data = await getJson(`${TRANSITOUS}?${params}`, { signal });
  const all = [...(data.itineraries || []), ...(data.direct || [])].map((i) => i.duration / 60);
  return all.length ? Math.min(...all) : null;
}

// Runs `tasks` (functions returning promises) with at most `limit` at a time.
export async function runLimited(tasks, limit, onDone) {
  const results = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
      onDone?.();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

export async function loadRooms() {
  const res = await fetch('rooms.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
