// Everything city-specific. Another city: add an entry here and rooms/<id>.json with its rooms.
// viewbox: the address search only returns places inside this box (west, north, east, south).
export const cities = {
  berlin: {
    name: 'Berlin',
    center: [52.515, 13.39],
    zoom: 11,
    viewbox: [13.05, 52.7, 13.8, 52.33],
    countrycodes: 'de',
  },
  muenchen: {
    name: 'München',
    names: { en: 'Munich', fr: 'Munich', es: 'Múnich' },
    center: [48.137, 11.575],
    zoom: 11,
    viewbox: [11.36, 48.25, 11.73, 48.06],
    countrycodes: 'de',
  },
};

// Room reports from the form go to Moe's report worker (Cloudflare), which files them as issues in the
// private repo moritz-poth/SchnittpunktReports (worker source: Mountpoint/worker).
export const REPORT_URL = 'https://mountpoint-reports.moritz-poth.workers.dev/report';

// The city on screen; app.js switches it.
export const config = { cityId: 'berlin', city: cities.berlin };
