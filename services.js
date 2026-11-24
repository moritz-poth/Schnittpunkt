// All network access: geocoding (Photon), street routing (OSRM), public transport (Transitous).
import { config } from './config.js?v=5f42c49c83';

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

// Photon (komoot, OpenStreetMap data) allows search-as-you-type; callers debounce and abort stale requests.
const PHOTON_LANGS = ['de', 'en', 'fr'];
export async function suggest(query, lang, signal) {
  const c = config.city;
  const [west, north, east, south] = c.viewbox;
  const params = new URLSearchParams({
    q: query, limit: '6', lang: PHOTON_LANGS.includes(lang) ? lang : 'default',
    bbox: [west, south, east, north].join(','), lat: String(c.center[0]), lon: String(c.center[1]),
  });
  const data = await getJson(`https://photon.komoot.io/api/?${params}`, { signal });
  const seen = new Set();
  const out = [];
  for (const f of data.features || []) {
    const p = f.properties || {};
    if (p.countrycode && p.countrycode.toLowerCase() !== c.countrycodes) continue;
    const key = `${p.osm_type}${p.osm_id}`;
    if (seen.has(key)) continue; // Photon lists one place once per tag (hotel, club, …)
    seen.add(key);
    const [lon, lat] = f.geometry.coordinates;
    out.push({ label: shortAddress(p), full: fullLabel(p), lat, lon });
  }
  return out;
}

// Address of a point on the map ("Torstraße 1, 10119 Berlin"), or null.
export async function reverse(lat, lon, lang) {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon), limit: '1', lang: PHOTON_LANGS.includes(lang) ? lang : 'default' });
  const data = await getJson(`https://photon.komoot.io/reverse?${params}`);
  const p = data.features?.[0]?.properties;
  return p ? shortAddress(p) : null;
}

// "Torstraße 1, 10119 Berlin".
function shortAddress(p) {
  const street = [p.street, p.housenumber].filter(Boolean).join(' ');
  const place = [p.postcode, p.city || p.district || p.locality].filter(Boolean).join(' ');
  return [street || p.name, place].filter(Boolean).join(', ');
}

// With the place name and district, so similar streets can be told apart in the list.
function fullLabel(p) {
  const short = shortAddress(p);
  const extra = [p.street && p.name, p.district && p.district !== p.city ? p.district : null].filter(Boolean);
  return extra.length ? `${short} (${extra.join(', ')})` : short;
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

export async function loadRooms(cityId) {
  const res = await fetch(`rooms/${cityId}.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
