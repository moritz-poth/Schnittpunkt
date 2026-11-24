# Schnittpunkt

Finds the editing room with the best journeys for everyone. Enter where the editors and directors start and how each of them travels (public transport, bike, car, on foot). Schnittpunkt ranks the editing rooms: fairest (the longest trip as short as possible) or shortest in total.

If you use Schnittpunkt and like it, I would be glad if you [bought me a coffee](https://buymeacoffee.com/moritzpoth).

**Live:** https://moritz-poth.github.io/Schnittpunkt/

- No sign-in, nothing stored. Everything happens in your browser.
- The addresses you enter go only to the map and routing services: [Photon](https://photon.komoot.io) (address search), [OSRM by FOSSGIS](https://routing.openstreetmap.de) (car, bike, on foot), [Transitous](https://transitous.org) (public transport).
- Only what someone sends with “Report a room” (missing or outdated rooms) is kept: it becomes an issue in a private repository. IP addresses are not stored.
- English, German, French and Spanish.

## Rooms

Each city has its own room list, `rooms/<city>.json` (e.g. `rooms/berlin.json`). A list is built from a Google Maps list exported with Google Takeout (only "Saved"):

```sh
npm install                                   # once
npm run import -- berlin "<path>/Takeout/Saved/<list>.csv"
```

The script opens each saved place in Google Chrome and reads its position and address. Rooms already in the city's file keep their id, address and position, so corrections made by hand stay. Check the printed list, then commit the file.

## Another city

Add the city to `cities` in `config.js` (name, map centre, search area, country) and create `rooms/<id>.json` (`[]` while it has no rooms yet). The city menu at the top lists it; `#<id>` in the address opens it directly.

## Development

Plain HTML and JavaScript modules, no build step. Leaflet and JetBrains Mono are in `vendor/`.

```sh
python3 -m http.server 8000   # then open http://localhost:8000
npm test                      # logic, translations, room lists
```

## Licence

GPL-3.0-or-later. Leaflet: BSD-2-Clause. JetBrains Mono: SIL OFL 1.1. Map data © OpenStreetMap contributors (ODbL).
