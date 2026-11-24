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
  view: 'plan', // 'plan' | 'rooms'
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
  return { id: newId(), name: '', query: '', lat: null, lon: null, address: '', mode: 'transit', results: null, active: -1, searching: false };
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
    marker.bindTooltip(el('span', {}, el('strong', { text: room.name }), el('br'), room.address || '',
      room.note ? el('span', { class: 'note', text: room.note }) : null));
    marker.on('mouseover', () => hoverRoom(room.id, true)).on('mouseout', () => hoverRoom(room.id, false));
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

// Highlights a room on the map and, in the room list, its entry.
function hoverRoom(id, on) {
  markers.get(id)?.getElement()?.classList.toggle('hover', on);
  document.getElementById(`room-${id}`)?.classList.toggle('hover', on);
}

// Start view: every room visible with a little room around it.
function homeView(animate) {
  for (const m of markers.values()) m.closeTooltip();
  if (!state.rooms.length) return;
  const bounds = L.latLngBounds(state.rooms.map((r) => [r.lat, r.lon]));
  if (animate) map.flyToBounds(bounds, { padding: [30, 30], duration: 0.6 });
  else map.fitBounds(bounds, { padding: [30, 30] });
}

function focusRoom(room) {
  // Only one room's info at a time.
  for (const [id, m] of markers) if (id !== room.id) m.closeTooltip();
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

// Suggestions while typing: wait for a short pause, drop answers to older text.
function scheduleSuggest(p) {
  clearTimeout(p.timer);
  p.ctrl?.abort();
  const query = p.query.trim();
  if (query.length < 3 || parseCoords(query)) {
    p.results = null;
    p.searching = false;
    render(); // the find button may change state
    return;
  }
  p.timer = setTimeout(() => {
    const ctrl = new AbortController();
    p.ctrl = ctrl;
    p.searching = !p.results;
    if (p.searching) render();
    api.suggest(query, state.lang, ctrl.signal)
      .then((list) => { p.results = list; p.active = -1; })
      .catch(() => { if (!ctrl.signal.aborted) p.results = 'error'; })
      .finally(() => { if (!ctrl.signal.aborted) { p.searching = false; render(); } });
  }, 300);
}

// The typed text as a place: coordinates or a Google Maps link directly, otherwise the first suggestion.
async function resolve(p) {
  const query = p.query.trim();
  const coords = parseCoords(query);
  if (coords) return { ...coords, label: query.startsWith('http') ? `${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}` : query };
  const list = Array.isArray(p.results) && p.results.length ? p.results : await api.suggest(query, state.lang);
  if (!list.length) p.results = list;
  return list[0] ?? null;
}

function resultList(p, onPick) {
  if (p.searching) return el('p', { class: 'hint', role: 'status', text: t('searching') });
  if (p.results === 'error') return el('p', { class: 'error', role: 'alert', text: t('searchFailed') });
  if (!p.results) return null;
  if (!p.results.length) return el('p', { class: 'hint', role: 'status', text: t('noMatch') });
  return el('ul', { class: 'choices', id: `l-${p.id}`, role: 'listbox', 'aria-label': t('searchResults') },
    p.results.map((r, i) => el('li', {
      id: `o-${p.id}-${i}`, role: 'option', class: 'choice' + (i === p.active ? ' on' : ''), 'aria-selected': String(i === p.active),
      onmousedown: (e) => e.preventDefault(), // keep focus in the field
      onclick: () => onPick(r), text: r.full || r.label,
    })));
}

function addressKey(e, p, pick) {
  const list = Array.isArray(p.results) ? p.results : [];
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!list.length) return;
    e.preventDefault();
    p.active = (p.active + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
    render();
  } else if (e.key === 'Escape' && p.results) {
    p.results = null;
    render();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (list.length) pick(list[Math.max(p.active, 0)]);
    else if (p.query.trim()) resolve(p).then((r) => (r ? pick(r) : render())).catch(() => { p.results = 'error'; render(); });
  }
}

