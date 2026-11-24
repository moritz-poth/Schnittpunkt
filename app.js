import { config } from './config.js';
import { MODES, scoreRoom, rankRooms, pickCandidates, parseCoords, parseTime, monthGrid, newId } from './core.js';
import * as api from './services.js';
import { STRINGS, LANGS } from './i18n.js';

const MODE_ICON = { transit: '🚇', bike: '🚲', car: '🚗', walk: '🚶' };

const state = {
  lang: STRINGS[localStorage.getItem('lang')] ? localStorage.getItem('lang') : 'en',
  dark: localStorage.getItem('theme') !== 'light',
  rooms: [],
  roomsError: false,
  people: [],
  arrive: defaultArrival(), // "YYYY-MM-DDTHH:MM", local time
  picker: null, // null | 'date' | 'time'
  pickMonth: null, // first day of the month shown in the calendar
  timeText: null, // the time field while someone types in it
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

function pad(n) {
  return String(n).padStart(2, '0');
}
function ymd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const TIMES = Array.from({ length: 96 }, (_, i) => `${pad(Math.floor(i / 4))}:${pad((i % 4) * 15)}`);

// shortcut: the time is read in the browser's time zone; fine while users sit in the city they plan for.
function defaultArrival() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return `${ymd(d)}T10:00`;
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

const map = L.map('map', { zoomControl: true, doubleClickZoom: false }).setView(config.city.center, config.city.zoom);
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

// Double-click on the map: the first empty person (A, then B, …) or a new one starts there.
map.on('dblclick', ({ latlng }) => {
  const { lat, lng: lon } = latlng;
  let p = state.people.find((q) => q.lat == null && !q.query.trim());
  if (!p) { p = newPerson(); state.people.push(p); }
  clearTimeout(p.timer);
  p.ctrl?.abort();
  const label = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  Object.assign(p, { lat, lon, address: label, query: label, results: null, searching: false });
  state.view = 'plan';
  invalidate();
  render();
  document.getElementById(`p-${p.id}`)?.scrollIntoView({ block: 'nearest' });
  // Coordinates stay as clicked; the address is only the readable name.
  api.reverse(lat, lon, state.lang)
    .then((name) => { if (name && p.lat === lat && p.lon === lon) { p.address = name; p.query = name; render(); } })
    .catch(() => {});
});

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

// ---------- arrival date and time ----------

function setArrive(date, time) {
  const next = `${date}T${time}`;
  if (next !== state.arrive) { state.arrive = next; invalidate(); }
}

// Takes over what was typed into the time field; unreadable text goes back to the last time.
function commitTime() {
  if (state.timeText == null) return;
  const time = parseTime(state.timeText);
  if (time) setArrive(state.arrive.slice(0, 10), time);
  state.timeText = null;
}

function closePicker(focusId) {
  commitTime();
  state.picker = null;
  render();
  if (focusId) document.getElementById(focusId)?.focus();
}

function dateLabel(d) {
  const opts = { weekday: 'short', day: 'numeric', month: 'short' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(state.lang, opts);
}

function pickDate(d) {
  setArrive(ymd(d), state.arrive.slice(11));
  closePicker('arrive-date');
}

function calendar(selected) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const month = state.pickMonth;
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const shiftMonth = (n) => { state.pickMonth = new Date(month.getFullYear(), month.getMonth() + n, 1); render(); };
  // Arrow keys move through the days; only the selected day is a tab stop.
  const onKey = (e, d) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (e.key === 'Escape') { e.preventDefault(); closePicker('arrive-date'); return; }
    if (!step) return;
    e.preventDefault();
    const next = new Date(d);
    next.setDate(d.getDate() + step);
    if (next < today) return;
    state.pickMonth = new Date(next.getFullYear(), next.getMonth(), 1);
    focusDay = ymd(next);
    render();
    document.getElementById(`d-${focusDay}`)?.focus();
  };
  const weekdays = monthGrid(2024, 0).slice(0, 7).map((d) => d.toLocaleDateString(state.lang, { weekday: 'short' }).replace('.', '').slice(0, 2));
  const stop = focusDay && focusDay.slice(0, 7) === ymd(month).slice(0, 7) ? focusDay : (ymd(selected).slice(0, 7) === ymd(month).slice(0, 7) ? ymd(selected) : ymd(month < today ? today : month));
  return el('div', { class: 'popover cal', role: 'dialog', 'aria-label': t('chooseDate') },
    el('div', { class: 'cal-quick' },
      el('button', { type: 'button', class: ymd(selected) === ymd(today) ? 'on' : '', text: t('today'), onclick: () => pickDate(today) }),
      el('button', { type: 'button', class: ymd(selected) === ymd(tomorrow) ? 'on' : '', text: t('tomorrow'), onclick: () => pickDate(tomorrow) })),
    el('div', { class: 'cal-head' },
      el('button', { type: 'button', class: 'icon', 'aria-label': t('prevMonth'), title: t('prevMonth'), text: '‹', disabled: month <= new Date(today.getFullYear(), today.getMonth(), 1), onclick: () => shiftMonth(-1) }),
      el('strong', { 'aria-live': 'polite', text: month.toLocaleDateString(state.lang, { month: 'long', year: 'numeric' }) }),
      el('button', { type: 'button', class: 'icon', 'aria-label': t('nextMonth'), title: t('nextMonth'), text: '›', onclick: () => shiftMonth(1) })),
    el('div', { class: 'cal-grid' },
      weekdays.map((w) => el('span', { class: 'cal-wd', 'aria-hidden': 'true', text: w })),
      monthGrid(month.getFullYear(), month.getMonth()).map((d) => {
        const key = ymd(d);
        const cls = ['day', d.getMonth() !== month.getMonth() && 'out', key === ymd(today) && 'today', key === ymd(selected) && 'on'].filter(Boolean).join(' ');
        return el('button', {
          type: 'button', id: `d-${key}`, class: cls, text: String(d.getDate()), disabled: d < today,
          tabindex: key === stop ? '0' : '-1', 'aria-pressed': String(key === ymd(selected)),
          'aria-label': d.toLocaleDateString(state.lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
          onclick: () => pickDate(d), onkeydown: (e) => onKey(e, d),
        });
      })));
}
let focusDay = null;

function timeList(current) {
  return el('ul', { class: 'choices popover times', id: 'time-list', role: 'listbox', 'aria-label': t('arriveTime') },
    TIMES.map((time) => el('li', {
      id: `t-${time.replace(':', '')}`, role: 'option', class: 'choice' + (time === current ? ' on' : ''), 'aria-selected': String(time === current),
      onmousedown: (e) => e.preventDefault(), // keep focus in the field
      onclick: () => { state.timeText = null; setArrive(state.arrive.slice(0, 10), time); closePicker(); },
      text: time,
    })));
}

function timeKey(e) {
  const typed = state.timeText != null ? parseTime(state.timeText) : null;
  const current = typed || state.arrive.slice(11);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    // Next quarter hour up or down from the current time.
    const [h, m] = current.split(':').map(Number);
    const mins = h * 60 + m;
    const next = e.key === 'ArrowDown' ? Math.floor(mins / 15) * 15 + 15 : Math.ceil(mins / 15) * 15 - 15;
    state.timeText = null;
    setArrive(state.arrive.slice(0, 10), TIMES[(next / 15 + 96) % 96]);
    state.picker = 'time';
    render();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    closePicker('arrive-time');
  } else if (e.key === 'Escape') {
    e.preventDefault();
    state.timeText = null;
    closePicker('arrive-time');
  }
}

