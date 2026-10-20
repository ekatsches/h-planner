/* ===== Хоккей — планировщик матчей ===== */
'use strict';

const STORE_KEY = 'hockeyPlanner.v1';
const REMIND_KEY = 'hockeyPlanner.remind';
const REMIND_MIN = 60;

/* Предзаготовленные лиги */
const PRESET_LEAGUES = ['КХЛ', 'МХЛ', 'ВХЛ', 'NHL', 'WHL', 'OHL'];

/* Предзаготовленные команды — те, за кем слежу */
const PRESET_TEAMS = ['Сибирь', 'Авангард', 'Торпедо', 'Снайперы', 'Авто', 'Чайка', 'Блейдс'];

/* Предзаготовленное время — обычное время матчей на арене */
const PRESET_TIMES = ['18:30', '13:00'];

const REMIND_STATUSES = ['attend', 'watch'];

const STATUS = {
  attend: { label: 'иду',      icon: '🎟', color: 'var(--attend)' },
  watch:  { label: 'смотрю',   icon: '📺', color: 'var(--watch)'  },
  read:   { label: 'почитать', icon: '📖', color: 'var(--read)'   },
  done:   { label: 'было',     icon: '✅', color: 'var(--done)'   },
  skip:   { label: 'мимо',     icon: '🚫', color: 'var(--skip)'   }
};
const STATUS_ORDER = ['attend', 'watch', 'read', 'done', 'skip'];

const state = {
  events: [],
  day: ymd(new Date()),
  filter: 'all',
  filterAll: 'all',
  scope: 'upcoming',
  query: '',
  view: 'day',
  editId: null,
  formStatus: 'watch',
  remindersOn: false
};

/* ---------- утилиты дат ---------- */
function ymd(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function todayYmd() { return ymd(new Date()); }
function addDays(s, n) {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}
function mondayOf(s) {
  const d = parseYmd(s);
  const shift = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - shift);
  return ymd(d);
}
function eventDate(ev) {
  if (!ev.time) return null;
  const d = parseYmd(ev.date);
  const [h, m] = ev.time.split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d;
}
function remindAt(ev) {
  const d = eventDate(ev);
  return d ? new Date(d.getTime() - REMIND_MIN * 60000) : null;
}

const MONTHS = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const WEEKDAYS = ['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота'];
const WEEKDAYS_S = ['вс','пн','вт','ср','чт','пт','сб'];

