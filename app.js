/* Расписание НПК — app.js v5.0 (недели из файлов, корректные даты) */

const SITE_URL = 'https://politech-nsk.ru/index.php/studentam';
const BASE_URL = 'https://politech-nsk.ru';
const PROXY = 'https://schedule-proxy.ivanushca99.workers.dev/?url=';
const APP_VERSION = '5.0';
const DAY_MS = 86400000;

const DAYS = ['ВОСКРЕСЕНЬЕ', 'ПОНЕДЕЛЬНИК', 'ВТОРНИК', 'СРЕДА', 'ЧЕТВЕРГ', 'ПЯТНИЦА', 'СУББОТА'];
const WEEK_DAYS = ['ПОНЕДЕЛЬНИК', 'ВТОРНИК', 'СРЕДА', 'ЧЕТВЕРГ', 'ПЯТНИЦА', 'СУББОТА'];

const BELLS = [
    { num: 1, halves: ['8:30 - 9:15', '9:25 - 10:10'] },
    { num: 2, halves: ['10:30 - 11:15', '11:25 - 12:10'] },
    { num: 3, halves: ['12:40 - 13:25', '13:35 - 14:20'] },
    { num: 4, halves: ['14:30 - 15:15', '15:25 - 16:10'] },
    { num: 5, halves: ['16:20 - 17:05', '17:15 - 18:00'] },
    { num: 6, halves: ['18:10 - 18:55', '19:05 - 19:50'] }
];

let weeks = [];
let activeWeekKey = null;
let sheets = [];
let groupsDatabase = {};
let groupsList = [];
let selectedGroupIndex = 0;
let currentViewMode = localStorage.getItem('viewMode') === 'week' ? 'week' : 'day';
let currentTab = 'schedule';
let attendanceData = loadJSON('attendance', {});
let attendanceThreshold = (function () {
    const v = parseInt(localStorage.getItem('attThreshold'), 10);
    return Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 70;
})();
let lastUpdated = null;
let demoMode = false;
let statusBanner = null;
let isRefreshing = false;
let showTodayOverride = false;
let lastDateStr = getTodayString();
let courseFilter = localStorage.getItem('courseFilter') || 'all';
let searchQuery = '';
let pendingTheme = null;
let pendingGroupIdx = null;

/* ---------- Утилиты ---------- */

function loadJSON(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        const val = JSON.parse(raw);
        return (val && typeof val === 'object' && !Array.isArray(val)) ? val : fallback;
    } catch (e) { return fallback; }
}

function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function pad2(n) { return String(n).padStart(2, '0'); }
function dateToStr(d) { return pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + '.' + d.getFullYear(); }
function shortDate(d) { return pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1); }
function dateOnly(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function mondayOf(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); return addDays(x, -((x.getDay() + 6) % 7)); }
function weekMonday() { return mondayOf(new Date()); }
function fallbackMonday() { const n = new Date(); return n.getDay() === 0 ? addDays(mondayOf(n), 7) : mondayOf(n); }
function getTodayString() { return dateToStr(new Date()); }
function safeDecode(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }

