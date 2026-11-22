import { config } from './config.js';
import { MODES, scoreRoom, rankRooms, pickCandidates, parseCoords, newId } from './core.js';
import * as api from './services.js';
import { STRINGS, LANGS } from './i18n.js';

const MODE_ICON = { transit: '🚇', bike: '🚲', car: '🚗', walk: '🚶' };

const state = {
  lang: STRINGS[localStorage.getItem('lang')] ? localStorage.getItem('lang') : 'en',
  dark: localStorage.getItem('theme') !== 'light',
  rooms: [],
  roomsError: false,
  people: [],
  arrive: defaultArrival(),
  criterion: 'fair',
  results: null,
  progress: null, // { done, total, ctrl }
};

// ---------- helpers ----------

function t(key, vars = {}) {
  const s = STRINGS[state.lang][key] ?? STRINGS.en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

// Builds DOM nodes; text always goes in as text, never as HTML.
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'text') node.textContent = v;
    else if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'value') node.value = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c);
  return node;
}

function letter(i) {
  return String.fromCharCode(65 + (i % 26));
}

function fmtMin(m) {
  if (m == null) return '–';
  const r = Math.round(m);
  return r < 60 ? `${r} min` : `${Math.floor(r / 60)} h ${String(r % 60).padStart(2, '0')} min`;
}

