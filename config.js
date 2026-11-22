// Everything city- or repo-specific. Another city: change `city`, keep the rest.
export const config = {
  city: {
    name: 'Berlin',
    center: [52.515, 13.39],
    zoom: 11,
    // Nominatim prefers results inside this box: west, north, east, south.
    viewbox: [13.05, 52.7, 13.8, 52.33],
    countrycodes: 'de',
  },
  // Where the editor saves rooms.json (GitHub contents API).
  repo: { owner: 'moritz-poth', name: 'Schnittpunkt', branch: 'main', path: 'rooms.json' },
};
