# Schnittpunkt

Finds the editing room with the best journeys for everyone. Enter where the editors and directors start and how each of them travels (public transport, bike, car, on foot). Schnittpunkt ranks the editing rooms: fairest (the longest trip as short as possible) or shortest in total.

If you use Schnittpunkt and like it, I would be glad if you [bought me a coffee](https://buymeacoffee.com/moritzpoth).

**Live:** https://moritz-poth.github.io/Schnittpunkt/

- No sign-in, nothing stored. Everything happens in your browser.
- The addresses you enter go only to the map and routing services: [Nominatim](https://nominatim.org) (address search), [OSRM by FOSSGIS](https://routing.openstreetmap.de) (car, bike, on foot), [Transitous](https://transitous.org) (public transport).
- English, German, French and Spanish.

## Rooms

The room list is `rooms.json` in this repository. Edit it under **Rooms** on the page:

- Add a room by address or by pasting a Google Maps link.
- Import a Google Maps list: go to [takeout.google.com](https://takeout.google.com), click **Deselect all**, tick only **Saved** and create the export. Under `Takeout/Saved` there is one CSV per list. Rooms placed by name search are marked ⚠. Check them on the map, drag the marker if needed, and confirm.
- **Save to GitHub** writes `rooms.json` into the repository. GitHub Pages shows the change after about a minute. For this you need a [fine-grained token](https://github.com/settings/personal-access-tokens/new) for this repository only, with **Contents: Read and write**. The token stays in that browser.

## Another city

Change `city` in `config.js` (map centre, search area, country) and the `repo` entry if you use a fork.

## Development

Plain HTML and JavaScript modules, no build step. Leaflet and JetBrains Mono are in `vendor/`.

```sh
python3 -m http.server 8000   # then open http://localhost:8000
node --test test/*.test.mjs   # logic and translations
```

## Licence

GPL-3.0-or-later. Leaflet: BSD-2-Clause. JetBrains Mono: SIL OFL 1.1. Map data © OpenStreetMap contributors (ODbL).