// shortcut: the time is read in the browser's time zone; fine while users sit in the city they plan for.
function defaultArrival() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T10:00`;
}

// Inputs changed: old results no longer apply, a running calculation is stopped.
function invalidate() {
  state.results = null;
  state.progress?.ctrl.abort();
}


function newPerson() {
  return { id: newId(), name: '', query: '', lat: null, lon: null, address: '', mode: 'transit', results: null, searching: false };
}

// ---------- map ----------

const map = L.map('map', { zoomControl: true }).setView(config.city.center, config.city.zoom);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);
new ResizeObserver(() => map.invalidateSize()).observe(document.getElementById('map'));
const roomLayer = L.layerGroup().addTo(map);
const peopleLayer = L.layerGroup().addTo(map);
const markers = new Map();

function drawMap() {
  roomLayer.clearLayers();
  peopleLayer.clearLayers();
  markers.clear();
  const rank = new Map();
  state.results?.rows.forEach((row, i) => rank.set(row.room.id, i + 1));
  for (const room of state.rooms) {
    const r = rank.get(room.id);
    const cls = r ? (r <= 3 ? 'm-room top' : 'm-room ranked') : (state.results ? 'm-room out' : 'm-room');
    const icon = L.divIcon({ className: cls, html: r && r <= 3 ? String(r) : '', iconSize: r && r <= 3 ? [26, 26] : [14, 14] });
    const marker = L.marker([room.lat, room.lon], { icon, keyboard: true, title: room.name, alt: room.name });
    marker.bindTooltip(el('span', {}, el('strong', { text: room.name }), el('br'), room.address || ''));
    marker.addTo(roomLayer);
    markers.set(room.id, marker);
  }
  state.people.forEach((p, i) => {
    if (p.lat == null) return;
    const icon = L.divIcon({ className: 'm-person', html: letter(i), iconSize: [24, 24] });
    L.marker([p.lat, p.lon], { icon, title: p.name || letter(i), alt: p.name || letter(i) })
      .bindTooltip(el('span', { text: `${letter(i)} ${p.name}`.trim() }))
      .addTo(peopleLayer);
  });
}

function focusRoom(room) {
  map.flyTo([room.lat, room.lon], Math.max(map.getZoom(), 14), { duration: 0.6 });
  markers.get(room.id)?.openTooltip();
}

function fitResults() {
  const pts = [
    ...state.people.filter((p) => p.lat != null).map((p) => [p.lat, p.lon]),
    ...state.results.rows.slice(0, 3).map((r) => [r.room.lat, r.room.lon]),
  ];
  if (pts.length) map.fitBounds(pts, { padding: [40, 40], maxZoom: 15 });
}

// ---------- plan view ----------

function addressSearch(target, onPick) {
  const query = target.query.trim();
  if (!query || target.searching) return;
  const coords = parseCoords(query);
  if (coords) {
    onPick({ ...coords, label: query.startsWith('http') ? `${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}` : query });
    return;
  }
  target.searching = true;
  target.results = null;
  render();
  api.geocode(query, state.lang)
    .then((list) => { target.results = list; })
    .catch(() => { target.results = 'error'; })
    .finally(() => { target.searching = false; render(); });
}

function resultList(target, onPick) {
  if (target.searching) return el('p', { class: 'hint', role: 'status', text: t('searching') });
  if (target.results === 'error') return el('p', { class: 'error', role: 'alert', text: t('searchFailed') });
  if (!target.results) return null;
  if (!target.results.length) return el('p', { class: 'hint', role: 'status', text: t('noMatch') });
  return el('ul', { class: 'choices', 'aria-label': t('searchResults') },
    target.results.map((r) => el('li', {}, el('button', { type: 'button', class: 'choice', onclick: () => onPick(r), text: r.full || r.label }))));
}

function personCard(p, i) {
  const pick = (r) => {
    Object.assign(p, { lat: r.lat, lon: r.lon, address: r.label, results: null });
    invalidate();
    render();
  };
  const id = `p-${p.id}`;
  return el('div', { class: 'card person' },
    el('div', { class: 'row' },
      el('span', { class: 'badge', 'aria-hidden': 'true', text: letter(i) }),
      el('input', { class: 'grow', id: `n-${p.id}`, type: 'text', value: p.name, placeholder: t('namePlaceholder'), 'aria-label': t('name'), oninput: (e) => { p.name = e.target.value; } }),
      el('button', { type: 'button', class: 'icon', 'aria-label': t('removePerson'), title: t('removePerson'), text: '×', onclick: () => { state.people.splice(i, 1); invalidate(); render(); } })),
    el('form', { class: 'row', onsubmit: (e) => { e.preventDefault(); addressSearch(p, pick); } },
      el('input', { class: 'grow', id, type: 'text', value: p.query, placeholder: t('addressPlaceholder'), 'aria-label': t('address'), oninput: (e) => { p.query = e.target.value; } }),
      el('button', { type: 'submit', text: t('search') })),
    resultList(p, pick),
    p.lat != null && !p.results ? el('p', { class: 'picked' }, el('span', { class: 'ok', 'aria-hidden': 'true', text: '✓ ' }), p.address) : null,
    el('div', { class: 'modes', role: 'radiogroup', 'aria-label': t('mode') },
      MODES.map((m) => el('label', { class: 'mode' + (p.mode === m ? ' on' : '') },
        el('input', { type: 'radio', name: `mode-${p.id}`, value: m, checked: p.mode === m, onchange: () => { p.mode = m; invalidate(); render(); } }),
        el('span', { 'aria-hidden': 'true', text: MODE_ICON[m] }), ' ', t(`mode_${m}`)))));
}

async function calculate() {
  const people = state.people.filter((p) => p.lat != null).map((p, i) => ({ ...p }));
  const rooms = pickCandidates(state.rooms, people);
  const arrive = new Date(state.arrive);
  const ctrl = new AbortController();
  const minutes = people.map(() => new Array(rooms.length).fill(null));
  let failed = 0;
  const tasks = [];
  people.forEach((p, pi) => {
    if (p.mode === 'transit') {
      rooms.forEach((room, ri) => tasks.push(async () => {
        if (ctrl.signal.aborted) return;
        try { minutes[pi][ri] = await api.transitMinutes(p, room, arrive, ctrl.signal); } catch { failed++; }
      }));
    } else {
      tasks.push(async () => {
        if (ctrl.signal.aborted) return;
        try { minutes[pi] = await api.streetMinutes(p, rooms, ctrl.signal); } catch { failed++; }
      });
    }
  });
  state.results = null;
  state.progress = { done: 0, total: tasks.length, ctrl };
  render();
  await api.runLimited(tasks, 3, () => { state.progress.done++; renderProgress(); });
  state.progress = null;
  if (ctrl.signal.aborted) { render(); return; }
  const rows = rooms.map((room, ri) => {
    const m = people.map((_, pi) => minutes[pi][ri]);
    return { room, minutes: m, score: scoreRoom(m) };
  });
  state.results = {
    rows, people, failed,
    filtered: rooms.length < state.rooms.length, count: rooms.length,
    hasCar: people.some((p) => p.mode === 'car'),
  };
  render();
  fitResults();
}

function renderProgress() {
  const bar = document.getElementById('progress-bar');
  const txt = document.getElementById('progress-text');
  if (!bar || !state.progress) return;
  bar.value = state.progress.done;
  txt.textContent = t('calculating', { done: state.progress.done, total: state.progress.total });
}

function resultsView() {
  const res = state.results;
  const rows = rankRooms(res.rows, state.criterion);
  res.rows = rows;
  const sortButton = (c) => el('button', { type: 'button', class: 'seg' + (state.criterion === c ? ' on' : ''), 'aria-pressed': String(state.criterion === c), onclick: () => { state.criterion = c; render(); }, text: t(`sort_${c}`) });
  return el('section', { class: 'results', 'aria-labelledby': 'results-title' },
    el('h2', { id: 'results-title', text: t('results') }),
    el('div', { class: 'segs', role: 'group', 'aria-label': t('sortBy') }, sortButton('fair'), sortButton('total')),
    el('p', { class: 'hint', text: t(`sortHint_${state.criterion}`) }),
    res.filtered ? el('p', { class: 'hint', text: t('filteredHint', { n: res.count, all: state.rooms.length }) }) : null,
    res.hasCar ? el('p', { class: 'hint', text: t('carHint') }) : null,
    res.failed ? el('p', { class: 'error', role: 'alert', text: t('someFailed', { n: res.failed }) }) : null,
    el('ol', { class: 'ranking' }, rows.map((row, i) => el('li', { class: 'card result' + (i === 0 && row.score.complete ? ' best' : '') },
      el('button', { type: 'button', class: 'result-head', onclick: () => focusRoom(row.room) },
        el('span', { class: 'rank', text: String(i + 1) }),
        el('span', { class: 'grow' }, el('strong', { text: row.room.name }), el('br'), el('span', { class: 'muted', text: row.room.address || '' }),
          row.room.note ? el('span', { class: 'muted note' }, el('br'), row.room.note) : null)),
      el('p', { class: 'score' }, row.score.complete
        ? t('scoreLine', { max: fmtMin(row.score.max), total: fmtMin(row.score.total) })
        : t('noRoute')),
      el('ul', { class: 'chips' }, row.minutes.map((m, pi) => {
        const p = res.people[pi];
        return el('li', { class: 'chip' + (m != null && m === row.score.max ? ' longest' : '') },
          el('span', { class: 'badge small', 'aria-hidden': 'true', text: letter(state.people.findIndex((q) => q.id === p.id)) }),
          el('span', { class: 'sr', text: p.name || '' }),
          ` ${MODE_ICON[p.mode]} ${fmtMin(m)}`,
          m != null && m === row.score.max ? el('span', { class: 'sr', text: ` (${t('longest')})` }) : null);
      }))))));
}

function planView() {
  const ready = state.people.some((p) => p.lat != null) && state.rooms.length > 0 && !Number.isNaN(new Date(state.arrive).getTime());
  const usesTransit = state.people.some((p) => p.mode === 'transit');
  return el('div', {},
    el('p', { class: 'intro', text: t('intro') }),
    state.roomsError ? el('p', { class: 'error', role: 'alert', text: t('roomsLoadFailed') }) : null,
    !state.roomsError && state.rooms.length === 0 ? el('p', { class: 'hint', text: t('noRoomsYet') }) : null,
    el('h2', { text: t('whoIsComing') }),
    state.people.map(personCard),
    el('button', { type: 'button', class: 'add', text: `+ ${t('addPerson')}`, onclick: () => { state.people.push(newPerson()); render(); document.getElementById(`p-${state.people.at(-1).id}`)?.focus(); } }),
    el('div', { class: 'row arrive' },
      el('label', { for: 'arrive', text: t('arriveBy') }),
      el('input', { id: 'arrive', type: 'datetime-local', value: state.arrive, onchange: (e) => { state.arrive = e.target.value; invalidate(); render(); } })),
    usesTransit ? null : el('p', { class: 'hint', text: t('arriveHint') }),
    state.progress
      ? el('div', { class: 'progress', role: 'status' },
        el('progress', { id: 'progress-bar', max: state.progress.total, value: state.progress.done }),
        el('div', { class: 'row' },
          el('span', { id: 'progress-text', class: 'grow', text: t('calculating', { done: state.progress.done, total: state.progress.total }) }),
          el('button', { type: 'button', text: t('cancel'), onclick: () => state.progress.ctrl.abort() })))
      : el('button', { type: 'button', class: 'primary', disabled: !ready, onclick: calculate, text: t('findRoom') }),
    state.results ? resultsView() : null);
}

// ---------- shell ----------

function render() {
  document.documentElement.lang = state.lang;
  document.documentElement.classList.toggle('dark', state.dark);
  document.title = t('pageTitle');
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  const lang = document.getElementById('lang');
  lang.replaceChildren(...LANGS.map(([code, name]) => el('option', { value: code, selected: code === state.lang, text: name })));
  lang.setAttribute('aria-label', t('language'));
  const theme = document.getElementById('theme');
  theme.setAttribute('aria-checked', String(state.dark));
  theme.setAttribute('aria-label', t('darkMode'));
  theme.title = t('darkMode');
  const panel = document.getElementById('panel');
  // The panel is rebuilt on every change: put focus and caret back where they were.
  const active = document.activeElement;
  const focusId = active?.id;
  const caret = active && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
  panel.replaceChildren(planView());
  const again = focusId && document.getElementById(focusId);
  if (again) {
    again.focus();
    try { if (caret && caret[0] != null) again.setSelectionRange(caret[0], caret[1]); } catch { /* not a text field */ }
  }
  drawMap();
}

document.getElementById('lang').addEventListener('change', (e) => {
  state.lang = e.target.value;
  localStorage.setItem('lang', state.lang);
  render();
});
document.getElementById('theme').addEventListener('click', () => {
  state.dark = !state.dark;
  localStorage.setItem('theme', state.dark ? 'dark' : 'light');
  render();
});

state.people.push(newPerson(), newPerson());
render();
api.loadRooms()
  .then((rooms) => { state.rooms = rooms; })
  .catch(() => { state.roomsError = true; })
  .finally(render);
