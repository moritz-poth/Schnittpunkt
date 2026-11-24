# Schnittpunkt

Static website on GitHub Pages (moritz-poth.github.io/Schnittpunkt): ranks editing rooms by travel time for several people. Shared rules: ~/.claude/skills/moe-apps/SKILL.md (four languages, Ferry palette, JetBrains Mono, title Helvetica Neue Light uppercase).

## Hard rules (user decisions 2026-11-22)
- No login, no backend, no stored user data. Only UI language and theme live in localStorage.
- Rooms live in `rooms.json` and are maintained from here (Claude Code), not on the website: the in-app editor (token, CSV import, GitHub save) was removed on the user's request 2026-11-22. Source: the user's Google Maps list "Schneideräume in Berlin" (Takeout → Gespeichert CSV) → `npm run import -- <csv>` (tools/import-takeout.mjs, Playwright + Chrome; Takeout links carry no coordinates). Plain address entries get their address from Nominatim reverse. Check the printed list before committing. The list is meant for rentable rooms only (its own description).
- Public transport must stay free: Transitous `/api/v1/plan` with `arriveBy=true`, shortest of itineraries and direct walk. `one-to-all` was rejected (≈10 MB per person).
- Berlin first, other cities through `config.js` only.
- Test data uses "Demo Room …" names and never goes into the repo.

## Layout
- `core.js` pure logic (ranking, pre-filter, Maps link parsing) – tested in `test/` (also checks rooms.json).
- `services.js` all network calls (Photon address suggestions while typing – debounced 300 ms, stale requests aborted; OSRM table per person, Transitous).
- `app.js` UI; DOM only via `el()` with textContent. `i18n.js` strings en/de/fr/es.
- Pre-filter: ≤ 15 rooms are all routed, otherwise best 10 by estimated longest trip ∪ best 10 by estimated total.

## Check
- `node --test test/*.test.mjs`
- Browser: `python3 -m http.server`, Playwright (playwright-core devDependency, channel chrome).
- The CSP in index.html lists every allowed host; a new service must be added there.