function personCard(p, i) {
  const pick = (r) => {
    clearTimeout(p.timer);
    p.ctrl?.abort();
    Object.assign(p, { lat: r.lat, lon: r.lon, address: r.label, query: r.label, results: null, searching: false, active: -1 });
    invalidate();
    render();
  };
  const id = `p-${p.id}`;
  return el('div', { class: 'card person' },
    el('div', { class: 'row' },
      el('span', { class: 'badge', 'aria-hidden': 'true', text: letter(i) }),
      el('input', { class: 'grow', id: `n-${p.id}`, type: 'text', value: p.name, placeholder: t('namePlaceholder'), 'aria-label': t('name'), oninput: (e) => { p.name = e.target.value; } }),
      el('button', { type: 'button', class: 'icon', 'aria-label': t('removePerson'), title: t('removePerson'), text: '×', onclick: () => { state.people.splice(i, 1); invalidate(); render(); } })),
    el('div', { class: 'row combo' },
      el('input', {
        class: 'grow', id, type: 'text', value: p.query, placeholder: t('addressPlaceholder'), 'aria-label': t('address'), autocomplete: 'off',
        role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': String(Array.isArray(p.results) && p.results.length > 0),
        'aria-controls': `l-${p.id}`, 'aria-activedescendant': p.active >= 0 ? `o-${p.id}-${p.active}` : null,
        oninput: (e) => {
          p.query = e.target.value;
          // The text no longer matches the picked place.
          if (p.lat != null) { Object.assign(p, { lat: null, lon: null, address: '' }); invalidate(); render(); }
          scheduleSuggest(p);
        },
        onkeydown: (e) => addressKey(e, p, pick),
      })),
    resultList(p, pick),
    p.lat != null && !p.results ? el('p', { class: 'picked' }, el('span', { class: 'ok', 'aria-hidden': 'true', text: '✓ ' }), p.address) : null,
    el('div', { class: 'modes', role: 'radiogroup', 'aria-label': t('mode') },
      MODES.map((m) => el('label', { class: 'mode' + (p.mode === m ? ' on' : '') },
        el('input', { type: 'radio', name: `mode-${p.id}`, value: m, checked: p.mode === m, onchange: () => { p.mode = m; invalidate(); render(); } }),
        el('span', { 'aria-hidden': 'true', text: MODE_ICON[m] }), ' ', t(`mode_${m}`)))));
}

async function calculate() {
  // Typed but not picked: take the best match, so nobody drops out silently.
  const open = state.people.filter((p) => p.lat == null && p.query.trim());
  if (open.length) {
    state.resolving = true;
    render();
    await Promise.all(open.map((p) => resolve(p)
      .then((r) => { if (r) Object.assign(p, { lat: r.lat, lon: r.lon, address: r.label, query: r.label, results: null }); })
      .catch(() => { p.results = 'error'; })));
    state.resolving = false;
    if (open.some((p) => p.lat == null)) { render(); return; }
  }
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
  const ready = !state.resolving && state.people.some((p) => p.lat != null || p.query.trim()) && state.rooms.length > 0 && !Number.isNaN(new Date(state.arrive).getTime());
  const usesTransit = state.people.some((p) => p.mode === 'transit');
  return el('div', {},
    el('p', { class: 'intro', text: t('intro') }),
    state.roomsError ? el('p', { class: 'error', role: 'alert', text: t('roomsLoadFailed') }) : null,
    !state.roomsError && state.rooms.length === 0 ? el('p', { class: 'hint', text: t('noRoomsYet') }) : null,
    state.rooms.length ? el('button', { type: 'button', id: 'show-rooms', text: t('showRooms', { n: state.rooms.length }), onclick: () => showView('rooms', 'back') }) : null,
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

// Read-only list of the rooms in rooms.json; the plan keeps its inputs meanwhile.
function roomsView() {
  const rooms = [...state.rooms].sort((a, b) => a.name.localeCompare(b.name, state.lang));
  return el('div', {},
    el('button', { type: 'button', id: 'back', text: t('back'), onclick: () => { showView('plan', 'show-rooms'); homeView(true); } }),
    el('h2', { text: `${t('roomsTitle')} (${rooms.length})` }),
    el('ul', { class: 'plain room-list' }, rooms.map((room) => el('li', {
      id: `room-${room.id}`,
      onmouseenter: () => hoverRoom(room.id, true), onmouseleave: () => hoverRoom(room.id, false),
      onfocusin: () => hoverRoom(room.id, true), onfocusout: () => hoverRoom(room.id, false),
    },
      el('button', { type: 'button', class: 'result-head', onclick: () => focusRoom(room) },
        el('span', { class: 'grow' }, el('strong', { text: room.name }), el('br'), el('span', { class: 'muted', text: room.address || '' }),
          room.note ? el('span', { class: 'muted note' }, el('br'), room.note) : null))))));
}

function showView(view, focusId) {
  state.view = view;
  for (const m of markers.values()) m.getElement()?.classList.remove('hover');
  render();
  document.getElementById('panel').scrollTop = 0;
  document.getElementById(focusId)?.focus();
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
  panel.replaceChildren(state.view === 'rooms' ? roomsView() : planView());
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
  .finally(() => { render(); homeView(false); });
