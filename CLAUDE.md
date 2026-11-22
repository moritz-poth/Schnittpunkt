# Schnittpunkt

Static website on GitHub Pages (moritz-poth.github.io/Schnittpunkt): ranks editing rooms by travel time for several people. Shared rules: ~/.claude/skills/moe-apps/SKILL.md (four languages, Ferry palette, JetBrains Mono, title Helvetica Neue Light uppercase).

## Hard rules (user decisions 2026-11-22)
- No login, no backend, no stored user data. Only the UI language, theme and the editor's GitHub token live in localStorage.
- Rooms live in `rooms.json`, edited in the app's Rooms tab and written via the GitHub contents API with a fine-grained token (only this repo, Contents read/write).
- Public transport must stay free: Transitous `/api/v1/plan` with `arriveBy=true`, shortest of itineraries and direct walk. `one-to-all` was rejected (≈10 MB per person).
- Berlin first, other cities through `config.js` only.
- Real room names come from the user's list only via the app. Test data uses "Demo Room …" names and never goes into the repo.

## Layout
- `core.js` pure logic (ranking, pre-filter, CSV/Takeout parsing, Maps link parsing) – tested in `test/`.
- `services.js` all network calls (Nominatim ≤ 1 req/s and no search-as-you-type, OSRM table per person, Transitous, GitHub).
- `app.js` UI; DOM only via `el()` with textContent. `i18n.js` strings en/de/fr/es.
- Pre-filter: ≤ 15 rooms are all routed, otherwise best 10 by estimated longest trip ∪ best 10 by estimated total.

## Check
- `node --test test/*.test.mjs`
- Browser: `python3 -m http.server`, a copy with demo rooms.json outside the repo, Playwright (playwright-core, channel chrome).
- The CSP in index.html lists every allowed host; a new service must be added there.