function formatDateShort(ts) {
    const d = new Date(ts);
    return shortDate(d) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

function formatAgo(ts) {
    const diff = Date.now() - ts;
    if (diff < 60000) return 'только что';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' мин назад';
    return formatDateShort(ts);
}

function formatMins(m) {
    if (m < 60) return m + ' мин';
    const h = Math.floor(m / 60), mm = m % 60;
    return h + ' ч' + (mm ? ' ' + mm + ' мин' : '');
}

function agoText() {
    if (demoMode) return 'демо-данные';
    if (lastUpdated) return formatAgo(lastUpdated);
    return groupsList.length ? 'из кэша' : '—';
}

/* ---------- Недели: разбор дат из названий файлов ---------- */

function parseWeekRange(source) {
    const s = String(source).replace(/\u00A0/g, ' ');
    const norm = (d, mo, y) => {
        d = +d; mo = +mo;
        if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
        let yy = y == null ? new Date().getFullYear() : +y;
        if (yy < 100) yy += 2000;
        return new Date(yy, mo - 1, d).getTime();
    };
    const m = s.match(/(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?\s*(?:[-–—]|по)\s*(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?/);
    if (m) {
        const a = norm(m[1], m[2], m[3] != null ? m[3] : m[6]);
        const b = norm(m[4], m[5], m[6] != null ? m[6] : m[3]);
        if (a != null && b != null && b >= a) {
            const start = mondayOf(new Date(a));
            return { start: start.getTime(), end: b };
        }
    }
    const single = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
    if (single) {
        const a = norm(single[1], single[2], single[3]);
        if (a != null) { const start = mondayOf(new Date(a)); return { start: start.getTime(), end: addDays(start, 5).getTime() }; }
    }
    const singleNoYear = s.match(/(?:^|[^\d.])(\d{1,2})\.(\d{1,2})(?![\d.])/);
    if (singleNoYear) {
        const a = norm(singleNoYear[1], singleNoYear[2], null);
        if (a != null) { const start = mondayOf(new Date(a)); return { start: start.getTime(), end: addDays(start, 5).getTime() }; }
    }
    return null;
}

function currentWeek() {
    const w = weeks.find(x => x.key === activeWeekKey);
    if (w) return w;
    const start = fallbackMonday();
    return { key: 'fallback', start: start.getTime(), end: addDays(start, 5).getTime(), label: '' };
}

function autoWeekKey() {
    const t = dateOnly(new Date());
    let w = weeks.find(x => t >= x.start && t <= x.end);
    if (!w) w = weeks.find(x => x.start > t);
    if (!w) w = weeks[weeks.length - 1];
    return w ? w.key : null;
}

function setActiveWeek(key) {
    const w = weeks.find(x => x.key === key);
    if (!w) return;
    activeWeekKey = w.key;
    sheets = w.sheets;
    groupsDatabase = w.db;
    groupsList = w.groups;
    const savedName = localStorage.getItem('selectedGroupName');
    let idx = groupsList.findIndex(g => g.name === savedName);
    if (idx === -1) idx = 0;
    selectedGroupIndex = idx;
    if (groupsList[idx]) localStorage.setItem('selectedGroupName', groupsList[idx].name);
    const cur = groupsList[idx];
    if (cur && courseFilter !== 'all' && String(cur.course) !== courseFilter) courseFilter = String(cur.course);
    if (courseFilter !== 'all' && !groupsList.some(g => String(g.course) === courseFilter)) courseFilter = 'all';
}

/* ---------- Темы ---------- */

function currentTheme() {
    const t = localStorage.getItem('theme');
    return (t === 'light' || t === 'oled') ? t : 'dark';
}

function applyTheme(theme) {
    theme = theme || currentTheme();
    document.body.classList.toggle('light', theme === 'light');
    document.body.classList.toggle('oled', theme === 'oled');
    const meta = document.getElementById('meta-theme');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#FFFFFF' : (theme === 'oled' ? '#000000' : '#1C1B1F'));
}

/* ---------- iOS-подсказка ---------- */

function initIOSHint() {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
        navigator.standalone === true;
    const hint = document.getElementById('ios-hint');
    if (isIOS && !standalone && localStorage.getItem('iosHintDismissed') !== '1') {
        hint.classList.add('show');
    }
    document.getElementById('ios-hint-close').addEventListener('click', () => {
        hint.classList.remove('show');
        localStorage.setItem('iosHintDismissed', '1');
    });
}

/* ---------- Вкладки и вид ---------- */

function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
    document.getElementById('view-toggle').style.display = tab === 'schedule' ? 'inline-block' : 'none';
    renderCurrentTab();
}

function toggleView() {
    if (currentTab !== 'schedule') return;
    currentViewMode = currentViewMode === 'day' ? 'week' : 'day';
    localStorage.setItem('viewMode', currentViewMode);
    renderSchedule();
}

function renderCurrentTab() {
    if (currentTab === 'schedule') renderSchedule();
    else if (currentTab === 'attendance') renderAttendance();
    else if (currentTab === 'settings') renderSettings();
}

/* ---------- Курс ---------- */

function detectCourse(groupName, now) {
    now = now || new Date();
    const m = groupName.match(/\d+/);
    if (!m) return 0;
    const last = parseInt(m[0].charAt(m[0].length - 1), 10);
    const startYear = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
    let course = (startYear % 10) - last + 1;
    if (course <= 0) course += 10;
    return (course >= 1 && course <= 4) ? course : 0;
}

/* ---------- Загрузка и парсинг ---------- */

function parseWorkbook(arrayBuffer, target) {
    const wb = XLSX.read(arrayBuffer, { type: 'array' });
    for (const sheetName of wb.SheetNames) {
        const rawData = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
        let sheetId = -1;
        rawData.forEach((row, rowIndex) => {
            row.forEach((cell, colIndex) => {
                if (typeof cell !== 'string') return;
                const name = cell.trim();
                if (name.length > 2 && /^\d{3}\s+[А-ЯЁA-Z]{2,4}/.test(name) && !target.db[name]) {
                    if (sheetId === -1) sheetId = target.sheets.push(rawData) - 1;
                    target.db[name] = { sheetId: sheetId, rowIndex: rowIndex, colIndex: colIndex };
                    target.list.push({ name: name, course: detectCourse(name) });
                }
            });
        });
    }
}

async function refreshSchedules() {
    if (isRefreshing) return;
    isRefreshing = true;
    updateRefreshUI();
    try {
        const res = await fetch(PROXY + encodeURIComponent(SITE_URL));
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const fromCache = res.headers.get('X-From-Cache') === '1';
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');

        const fileInfos = [];
        doc.querySelectorAll('a[href]').forEach(link => {
            const href = link.getAttribute('href') || '';
            const low = href.toLowerCase();
            if (!(low.includes('.xlsx') || low.includes('.xls'))) return;
            const full = href.startsWith('http') ? href : BASE_URL + href;
            if (fileInfos.some(f => f.url === full)) return;
            const range = parseWeekRange(safeDecode(full) + ' ' + (link.textContent || ''));
            fileInfos.push({ url: full, start: range ? range.start : null, end: range ? range.end : null });
        });
        if (!fileInfos.length) throw new Error('На странице не найдено файлов расписания');

        const today0 = dateOnly(new Date());
        const dated = fileInfos.filter(f => f.start != null).sort((a, b) => b.start - a.start);
        const recent = dated.filter(f => f.start >= today0 - 21 * DAY_MS && f.start <= today0 + 35 * DAY_MS);
        let pool = recent.length ? recent : dated.slice(0, 8);
        pool = pool.concat(fileInfos.filter(f => f.start == null)).slice(0, 16);
        if (!pool.length) pool = fileInfos.slice(0, 16);

        const results = await Promise.allSettled(pool.map(async f => {
            const r = await fetch(PROXY + encodeURIComponent(f.url));
            if (!r.ok) throw new Error('HTTP ' + r.status + ' для ' + f.url);
            const lm = r.headers.get('Last-Modified');
            const buf = await r.arrayBuffer();
            return { buf: buf, lm: lm };
        }));

        const weekMap = new Map();
        results.forEach((r, i) => {
            if (r.status !== 'fulfilled') { console.warn('Ошибка загрузки файла', r.reason); return; }
            const f = pool[i];
            let start = f.start, end = f.end;
            if (start == null && r.value.lm) {
                const d = new Date(r.value.lm);
                if (!isNaN(d.getTime())) { const m = mondayOf(d); start = m.getTime(); end = addDays(m, 5).getTime(); }
            }
            const key = start != null ? String(start) : 'nodate';
            if (!weekMap.has(key)) weekMap.set(key, { key: key, start: start, end: end, sheets: [], db: {}, list: [] });
            try { parseWorkbook(r.value.buf, weekMap.get(key)); }
            catch (e) { console.warn('Ошибка парсинга файла', e); }
        });

        let newWeeks = [...weekMap.values()].filter(w => w.list.length);
        if (!newWeeks.length) throw new Error('Не удалось распознать ни одной группы');

        newWeeks.forEach(w => {
            w.groups = w.list.sort((a, b) =>
                (a.course || 99) - (b.course || 99) || a.name.localeCompare(b.name, 'ru'));
            delete w.list;
            if (w.start == null) {
                const m = fallbackMonday();
                w.start = m.getTime();
                w.end = addDays(m, 5).getTime();
                w.label = 'Без даты';
            } else {
                if (w.end == null) w.end = addDays(new Date(w.start), 5).getTime();
                w.label = shortDate(new Date(w.start)) + ' – ' + shortDate(new Date(w.end));
            }
        });
        newWeeks.sort((a, b) => a.start - b.start);
        weeks = newWeeks;
        demoMode = false;
        showTodayOverride = false;

        if (fromCache) {
            statusBanner = { type: 'warn', text: 'Нет сети — показано расписание из кэша браузера.' };
        } else {
            lastUpdated = Date.now();
            statusBanner = null;
            saveSnapshot();
        }

        setActiveWeek(autoWeekKey());
        switchTab(currentTab);
    } catch (e) {
        console.warn('Обновление не удалось:', e);
        if (groupsList.length && !demoMode) {
            statusBanner = {
                type: 'warn',
                text: 'Не удалось обновить расписание. Показаны сохранённые данные' +
                    (lastUpdated ? ' от ' + formatDateShort(lastUpdated) : '') + '.'
            };
            renderCurrentTab();
        } else {
            enableDemoMode();
        }
    } finally {
        isRefreshing = false;
        updateRefreshUI();
        updateUpdatedLabel();
    }
}

function enableDemoMode() {
    demoMode = true;
    const m = fallbackMonday();
    weeks = [{
        key: 'demo',
        start: m.getTime(),
        end: addDays(m, 5).getTime(),
        label: 'Демо',
        sheets: [[
            ['День', 'Пара', 'Время', 'Группа'],
            ['ПОНЕДЕЛЬНИК', '1', '8:30 - 9:15', 'Демо-предмет', 'Боцман А.Д.', '305'],
            ['ВТОРНИК', '2', '10:30 - 11:15', 'Демо-предмет', 'Сологуб И.М.', '406']
        ]],
        db: { '224 СА (Демо)': { sheetId: 0, rowIndex: 1, colIndex: 3 } },
        groups: [{ name: '224 СА (Демо)', course: 2 }]
    }];
    statusBanner = { type: 'error', text: 'Сайт колледжа временно недоступен. Показано демо-расписание.' };
    setActiveWeek('demo');
    switchTab(currentTab);
}

/* ---------- Снапшот ---------- */

function packWeek(w) {
    return {
        key: w.key, start: w.start, end: w.end, label: w.label, sheets: w.sheets,
        groups: w.groups.map(g => {
            const ref = w.db[g.name];
            return { name: g.name, course: g.course, sheetId: ref.sheetId, rowIndex: ref.rowIndex, colIndex: ref.colIndex };
        })
    };
}

function saveSnapshot() {
    try {
        localStorage.setItem('scheduleCache', JSON.stringify({ v: 5, t: lastUpdated, activeWeekKey: activeWeekKey, weeks: weeks.map(packWeek) }));
    } catch (e) {
        try {
            const w = weeks.find(x => x.key === activeWeekKey);
            localStorage.setItem('scheduleCache', JSON.stringify({ v: 5, t: lastUpdated, activeWeekKey: activeWeekKey, weeks: w ? [packWeek(w)] : [] }));
        } catch (e2) { console.warn('Кэш расписания не сохранён:', e2); }
    }
}

function loadSnapshot() {
    try {
        const raw = localStorage.getItem('scheduleCache');
        if (!raw) return false;
        const data = JSON.parse(raw);
        if (!data || !Array.isArray(data.weeks) || !data.weeks.length) return false;
        weeks = [];
        data.weeks.forEach(w => {
            if (!w || !Array.isArray(w.sheets) || !Array.isArray(w.groups)) return;
            const db = {};
            const groups = [];
            w.groups.forEach(g => {
                if (!g || typeof g.name !== 'string' || !w.sheets[g.sheetId]) return;
                db[g.name] = { sheetId: g.sheetId, rowIndex: g.rowIndex, colIndex: g.colIndex };
                groups.push({ name: g.name, course: g.course || 0 });
            });
            if (!groups.length) return;
            weeks.push({ key: String(w.key), start: w.start, end: w.end, label: w.label || '', sheets: w.sheets, db: db, groups: groups });
        });
        if (!weeks.length) return false;
        lastUpdated = typeof data.t === 'number' ? data.t : null;
        const key = data.activeWeekKey && weeks.some(w => w.key === String(data.activeWeekKey)) ? String(data.activeWeekKey) : autoWeekKey();
        setActiveWeek(key);
        return true;
    } catch (e) { return false; }
}

/* ---------- Выбор группы ---------- */

function selectGroup(i) {
    if (!groupsList[i]) return;
    selectedGroupIndex = i;
    localStorage.setItem('selectedGroupName', groupsList[i].name);
    const byCourse = loadJSON('lastGroupByCourse', {});
    byCourse[String(groupsList[i].course)] = groupsList[i].name;
    try { localStorage.setItem('lastGroupByCourse', JSON.stringify(byCourse)); } catch (e) {}
    const old = document.getElementById('groups-row');
    if (old) {
        old.replaceWith(renderGroupsRow());
        scrollActiveGroupIntoView();
    }
    renderScheduleResults();
}

function renderGroupsRow() {
    const row = document.createElement('div');
    row.className = 'groups-row';
    row.id = 'groups-row';
    const list = groupsList
        .map((g, i) => ({ g: g, i: i }))
        .filter(x => courseFilter === 'all' || String(x.g.course) === courseFilter);
    if (!list.length) {
        row.innerHTML = '<div class="groups-empty">Нет групп этого курса</div>';
        return row;
    }
    list.forEach(x => {
        const b = document.createElement('button');
        b.className = 'group-pill' + (x.i === selectedGroupIndex ? ' active' : '');
        b.textContent = x.g.name;
        b.addEventListener('click', () => selectGroup(x.i));
        row.appendChild(b);
    });
    return row;
}

function scrollActiveGroupIntoView() {
    const row = document.getElementById('groups-row');
    if (!row) return;
    const active = row.querySelector('.group-pill.active');
    if (!active) return;
    row.scrollLeft = Math.max(0, active.offsetLeft - (row.clientWidth - active.clientWidth) / 2);
}

/* ---------- Баннер ---------- */

function makeBanner(b) {
    const div = document.createElement('div');
    div.className = 'banner ' + b.type;
    div.innerHTML = '<span>' + esc(b.text) + '</span><button class="btn banner-retry">Повторить</button>';
    div.querySelector('.banner-retry').addEventListener('click', () => refreshSchedules());
    return div;
}

/* ---------- Недели: чипы ---------- */

function renderWeeksRow() {
    const row = document.createElement('div');
    row.className = 'weeks-row';
    row.id = 'weeks-row';
    const t = dateOnly(new Date());
    weeks.forEach(w => {
        const b = document.createElement('button');
        const isCurrent = t >= w.start && t <= w.end;
        const isPast = w.end < t;
        b.className = 'week-chip' + (w.key === activeWeekKey ? ' active' : '') + (isPast ? ' past' : '');
        b.innerHTML = '<span class="week-range">' + esc(w.label) + '</span>' +
            (isCurrent ? '<span class="week-badge">Актуально</span>' : '');
        b.addEventListener('click', () => {
            if (w.key === act