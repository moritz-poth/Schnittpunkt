// Everything city-specific. Another city: change these values and rooms.json.
export const config = {
  city: {
    name: 'Berlin',
    center: [52.515, 13.39],
    zoom: 11,
    // Address search only returns places inside this box: west, north, east, south.
    viewbox: [13.05, 52.7, 13.8, 52.33],
    countrycodes: 'de',
  },
};