function arrivalPicker() {
  const [date, time] = state.arrive.split('T');
  const day = new Date(`${date}T00:00`);
  const shownTime = state.timeText ?? time;
  const listTime = (state.timeText != null && parseTime(state.timeText)) || time;
  return el('div', { class: 'arrive' },
    el('label', { for: 'arrive-date', text: t('arriveBy') }),
    el('div', { class: 'row' },
      el('span', { class: 'pop-anchor' }, el('button', {
        type: 'button', id: 'arrive-date', class: 'pick' + (state.picker === 'date' ? ' open' : ''),
        'aria-haspopup': 'dialog', 'aria-expanded': String(state.picker === 'date'), 'aria-label': `${t('chooseDate')}: ${dateLabel(day)}`,
        onclick: () => {
          if (state.picker === 'date') { closePicker(); return; }
          commitTime();
          state.picker = 'date';
          state.pickMonth = new Date(day.getFullYear(), day.getMonth(), 1);
          focusDay = null;
          render();
          document.getElementById(`d-${date}`)?.focus();
        },
      }, el('span', { 'aria-hidden': 'true', text: '📅' }), dateLabel(day), el('span', { class: 'caret', 'aria-hidden': 'true', text: '▾' })),
      state.picker === 'date' ? calendar(day) : null),
      el('span', { class: 'pop-anchor' }, el('input', {
        type: 'text', id: 'arrive-time', class: 'pick time', inputmode: 'numeric', autocomplete: 'off', value: shownTime,
        'aria-label': t('arriveTime'), role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': String(state.picker === 'time'),
        'aria-controls': 'time-list', 'aria-activedescendant': state.picker === 'time' ? `t-${listTime.replace(':', '')}` : null,
        onclick: () => { if (state.picker !== 'time') { state.picker = 'time'; render(); scrollTimes(); } },
        oninput: (e) => { state.timeText = e.target.value; state.picker = 'time'; render(); scrollTimes(); },
        onkeydown: (e) => { timeKey(e); if (e.key.startsWith('Arrow')) scrollTimes(); },
      }),
      state.picker === 'time' ? timeList(listTime) : null),
      t('oClock') ? el('span', { class: 'muted', text: t('oClock') }) : null));
}