function humanDate(s) {
  const d = parseYmd(s);
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
function shortDate(s) {
  const d = parseYmd(s);
  return `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/* ---------- хранение ---------- */
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (Array.isArray(data.events)) state.events = data.events.filter(e => e && e.date);
    }
    state.remindersOn = localStorage.getItem(REMIND_KEY) === '1';
  } catch (err) {
    console.warn('не удалось прочитать данные', err);
  }
}
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ version: 1, events: state.events }));
    localStorage.setItem(REMIND_KEY, state.remindersOn ? '1' : '0');
  } catch (err) {
    toast('Не получилось сохранить 😕');
    console.warn(err);
  }
}

/* ---------- мелкие хелперы ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2100);
}
function uid() {
  return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function titleOf(ev) {
  if (ev.home && ev.away) return `${ev.home} — ${ev.away}`;
  return ev.home || ev.away || 'Матч';
}
function compareEvents(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const at = a.time || '99:99', bt = b.time || '99:99';
  if (at !== bt) return at < bt ? -1 : 1;
  return titleOf(a).localeCompare(titleOf(b), 'ru');
}
function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
function matchesFilter(ev, f) {
  return f === 'all' || ev.status === f;
}
function matchesQuery(ev, q) {
  if (!q) return true;
  const hay = [titleOf(ev), ev.league, ev.note].join(' ').toLowerCase();
  return hay.includes(q);
}
function wantsReminder(ev) {
  return REMIND_STATUSES.includes(ev.status) && !!ev.time;
}
function remindersSupported() {
  return 'Notification' in window && 'serviceWorker' in navigator;
}

/* =========================================================
   НАПОМИНАНИЯ
   ========================================================= */
let remindTimer = null;
const firedThisSession = new Set();

function nextReminder() {
  if (!state.remindersOn) return null;
  const now = Date.now();
  let best = null;
  for (const ev of state.events) {
    if (!wantsReminder(ev)) continue;
    const at = remindAt(ev);
    if (!at) continue;
    if (at.getTime() <= now) continue;
    if (!best || at < best.at) best = { at, ev };
  }
  return best;
}

function scheduleReminders() {
  if (remindTimer) { clearTimeout(remindTimer); remindTimer = null; }
  const next = nextReminder();
  if (state.view === 'data') renderRemindCard();
  if (!next) return;
  const delay = next.at.getTime() - Date.now();
  const capped = Math.min(delay, 2147483000);
  remindTimer = setTimeout(async () => {
    remindTimer = null;
    if (capped < delay) { scheduleReminders(); return; }
    await fireReminder(next.ev);
    scheduleReminders();
  }, Math.max(capped, 0));
}

async function fireReminder(ev) {
  if (firedThisSession.has(ev.id)) return;
  firedThisSession.add(ev.id);

  const at = eventDate(ev);
  const body = [
    ev.league ? `[${ev.league}] ` : '',
    at ? at.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '',
    ev.note ? `\n${ev.note}` : ''
  ].join('').trim() || 'Скоро начало';

  const title = titleOf(ev);

  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg && reg.showNotification) {
      await reg.showNotification(title, {
        body,
        icon: 'icon-192.png',
        badge: 'icon-192.png',
        tag: 'match-' + ev.id,
        renotify: true,
        vibrate: [120, 60, 120],
        data: { id: ev.id, date: ev.date }
      });
      return;
    }
  } catch (err) {
    console.warn('sw notification не сработал', err);
  }

  try {
    new Notification(title, { body, icon: 'icon-192.png', tag: 'match-' + ev.id });
  } catch (err) {
    console.warn(err);
    toast(`Скоро: ${title}`);
  }
}

async function enableReminders() {
  if (!remindersSupported()) {
    toast('Этот браузер не умеет уведомления');
    return false;
  }
  let perm = Notification.permission;
  if (perm === 'default') perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    toast(perm === 'denied'
      ? 'Уведомления запрещены в настройках браузера'
      : 'Разрешение не выдано');
    state.remindersOn = false;
    save();
    renderRemindCard();
    return false;
  }
  state.remindersOn = true;
  save();
  renderRemindCard();
  scheduleReminders();
  const n = countUpcomingReminders();
  toast(n ? `Включено, напомню про ${n} ${plural(n, 'матч', 'матча', 'матчей')}`
          : 'Включено — но пока не о чем напоминать');
  return true;
}

function disableReminders() {
  state.remindersOn = false;
  save();
  if (remindTimer) { clearTimeout(remindTimer); remindTimer = null; }
  renderRemindCard();
  toast('Напоминания выключены');
}

function countUpcomingReminders() {
  const now = Date.now();
  return state.events.filter(ev => {
    if (!wantsReminder(ev)) return false;
    const at = remindAt(ev);
    return at && at.getTime() > now;
  }).length;
}

function renderRemindCard() {
  const supported = remindersSupported();
  const granted = supported && Notification.permission === 'granted';
  const status = $('remindStatus');
  const btn = $('remindToggle');
  if (!status || !btn) return;

  if (!supported) {
    status.textContent = 'Браузер не поддерживает уведомления. Но напоминания попадут в календарь через экспорт .ics ниже.';
    btn.textContent = 'Недоступно';
    btn.disabled = true;
    btn.classList.remove('primary');
    return;
  }
  if (!state.remindersOn) {
    status.textContent = granted
      ? 'Выключены. Включи — и за час до матчей «иду» и «смотрю» придёт уведомление.'
      : 'Нужно разрешение на уведомления. За час до матчей «иду» и «смотрю» придёт напоминание.';
    btn.textContent = 'Включить';
    btn.disabled = false;
    btn.classList.add('primary');
  } else {
    const n = countUpcomingReminders();
    const next = nextReminder();
    let when = '';
    if (next) {
      const d = next.at;
      const isToday = ymd(d) === todayYmd();
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      when = ` Ближайшее напоминание — ${isToday ? 'сегодня' : shortDate(ymd(d))} в ${hh}:${mm}.`;
    }
    status.textContent = n
      ? `Включены. Напомню про ${n} ${plural(n, 'матч', 'матча', 'матчей')}.${when}`
      : 'Включены, но впереди нет матчей «иду» или «смотрю» со временем.';
    btn.textContent = 'Выключить';
    btn.disabled = false;
    btn.classList.remove('primary');
  }
}

async function testReminder() {
  if (!remindersSupported()) { toast('Браузер не умеет уведомления'); return; }
  if (Notification.permission !== 'granted') {
    const ok = await enableReminders();
    if (!ok) return;
  }
  const probe = {
    id: 'test-' + Date.now(),
    date: todayYmd(),
    time: '00:00',
    league: 'КХЛ',
    home: 'Сибирь',
    away: 'Авангард',
    note: 'Так будет выглядеть напоминание за час до матча'
  };
  await fireReminder(probe);
  toast('Отправила тестовое уведомление');
}

/* =========================================================
   РЕНДЕР
   ========================================================= */
function render() {
  renderStrip();
  renderDay();
  renderAll();
  renderData();
}

function renderStrip() {
  const strip = $('strip');
  const mon = mondayOf(state.day);
  const today = todayYmd();
  const busy = new Set(state.events.filter(e => e.status !== 'skip').map(e => e.date));
  let html = '';
  for (let i = 0; i < 7; i++) {
    const d = addDays(mon, i);
    const dt = parseYmd(d);
    const cls = ['daychip'];
    if (d === today) cls.push('today');
    if (d === state.day) cls.push('sel');
    if (busy.has(d)) cls.push('has');
    html += `<button class="${cls.join(' ')}" data-day="${d}">
      <span class="wd">${WEEKDAYS_S[dt.getDay()]}</span>
      <b>${dt.getDate()}</b>
      <span class="dot"></span>
    </button>`;
  }
  strip.innerHTML = html;
  const sel = strip.querySelector('.sel');
  if (sel) sel.scrollIntoView({ block: 'nearest', inline: 'center' });
}

let conflictMap = {};

function minutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
const MATCH_LEN = 150;

function buildConflicts(list) {
  const map = {};
  const timed = list.filter(e => e.time && e.status !== 'skip');
  for (let i = 0; i < timed.length; i++) {
    const a = timed[i], aStart = minutes(a.time), aEnd = aStart + MATCH_LEN;
    for (let j = i + 1; j < timed.length; j++) {
      const b = timed[j];
      if (a.date !== b.date) continue;
      const bStart = minutes(b.time), bEnd = bStart + MATCH_LEN;
      if (aStart < bEnd && bStart < aEnd) {
        if (!map[a.id]) map[a.id] = b;
        if (!map[b.id]) map[b.id] = a;
      }
    }
  }
  return map;
}

function renderDay() {
  const head = $('dayHead');
  const list = $('dayList');
  renderFilterBar($('filtersDay'), state.filter);

  const all = state.events.filter(e => e.date === state.day);
  const shown = all.filter(e => matchesFilter(e, state.filter)).sort(compareEvents);
  conflictMap = buildConflicts(shown);

  const isToday = state.day === todayYmd();
  const cnt = shown.length
    ? ` ${shown.length} ${plural(shown.length, 'матч', 'матча', 'матчей')}`
    : ' пусто';
  head.textContent = `${isToday ? 'сегодня · ' : ''}${humanDate(state.day)} ·${cnt}`;

  if (!shown.length) {
    list.innerHTML = `<div class="empty"><b>${all.length ? 'Тут пусто по фильтру' : 'На этот день пусто'}</b>
      ${all.length ? 'Попробуй снять фильтр категории.' : 'Нажми «+», чтобы добавить матч.'}</div>`;
    return;
  }
  list.innerHTML = shown.map(evCard).join('');
}

function evCard(ev) {
  const st = STATUS[ev.status] || STATUS.watch;
  const moved = (ev.history && ev.history.length)
    ? `<span class="moved">↗ перенос с ${shortDate(ev.history[ev.history.length - 1].from)}</span>` : '';
  const clash = conflictMap[ev.id]
    ? `<div class="ev-meta"><span class="clash" title="Накладывается по времени">⚡ и ещё ${esc(titleOf(conflictMap[ev.id]))}</span></div>` : '';
  const bell = (state.remindersOn && wantsReminder(ev))
    ? `<span class="bell" title="Напомню за час">🔔 за час</span>` : '';
  const timeBlock = ev.time
    ? `<div class="ev-time">${esc(ev.time.slice(0, 5))}</div>`
    : `<div class="ev-time"><small>без врем.</small></div>`;

  return `<article class="ev ${esc(ev.status)}" data-id="${esc(ev.id)}">
    ${timeBlock}
    <div class="ev-body">
      <div class="ev-title">${esc(titleOf(ev))}</div>
      <div class="ev-meta">
        <span class="st-badge" title="${esc(st.label)}">${st.icon}</span>
        ${ev.league ? `<span class="league">${esc(ev.league)}</span>` : ''}
        ${bell}
        ${moved}
      </div>
      ${clash}
      ${ev.note ? `<div class="ev-note">${esc(ev.note)}</div>` : ''}
    </div>
  </article>`;
}

function renderAll() {
  renderFilterBar($('filtersAll'), state.filterAll);

  const q = state.query.trim().toLowerCase();
  const today = todayYmd();
  let list = state.events.filter(e => matchesFilter(e, state.filterAll) && matchesQuery(e, q));

  if (state.scope === 'upcoming') list = list.filter(e => e.date >= today);
  else if (state.scope === 'past') list = list.filter(e => e.date < today);

  list.sort(compareEvents);
  if (state.scope === 'past') list.reverse();

  const box = $('allList');
  if (!list.length) {
    box.innerHTML = `<div class="empty"><b>Ничего не нашлось</b>Смени фильтры, стадию или запрос.</div>`;
    return;
  }

  let html = '', lastDate = null, blockOpen = false;
  for (const ev of list) {
    if (ev.date !== lastDate) {
      if (blockOpen) html += '</div>';
      const cls = ev.date === today ? 'date-group today' : 'date-group';
      html += `<div class="${cls}"><h4>${ev.date === today ? 'сегодня · ' : ''}${humanDate(ev.date)}</h4>`;
      blockOpen = true;
      lastDate = ev.date;
    }
    html += evCard(ev);
  }
  if (blockOpen) html += '</div>';
  box.innerHTML = html;
}

function renderFilterBar(container, active) {
  const items = [['all', 'все']].concat(STATUS_ORDER.map(k => [k, STATUS[k].icon + ' ' + STATUS[k].label]));
  container.innerHTML = items.map(([k, label]) =>
    `<button class="fchip ${active === k ? 'on' : ''}" data-fkey="${k}">${esc(label)}</button>`
  ).join('');
}

function renderData() {
  const total = state.events.length;
  const today = todayYmd();
  const ahead = state.events.filter(e => e.date >= today && e.status !== 'skip').length;
  const attend = state.events.filter(e => e.status === 'attend').length;
  $('stats').innerHTML = `
    <div class="stat"><b>${total}</b><span>всего</span></div>
    <div class="stat"><b>${ahead}</b><span>впереди</span></div>
    <div class="stat"><b>${attend}</b><span>иду</span></div>`;

  // лиги
  const usedLeagues = new Set(state.events.map(e => (e.league || '').trim()).filter(Boolean));
  const mineL = PRESET_LEAGUES.filter(l => usedLeagues.has(l));
  const otherL = [...usedLeagues].filter(l => !PRESET_LEAGUES.includes(l)).sort((a, b) => a.localeCompare(b, 'ru'));
  const unusedL = PRESET_LEAGUES.filter(l => !usedLeagues.has(l));

  $('leaguesList').innerHTML = [
    ...mineL.map(l => `<span class="chip mine">${esc(l)}</span>`),
    ...otherL.map(l => `<span class="chip">${esc(l)}</span>`),
    ...unusedL.map(l => `<span class="chip ghost">${esc(l)}</span>`)
  ].join('') || `<span class="muted" style="font-size:13px">пока пусто</span>`;

  // команды
  const usedTeams = new Set();
  state.events.forEach(e => {
    if (e.home) usedTeams.add(e.home.trim());
    if (e.away) usedTeams.add(e.away.trim());
  });
  const mineT = PRESET_TEAMS.filter(t => usedTeams.has(t));
  const otherT = [...usedTeams].filter(t => t && !PRESET_TEAMS.includes(t)).sort((a, b) => a.localeCompare(b, 'ru'));
  const unusedT = PRESET_TEAMS.filter(t => !usedTeams.has(t));

  $('teamsList').innerHTML = [
    ...mineT.map(t => `<span class="chip mine">${esc(t)}</span>`),
    ...otherT.map(t => `<span class="chip">${esc(t)}</span>`),
    ...unusedT.map(t => `<span class="chip ghost">${esc(t)}</span>`)
  ].join('') || `<span class="muted" style="font-size:13px">пока пусто</span>`;

  // datalist-ы
  $('leagueDatalist').innerHTML = [...new Set([...PRESET_LEAGUES, ...otherL])]
    .map(l => `<option value="${esc(l)}">`).join('');
  $('teamDatalist').innerHTML = [...new Set([...PRESET_TEAMS, ...otherT])]
    .map(t => `<option value="${esc(t)}">`).join('');

  renderRemindCard();
}

/* =========================================================
   НАВИГАЦИЯ
   ========================================================= */
function switchView(view) {
  state.view = view;
  ['day', 'all', 'data'].forEach(v => $('view-' + v).classList.toggle('hidden', v !== view));
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.view === view));
  const subs = { day: 'планировщик матчей', all: 'все матчи списком', data: 'копии и настройки' };
  $('topSub').textContent = subs[view];
  window.scrollTo({ top: 0 });
  if (view === 'day') renderDay();
  if (view === 'all') renderAll();
  if (view === 'data') renderData();
}

function goDay(d) {
  state.day = d;
  renderStrip();
  renderDay();
  const sel = $('strip').querySelector('.sel');
  if (sel) sel.scrollIntoView({ block: 'nearest', inline: 'center' });
}

/* =========================================================
   ФОРМА: пресеты
   ========================================================= */
let activeTeamField = 'f-home';

function renderLeaguePresets(active) {
  const cur = (active != null ? active : $('f-league').value || '').trim().toLowerCase();
  $('leaguePresets').innerHTML = PRESET_LEAGUES.map(l =>
    `<button type="button" class="preset ${cur === l.toLowerCase() ? 'on' : ''}" data-league="${esc(l)}">${esc(l)}</button>`
  ).join('');
}

function renderTimePresets() {
  const cur = $('f-time').value || '';
  $('timePresets').innerHTML = PRESET_TIMES.map(t =>
    `<button type="button" class="preset ${cur === t ? 'on' : ''}" data-time="${t}">${esc(t)}</button>`
  ).join('');
}

function renderTeamPresets() {
  const home = ($('f-home').value || '').trim().toLowerCase();
  const away = ($('f-away').value || '').trim().toLowerCase();
  $('teamPresets').innerHTML = PRESET_TEAMS.map(t => {
    const low = t.toLowerCase();
    const on = low === home || low === away;
    return `<button type="button" class="preset ${on ? 'on' : ''}" data-team="${esc(t)}">${esc(t)}</button>`;
  }).join('');
}

/* Тап по команде: сначала в поле, где стоит курсор, потом в первое пустое */
function pickTeam(name) {
  const home = $('f-home');
  const away = $('f-away');
  const active = $(activeTeamField);

  let target = null;
  if (active && !active.value.trim()) target = active;
  if (!target) target = !home.value.trim() ? home : (!away.value.trim() ? away : (active || home));

  target.value = name;

  // курсор — в следующее пустое поле, чтобы вторую команду тапнуть сразу
  const next = !home.value.trim() ? home : (!away.value.trim() ? away : null);
  if (next) {
    activeTeamField = next.id;
    next.focus();
  } else {
    activeTeamField = target.id;
    target.focus();
  }
  renderTeamPresets();
}

function openSheet(id) {
  state.editId = id || null;
  const ev = id ? state.events.find(e => e.id === id) : null;
  $('sheetTitle').textContent = ev ? 'Править матч' : 'Новый матч';
  $('f-date').value = ev ? ev.date : state.day;
  $('f-time').value = ev && ev.time ? ev.time : '';
  $('f-league').value = ev ? (ev.league || '') : '';
  $('f-home').value = ev ? (ev.home || '') : '';
  $('f-away').value = ev ? (ev.away || '') : '';
  $('f-note').value = ev ? (ev.note || '') : '';
  setFormStatus(ev ? ev.status : 'watch');
  renderLeaguePresets(ev ? ev.league : '');
  renderTimePresets();
  activeTeamField = $('f-home').value.trim() ? 'f-away' : 'f-home';
  renderTeamPresets();
  $('deleteBtn').classList.toggle('hidden', !ev);
  $('dupBtn').classList.toggle('hidden', !ev);
  $('moveHint').textContent = (ev && ev.history && ev.history.length)
    ? `Матч уже переносили (${ev.history.length} раз). Прежняя дата: ${shortDate(ev.history[ev.history.length - 1].from)}`
    : '';
  $('sheetWrap').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  setTimeout(() => { if (!ev) $('f-home').focus(); }, 220);
}

function closeSheet() {
  $('sheetWrap').classList.add('hidden');
  document.body.style.overflow = '';
  state.editId = null;
}

function setFormStatus(st) {
  state.formStatus = st;
  $('statusRow').querySelectorAll('.st').forEach(b => b.classList.toggle('on', b.dataset.st === st));
}

function submitForm(e) {
  e.preventDefault();
  const date = $('f-date').value;
  if (!date) { toast('Нужна дата'); return; }
  const data = {
    date,
    time: $('f-time').value || '',
    league: $('f-league').value.trim(),
    home: $('f-home').value.trim(),
    away: $('f-away').value.trim(),
    note: $('f-note').value.trim(),
    status: state.formStatus
  };
  if (!data.home && !data.away) { toast('Напиши хотя бы одну команду'); $('f-home').focus(); return; }

  if (state.editId) {
    const ev = state.events.find(x => x.id === state.editId);
    if (ev) {
      const moved = ev.date !== data.date;
      if (moved) {
        ev.history = ev.history || [];
        ev.history.push({ from: ev.date, to: data.date, at: new Date().toISOString() });
      }
      Object.assign(ev, data, { updatedAt: new Date().toISOString() });
      toast(moved ? 'Перенесено' : 'Сохранено');
    }
  } else {
    state.events.push(Object.assign({ id: uid(), created: new Date().toISOString() }, data));
    toast('Добавлено');
  }
  save();
  state.day = date;
  closeSheet();
  render();
  scheduleReminders();
  if (state.view !== 'day') switchView('day');
}

function deleteCurrent() {
  const ev = state.events.find(e => e.id === state.editId);
  if (!ev) return;
  if (!confirm(`Удалить «${titleOf(ev)}» (${shortDate(ev.date)})?`)) return;
  state.events = state.events.filter(e => e.id !== ev.id);
  save(); closeSheet(); render(); scheduleReminders();
  toast('Удалено');
}

function duplicateCurrent() {
  const ev = state.events.find(e => e.id === state.editId);
  if (!ev) return;
  const copy = Object.assign({}, ev, {
    id: uid(),
    history: [],
    created: new Date().toISOString()
  });
  state.events.push(copy);
  save();
  openSheet(copy.id);
  render();
  toast('Копия создана — поправь дату и сохрани');
}

/* =========================================================
   ЭКСПОРТ / ИМПОРТ
   ========================================================= */
function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 800);
}

function exportJson() {
  download(`hockey-backup-${todayYmd()}.json`,
    JSON.stringify({ version: 1, exported: new Date().toISOString(), events: state.events }, null, 2),
    'application/json');
  toast('Копия скачана');
}

function importJson(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result));
      const incoming = Array.isArray(data) ? data : data.events;
      if (!Array.isArray(incoming)) throw new Error('нет списка events');
      let added = 0, updated = 0;
      for (const raw of incoming) {
        if (!raw || !raw.date) continue;
        const ev = {
          id: raw.id || uid(),
          date: String(raw.date).slice(0, 10),
          time: raw.time || '',
          league: raw.league || '',
          home: raw.home || '',
          away: raw.away || '',
          note: raw.note || '',
          status: STATUS[raw.status] ? raw.status : 'watch',
          history: Array.isArray(raw.history) ? raw.history : [],
          created: raw.created || new Date().toISOString(),
          updatedAt: raw.updatedAt || ''
        };
        const i = state.events.findIndex(x => x.id === ev.id);
        if (i === -1) { state.events.push(ev); added++; }
        else if ((ev.updatedAt || '') >= (state.events[i].updatedAt || '')) { state.events[i] = ev; updated++; }
      }
      save(); render(); scheduleReminders();
      toast(`Загружено: +${added}${updated ? ', обновлено ' + updated : ''}`);
    } catch (err) {
      toast('Файл не подошёл');
      console.warn(err);
    }
  };
  reader.readAsText(file);
}

function icsEscape(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function exportIcs() {
  const today = todayYmd();
  const items = state.events
    .filter(e => e.status !== 'skip' && e.date >= today)
    .sort(compareEvents);
  if (!items.length) { toast('Нет предстоящих матчей'); return; }

  const stamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Hockey Planner//RU',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Хоккей'
  ];

  let withAlarm = 0;
  for (const ev of items) {
    const d = ev.date.replace(/-/g, '');
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${ev.id}@hockey-planner`);
    lines.push(`DTSTAMP:${stamp}`);
    if (ev.time) {
      const t = ev.time.replace(':', '') + '00';
      const end = new Date(eventDate(ev).getTime() + MATCH_LEN * 60000);
      lines.push(`DTSTART:${d}T${t}`);
      lines.push(`DTEND:${ymd(end).replace(/-/g, '')}T${String(end.getHours()).padStart(2, '0')}${String(end.getMinutes()).padStart(2, '0')}00`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${d}`);
      lines.push(`DTEND;VALUE=DATE:${addDays(ev.date, 1).replace(/-/g, '')}`);
    }
    const summary = [ev.league ? `[${ev.league}]` : '', titleOf(ev)].filter(Boolean).join(' ');
    lines.push(`SUMMARY:${icsEscape(summary)}`);
    if (ev.note) lines.push(`DESCRIPTION:${icsEscape(ev.note)}`);
    lines.push(`CATEGORIES:${icsEscape(STATUS[ev.status] ? STATUS[ev.status].label : '')}`);
    if (ev.status === 'attend') lines.push('TRANSP:OPAQUE');

    if (wantsReminder(ev)) {
      lines.push('BEGIN:VALARM');
      lines.push('TRIGGER:-PT60M');
      lines.push('ACTION:DISPLAY');
      lines.push(`DESCRIPTION:${icsEscape(summary + ' — начинается через час')}`);
      lines.push('END:VALARM');
      withAlarm++;
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');

  download(`hockey-${todayYmd()}.ics`, lines.join('\r\n'), 'text/calendar;charset=utf-8');
  toast(`Готово: ${items.length} ${plural(items.length, 'матч', 'матча', 'матчей')}, с напоминанием ${withAlarm}`);
}

/* =========================================================
   СОБЫТИЯ ИНТЕРФЕЙСА
   ========================================================= */
function bind() {
  document.querySelectorAll('.tab').forEach(t =>
    t.addEventListener('click', () => switchView(t.dataset.view)));

  $('addBtn').addEventListener('click', () => openSheet(null));
  $('cancelBtn').addEventListener('click', closeSheet);
  $('sheetBg').addEventListener('click', closeSheet);
  $('form').addEventListener('submit', submitForm);
  $('deleteBtn').addEventListener('click', deleteCurrent);
  $('dupBtn').addEventListener('click', duplicateCurrent);

  $('statusRow').addEventListener('click', e => {
    const b = e.target.closest('.st');
    if (b) setFormStatus(b.dataset.st);
  });

  // лиги
  $('leaguePresets').addEventListener('click', e => {
    const b = e.target.closest('.preset');
    if (!b) return;
    $('f-league').value = b.dataset.league;
    renderLeaguePresets(b.dataset.league);
  });
  $('f-league').addEventListener('input', e => renderLeaguePresets(e.target.value));

  // время
  $('timePresets').addEventListener('click', e => {
    const b = e.target.closest('.preset');
    if (!b) return;
    $('f-time').value = b.dataset.time;
    renderTimePresets();
  });
  $('f-time').addEventListener('input', renderTimePresets);

  // команды
  $('teamPresets').addEventListener('click', e => {
    const b = e.target.closest('.preset');
    if (!b) return;
    pickTeam(b.dataset.team);
  });
  ['f-home', 'f-away'].forEach(id => {
    $(id).addEventListener('focus', () => { activeTeamField = id; });
    $(id).addEventListener('input', renderTeamPresets);
  });

  // неделя
  $('prevWeek').addEventListener('click', () => goDay(addDays(state.day, -7)));
  $('nextWeek').addEventListener('click', () => goDay(addDays(state.day, 7)));
  $('jumpToday').addEventListener('click', () => { goDay(todayYmd()); switchView('day'); });
  $('openPicker').addEventListener('click', e => {
    const p = $('datePicker');
    if (p.showPicker) {
      e.preventDefault();
      p.value = state.day;
      try { p.showPicker(); } catch (_) { p.click(); }
    }
  });
  $('datePicker').addEventListener('change', e => { if (e.target.value) { goDay(e.target.value); switchView('day'); } });

  $('strip').addEventListener('click', e => {
    const b = e.target.closest('.daychip');
    if (b) goDay(b.dataset.day);
  });

  $('filtersDay').addEventListener('click', e => {
    const b = e.target.closest('[data-fkey]');
    if (!b) return;
    state.filter = b.dataset.fkey;
    renderDay();
  });
  $('filtersAll').addEventListener('click', e => {
    const b = e.target.closest('[data-fkey]');
    if (!b) return;
    state.filterAll = b.dataset.fkey;
    renderAll();
  });
  $('scopeSwitch').addEventListener('click', e => {
    const b = e.target.closest('[data-scope]');
    if (!b) return;
    state.scope = b.dataset.scope;
    $('scopeSwitch').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    renderAll();
  });

  $('search').addEventListener('input', e => { state.query = e.target.value; renderAll(); });

  document.addEventListener('click', e => {
    const card = e.target.closest('.ev');
    if (card && card.dataset.id) openSheet(card.dataset.id);
  });

  $('remindToggle').addEventListener('click', () => {
    if (state.remindersOn) disableReminders();
    else enableReminders();
  });
  $('testRemind').addEventListener('click', testReminder);

  $('exportJson').addEventListener('click', exportJson);
  $('importJson').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    if (f) importJson(f);
    e.target.value = '';
  });
  $('exportIcs').addEventListener('click', exportIcs);
  $('wipe').addEventListener('click', () => {
    if (!state.events.length) { toast('И так пусто'); return; }
    if (!confirm(`Удалить все ${state.events.length} событий? Отменить будет нельзя — сначала сделай копию.`)) return;
    state.events = [];
    save(); render(); scheduleReminders();
    toast('Всё удалено');
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('sheetWrap').classList.contains('hidden')) closeSheet();
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { scheduleReminders(); render(); }
  });
}

/* ---------- старт ---------- */
load();
bind();
render();
switchView('day');
scheduleReminders();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
  navigator.serviceWorker.addEventListener('message', e => {
    const msg = e.data || {};
    if (msg.type === 'notificationclick' && msg.id) {
      const ev = state.events.find(x => x.id === msg.id);
      if (ev) { goDay(ev.date); switchView('day'); }
    }
  });
}