function scrollTimes() {
  document.querySelector('#time-list .on')?.scrollIntoView({ block: 'center' });
}

// Tab on the last control of the form goes back to the first person's name (the × buttons are skipped).
document.getElementById('panel').addEventListener('keydown', (e) => {
  if (e.key !== 'Tab' || e.shiftKey || state.view !== 'plan') return;
  const stops = [...e.currentTarget.querySelectorAll('button, input, [tabindex]')]
    .filter((n) => !n.disabled && n.tabIndex >= 0 && n.offsetParent !== null);
  const first = state.people[0] && document.getElementById(`n-${state.people[0].id}`);
  if (first && e.target === stops.at(-1)) { e.preventDefault(); first.focus(); }
});

// A click or focus outside the date and time controls closes their pop-up.
for (const type of ['mousedown', 'focusin']) {
  document.addEventListener(type, (e) => {
    if (state.picker && !e.target.closest?.('.arrive')) closePicker();
  });
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
      el('button', { type: 'button', class: 'icon', tabindex: '-1', 'aria-label': t('removePerson'), title: t('removePerson'), text: '×', onclick: () => { state.people.splice(i, 1); invalidate(); render(); } })),
    el('div', { class: 'row combo' },
      el('input', {
        class: 'grow', id, type: 'text', value: p.query, placeholder: t('addressPlaceholder'), 'aria-label': t('address'), autocomplete: 'off',
        role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': String(Array.isArray(p.results) && p.results.length > 0),
        'aria-controls': `l-${p.id}`, 'aria-activedescendant': p.active >= 0 ? `o-${p.id}-${p.active}` : null,
        oninput: (e) => {
          p.query = e.target.value;
          // The text no longer matches the picked place.
          if (p.lat != null) { Object.assign(p, { lat: null, lon: null, address: '' }); invalidate(); }
          render(); // the find button may change state
          scheduleSuggest(p);
        },
        onkeydown: (e) => addressKey(e, p, pick),
      })),
    resultList(p, pick),
    p.lat != null && !p.results ? el('p', { class: 'picked' }, el('span', { class: 'ok', 'aria-hidden': 'true', text: '✓ ' }), p.address) : null,
    // Buttons, not radios: every mode is its own Tab stop and Space picks it (user request 2026-11-24).
    el('div', { class: 'modes', role: 'group', 'aria-label': t('mode') },
      MODES.map((m) => el('button', {
        type: 'button', id: `m-${p.id}-${m}`, class: 'mode' + (p.mode === m ? ' on' : ''), 'aria-pressed': String(p.mode === m),
        onclick: () => { if (p.mode !== m) { p.mode = m; invalidate(); render(); } },
      }, el('span', { 'aria-hidden': 'true', text: MODE_ICON[m] }), ' ', t(`mode_${m}`)))));
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
    el('p', { class: 'hint', text: t('mapHint') }),
    state.people.map(personCard),
    el('button', { type: 'button', class: 'add', text: `+ ${t('addPerson')}`, onclick: () => { state.people.push(newPerson()); render(); document.getElementById(`p-${state.people.at(-1).id}`)?.focus(); } }),
    arrivalPicker(),
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
          room.note ? el('span', { class: 'muted note', text: room.note }) : null))))));
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
