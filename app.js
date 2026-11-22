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
            if (w.key === activeWeekKey) return;
            setActiveWeek(w.key);
            showTodayOverride = false;
            renderSchedule();
        });
        row.appendChild(b);
    });
    return row;
}

function scrollActiveWeekIntoView() {
    const row = document.getElementById('weeks-row');
    if (!row) return;
    const active = row.querySelector('.week-chip.active');
    if (!active) return;
    row.scrollLeft = Math.max(0, active.offsetLeft - (row.clientWidth - active.clientWidth) / 2);
}

/* ---------- Курсовые чипы + поиск ---------- */

function visibleLessons(lessons) {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return lessons;
    return lessons.filter(l =>
        l.subject.toLowerCase().includes(q) ||
        l.teacher.toLowerCase().includes(q) ||
        l.room.toLowerCase().includes(q));
}

function renderCourseChips() {
    const wrap = document.createElement('div');
    wrap.className = 'chips-row';
    const items = [['1', '1 курс'], ['2', '2 курс'], ['3', '3 курс'], ['4', '4 курс'], ['bells', 'Звонки'], ['all', 'Все']];
    items.forEach(item => {
        const val = item[0], label = item[1];
        const chip = document.createElement('button');
        chip.className = 'course-chip' + (courseFilter === val ? ' active' : '');
        chip.textContent = label;
        chip.addEventListener('click', () => {
            if (val === 'bells') { openBells(); return; }
            courseFilter = val;
            localStorage.setItem('courseFilter', val);
            if (val !== 'all') {
                const cur = groupsList[selectedGroupIndex];
                if (!cur || String(cur.course) !== val) {
                    const byCourse = loadJSON('lastGroupByCourse', {});
                    let idx = -1;
                    if (byCourse[val]) idx = groupsList.findIndex(g => g.name === byCourse[val] && String(g.course) === val);
                    if (idx === -1) idx = groupsList.findIndex(g => String(g.course) === val);
                    if (idx !== -1) {
                        selectedGroupIndex = idx;
                        localStorage.setItem('selectedGroupName', groupsList[idx].name);
                    }
                }
            }
            renderSchedule();
        });
        wrap.appendChild(chip);
    });
    return wrap;
}

function renderSearchRow() {
    const row = document.createElement('div');
    row.className = 'search-row';
    row.innerHTML = '<input type="search" id="schedule-search" class="search-input" placeholder="Поиск: предмет, преподаватель, аудитория">';
    const input = row.querySelector('input');
    input.value = searchQuery;
    input.addEventListener('input', () => {
        searchQuery = input.value;
        renderScheduleResults();
    });
    return row;
}

/* ---------- Расписание ---------- */

function renderSchedule() {
    if (!groupsList.length) return;
    const content = document.getElementById('content');
    content.innerHTML = '';
    if (statusBanner) content.appendChild(makeBanner(statusBanner));
    if (weeks.length) {
        content.appendChild(renderWeeksRow());
        const aw = weeks.find(w => w.key === activeWeekKey);
        if (aw && aw.end < dateOnly(new Date()) && !demoMode) {
            const note = document.createElement('div');
            note.className = 'week-note';
            note.textContent = 'Показана прошедшая неделя — новая ещё не опубликована на сайте колледжа.';
            content.appendChild(note);
        }
    }
    content.appendChild(renderCourseChips());
    content.appendChild(renderGroupsRow());
    content.appendChild(renderSearchRow());
    const results = document.createElement('div');
    results.id = 'schedule-results';
    content.appendChild(results);
    renderScheduleResults();
    requestAnimationFrame(() => { scrollActiveWeekIntoView(); scrollActiveGroupIntoView(); });
}

function renderScheduleResults() {
    closeMenus();
    const results = document.getElementById('schedule-results');
    if (!results) return;
    const group = groupsList[selectedGroupIndex];
    const g = group ? groupsDatabase[group.name] : null;
    const rawData = g ? sheets[g.sheetId] : null;
    if (!rawData) return;
    results.innerHTML = '';
    if (currentViewMode === 'day') renderDayView(results, rawData, g);
    else renderWeekView(results, rawData, g);
}

function parseTimeRanges(timeStr) {
    const re = /(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})/g;
    const ranges = [];
    let m;
    while ((m = re.exec(String(timeStr))) !== null) {
        ranges.push({
            start: parseInt(m[1], 10) * 60 + parseInt(m[2], 10),
            end: parseInt(m[3], 10) * 60 + parseInt(m[4], 10)
        });
    }
    return ranges;
}

function renderDayView(content, rawData, g) {
    const w = currentWeek();
    const start = new Date(w.start);
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const today0 = dateOnly(now);
    const searching = searchQuery.trim().length > 0;

    const days = [];
    for (let i = 0; i < 6; i++) {
        const date = addDays(start, i);
        const lessons = findLessons(rawData, g.rowIndex, g.colIndex, WEEK_DAYS[i]);
        if (lessons.length) days.push({ date: date, t: date.getTime(), lessons: lessons, label: WEEK_DAYS[i] });
    }
    if (!days.length) {
        content.insertAdjacentHTML('beforeend', '<div class="empty-msg">На этой неделе пар нет</div>');
        return;
    }

    const todayEntry = days.find(d => d.t === today0);
    let chosen = null, suffix = '';

    if (todayEntry) {
        const allEnded = todayEntry.lessons.every(l => {
            const r = parseTimeRanges(l.time);
            return r.length > 0 && r.every(x => x.end <= nowMin);
        });
        if (!allEnded || showTodayOverride || searching) {
            chosen = todayEntry;
        } else {
            const link = document.createElement('button');
            link.className = 'show-today';
            link.textContent = 'Пары на сегодня закончились — показать сегодня';
            link.addEventListener('click', () => { showTodayOverride = true; renderScheduleResults(); });
            content.appendChild(link);
            chosen = days.find(d => d.t > today0) || null;
            if (!chosen) {
                content.insertAdjacentHTML('beforeend', '<div class="empty-msg">На этой неделе пар больше нет 🎉</div>');
                return;
            }
            if (chosen.t === today0 + DAY_MS) suffix = ' (завтра)';
        }
    } else {
        chosen = days.find(d => d.t >= today0) || days[0];
        if (chosen.t === today0 + DAY_MS) suffix = ' (завтра)';
    }

    appendDayBlock(content, chosen.label + suffix, chosen.lessons, chosen.date, chosen.t === today0, nowMin);
}

function renderWeekView(content, rawData, g) {
    const start = new Date(currentWeek().start);
    const todayStr = getTodayString();
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    let hasAny = false;
    WEEK_DAYS.forEach((dayName, i) => {
        const date = addDays(start, i);
        const lessons = findLessons(rawData, g.rowIndex, g.colIndex, dayName);
        if (lessons.length) {
            hasAny = true;
            appendDayBlock(content, dayName, lessons, date, dateToStr(date) === todayStr, nowMin);
        }
    });
    if (!hasAny) content.insertAdjacentHTML('beforeend', '<div class="empty-msg">На этой неделе пар нет</div>');
}

function appendDayBlock(content, label, lessons, dateObj, isToday, nowMin) {
    const shown = visibleLessons(lessons);
    if (!shown.length) return;
    const block = document.createElement('div');
    block.className = 'day-block';
    block.innerHTML = '<div class="day-title ' + (isToday ? 'today' : '') + '">' + esc(label) +
        ' <span class="day-date">· ' + shortDate(dateObj) + '</span></div>';
    let nextMarked = false;
    lessons.forEach(l => {
        let st = null;
        if (isToday) {
            const ranges = parseTimeRanges(l.time);
            if (ranges.length) {
                const start = Math.min.apply(null, ranges.map(r => r.start));
                const end = Math.max.apply(null, ranges.map(r => r.end));
                if (nowMin >= start && nowMin < end) st = { state: 'now' };
                else if (start > nowMin && !nextMarked) { st = { state: 'next', mins: start - nowMin }; nextMarked = true; }
            }
        }
        if (shown.includes(l)) block.appendChild(createLessonCard(l, dateObj, isToday, st));
    });
    content.appendChild(block);
}

function createLessonCard(l, dateObj, isToday, st) {
    const card = document.createElement('div');
    card.className = 'lesson-card' + (isToday ? ' today' : '') + (st && st.state === 'now' ? ' now' : '');

    const uniqueId = dateToStr(dateObj) + '_' + l.subject + '_' + l.time + '_' + l.num;
    const record = attendanceData[uniqueId];

    let statusIcon = '⚪', statusColor = 'var(--text-muted)';
    if (record === 'present') { statusIcon = '✅'; statusColor = 'var(--success)'; }
    else if (record === 'half') { statusIcon = '🟡'; statusColor = 'var(--warning)'; }
    else if (record === 'absent') { statusIcon = '❌'; statusColor = 'var(--danger)'; }

    let chip = '';
    if (st && st.state === 'now') chip = '<span class="chip chip-now">идёт сейчас</span>';
    else if (st && st.state === 'next') chip = '<span class="chip chip-next">через ' + formatMins(st.mins) + '</span>';

    const timeParts = String(l.time).split('/').map(s => s.trim()).filter(Boolean);
    const timeHtml = timeParts.map(t => '<span>' + esc(t) + '</span>').join('');
    const numLabel = /^\d+$/.test(String(l.num)) ? 'Пара ' + l.num : '•';
    const metaHtml = l.teacher ? '<div class="lesson-meta"><span class="lesson-teacher">' + esc(l.teacher) + '</span></div>' : '';

    card.innerHTML = `
        <div class="lesson-time-block">
            <div class="lesson-num">${esc(numLabel)}</div>
            <div class="lesson-time">${timeHtml}</div>
        </div>
        <div class="lesson-info">
            <div class="lesson-subject">${esc(l.subject)} ${chip}</div>
            ${metaHtml}
        </div>
        <div class="lesson-side">
            ${l.room ? `<span class="room-badge">${esc(l.room)}</span>` : ''}
            <button class="attendance-btn" style="color: ${statusColor}" aria-label="Отметить посещение за ${dateToStr(dateObj)}">${statusIcon}</button>
        </div>
    `;

    const btn = card.querySelector('.attendance-btn');
    btn.addEventListener('click', () => openStatusMenu(btn, uniqueId, dateObj, isToday, l.subject));
    return card;
}

/* ---------- Меню статуса + подтверждение для других дней ---------- */

function closeMenus() {
    document.querySelectorAll('.menu-backdrop').forEach(el => el.remove());
}

function applyStatus(uniqueId, val) {
    if (val) attendanceData[uniqueId] = val;
    else delete attendanceData[uniqueId];
    saveAttendance();
    if (navigator.vibrate) { try { navigator.vibrate(10); } catch (e) {} }
    renderScheduleResults();
}

function confirmStatusChange(uniqueId, val, dateObj, subject) {
    const labels = { present: ['✅', 'Посещено'], half: ['🟡', 'Половина'], absent: ['❌', 'Пропущено'] };
    const info = val ? labels[val] : ['⚪', 'Убрать отметку'];
    openModal('Подтверждение изменения', `
        <div class="confirm-card">
            <div class="confirm-date">${dateToStr(dateObj)} · ${DAYS[dateObj.getDay()]}</div>
            <div class="confirm-lesson">${esc(subject)}</div>
            <div class="confirm-status">${info[0]} ${info[1]}</div>
        </div>
        <div class="modal-note">Это не сегодняшний день — подтвердите изменение отметки.</div>`);
    modalButton('Отмена', false, closeModal);
    modalButton('Подтвердить', true, () => { applyStatus(uniqueId, val); closeModal(); });
}

function openStatusMenu(anchor, uniqueId, dateObj, isToday, subject) {
    closeMenus();
    const backdrop = document.createElement('div');
    backdrop.className = 'menu-backdrop';
    const menu = document.createElement('div');
    menu.className = 'status-menu';

    const items = [
        ['present', '✔️', 'Посещено'],
        ['half', '🟡', 'Половина'],
        ['absent', '❌', 'Пропущено'],
        [null, '⚪', 'Убрать отметку']
    ];
    items.forEach(item => {
        const val = item[0], icon = item[1], label = item[2];
        const row = document.createElement('button');
        row.className = 'status-item' + (attendanceData[uniqueId] === val && val !== null ? ' selected' : '');
        row.innerHTML = '<span class="status-ico">' + icon + '</span><span>' + label + '</span>';
        row.addEventListener('click', ev => {
            ev.stopPropagation();
            closeMenus();
            if (isToday) applyStatus(uniqueId, val);
            else confirmStatusChange(uniqueId, val, dateObj, subject);
        });
        menu.appendChild(row);
    });

    backdrop.appendChild(menu);
    backdrop.addEventListener('click', closeMenus);
    menu.addEventListener('click', ev => ev.stopPropagation());
    document.body.appendChild(backdrop);

    const r = anchor.getBoundingClientRect();
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    let left = Math.max(8, Math.min(r.right - mw, window.innerWidth - mw - 8));
    let top = r.bottom + 6;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
}

/* ---------- Посещаемость ---------- */

function saveAttendance() {
    try { localStorage.setItem('attendance', JSON.stringify(attendanceData)); }
    catch (e) { console.warn('Не удалось сохранить посещаемость', e); }
}

function renderAttendance() {
    const content = document.getElementById('content');
    content.innerHTML = '<h2 class="page-title">Посещаемость</h2>';

    const stats = {};
    let totalPresent = 0, totalAll = 0;
    for (const [key, status] of Object.entries(attendanceData)) {
        const parts = key.split('_');
        if (parts.length < 4) continue;
        const subject = parts.slice(1, -2).join('_');
        if (!stats[subject]) stats[subject] = { present: 0, total: 0 };
        stats[subject].total++;
        totalAll++;
        if (status === 'present') { stats[subject].present += 1; totalPresent += 1; }
        else if (status === 'half') { stats[subject].present += 0.5; totalPresent += 0.5; }
    }

    const subjects = Object.keys(stats).sort((a, b) => a.localeCompare(b, 'ru'));
    if (!subjects.length) {
        content.insertAdjacentHTML('beforeend', '<div class="empty-msg">Нет данных. Отметьте пары в расписании — на любой день недели.</div>');
        return;
    }

    content.appendChild(makeStatsCard('Все предметы', totalPresent, totalAll));
    subjects.forEach(sub => content.appendChild(makeStatsCard(sub, stats[sub].present, stats[sub].total)));
}

function makeStatsCard(title, present, total) {
    const percent = total ? Math.round((present / total) * 100) : 0;
    const color = percent >= attendanceThreshold ? 'var(--success)' : 'var(--danger)';
    const card = document.createElement('div');
    card.className = 'stats-card';
    card.style.borderLeftColor = color;
    card.innerHTML = `
        <div class="stats-head">
            <div class="stats-title">${esc(title)}</div>
            <div class="stats-percent" style="color: ${color}">${percent}%</div>
        </div>
        <div class="stats-bar"><div class="stats-fill" style="background: ${color}; width: ${percent}%;"></div></div>
        <div class="stats-meta">Посещено: ${present} из ${total}</div>`;
    return card;
}

function resetAttendance() {
    if (!confirm('Удалить всю историю посещаемости? Это действие нельзя отменить.')) return;
    attendanceData = {};
    saveAttendance();
    renderCurrentTab();
}

/* ---------- Модальные окна ---------- */

function openModal(title, bodyHtml) {
    closeModal();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal">
            <h2 class="modal-title">${esc(title)}</h2>
            <div class="modal-body">${bodyHtml}</div>
            <div class="modal-actions" id="modal-actions"></div>
        </div>`;
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
    document.body.appendChild(overlay);
    return overlay;
}

function closeModal() {
    const o = document.getElementById('modal-overlay');
    if (o) o.remove();
}

function modalButton(label, primary, onClick) {
    const b = document.createElement('button');
    b.className = 'modal-btn' + (primary ? ' primary' : '');
    b.textContent = label;
    b.addEventListener('click', onClick);
    document.getElementById('modal-actions').appendChild(b);
    return b;
}

/* ---------- Звонки ---------- */

function openBells() {
    let rows = '';
    BELLS.forEach(b => {
        rows += `
            <div class="bell-row">
                <div class="bell-num">${b.num}</div>
                <div class="bell-times"><span>${b.halves[0]}</span><span>${b.halves[1]}</span></div>
            </div>`;
    });
    openModal('Расписание звонков', rows + '<div class="modal-note">5–6 пары указаны ориентировочно — сверяйтесь с таблицей колледжа.</div>');
    modalButton('Закрыть', true, closeModal);
}

/* ---------- Настройки ---------- */

function renderSettings() {
    const content = document.getElementById('content');
    const groupName = groupsList[selectedGroupIndex] ? groupsList[selectedGroupIndex].name : 'Не выбрана';
    const weekLabel = currentWeek().label || '—';
    content.innerHTML = `
        <h2 class="page-title">Настройки</h2>
        <div class="settings-group">
            <div class="settings-title">Оформление</div>
            <div class="settings-row settings-clickable" id="set-theme">
                <span>Тема оформления</span><span class="settings-value">Выбрать →</span>
            </div>
        </div>
        <div class="settings-group">
            <div class="settings-title">Моя группа</div>
            <div class="settings-row"><span>Текущая группа</span><span class="settings-value">${esc(groupName)}</span></div>
            <div class="settings-row settings-clickable" id="set-group"><span>Сменить группу</span><span class="settings-value">Выбрать →</span></div>
        </div>
        <div class="settings-group">
            <div class="settings-title">Посещаемость</div>
            <div class="settings-row">
                <span>Порог «хорошей» посещаемости, %</span>
                <input type="number" id="set-threshold" class="num-input" min="0" max="100" value="${attendanceThreshold}">
            </div>
            <div class="settings-row settings-clickable" id="set-att-reset"><span>Сбросить историю посещаемости</span><span class="settings-danger">🗑️</span></div>
        </div>
        <div class="settings-group">
            <div class="settings-title">Данные</div>
            <div class="settings-row"><span>Неделя</span><span class="settings-value">${esc(weekLabel)}</span></div>
            <div class="settings-row"><span>Обновлено</span><span class="settings-value" id="set-updated">${esc(agoText())}</span></div>
            <div class="settings-row"><span>Загрузить расписание заново</span><button class="btn" id="set-refresh">🔄 Обновить</button></div>
        </div>
        <div class="settings-group">
            <div class="settings-title">О приложении</div>
            <div class="settings-row"><span>Версия</span><span class="settings-value">${APP_VERSION}</span></div>
            <div class="settings-row"><span>Источник расписания</span><a class="settings-link" href="${SITE_URL}" target="_blank" rel="noopener">politech-nsk.ru</a></div>
        </div>`;
    document.getElementById('set-theme').addEventListener('click', openSettingsModal);
    document.getElementById('set-group').addEventListener('click', openSettingsModal);
    document.getElementById('set-att-reset').addEventListener('click', resetAttendance);
    document.getElementById('set-refresh').addEventListener('click', () => refreshSchedules());
    document.getElementById('set-threshold').addEventListener('change', e => {
        let v = parseInt(e.target.value, 10);
        if (!Number.isFinite(v)) v = 70;
        attendanceThreshold = Math.min(100, Math.max(0, v));
        e.target.value = attendanceThreshold;
        localStorage.setItem('attThreshold', String(attendanceThreshold));
    });
}

function openSettingsModal() {
    pendingTheme = currentTheme();
    pendingGroupIdx = selectedGroupIndex;

    const themes = [
        ['light', '☀️', 'Светлая'],
        ['dark', '🌙', 'Тёмная'],
        ['oled', '🖤', 'OLED / AMOLED']
    ];
    let themeHtml = '';
    themes.forEach(t => {
        themeHtml += `
            <label class="theme-option" data-theme="${t[0]}">
                <input type="radio" name="theme-choice" value="${t[0]}" ${pendingTheme === t[0] ? 'checked' : ''}>
                <span class="theme-ico">${t[1]}</span><span>${t[2]}</span>
            </label>`;
    });

    let options = '';
    let curCourse = -1;
    groupsList.forEach((g, i) => {
        if (g.course !== curCourse) {
            if (curCourse !== -1) options += '</optgroup>';
            curCourse = g.course;
            options += '<optgroup label="' + esc(g.course ? g.course + ' курс' : 'Другие') + '">';
        }
        options += '<option value="' + i + '"' + (i === pendingGroupIdx ? ' selected' : '') + '>' + esc(g.name) + '</option>';
    });
    if (curCourse !== -1) options += '</optgroup>';

    openModal('Настройки', `
        <div class="modal-section-title">Тема оформления</div>
        <div id="theme-options">${themeHtml}</div>
        <div class="modal-section-title">Моя группа</div>
        <div class="modal-note">Выбранная группа будет автоматически открываться в приложении.</div>
        <select id="modal-group" class="group-selector">${options}</select>
    `);

    document.querySelectorAll('#theme-options .theme-option').forEach(label => {
        label.addEventListener('click', () => {
            pendingTheme = label.dataset.theme;
            document.querySelectorAll('#theme-options .theme-option').forEach(l =>
                l.classList.toggle('selected', l === label));
            const radio = label.querySelector('input');
            if (radio) radio.checked = true;
        });
        if (label.dataset.theme === pendingTheme) label.classList.add('selected');
    });
    document.getElementById('modal-group').addEventListener('change', e => {
        pendingGroupIdx = parseInt(e.target.value, 10) || 0;
    });

    modalButton('Закрыть', false, closeModal);
    modalButton('Сохранить', true, () => {
        localStorage.setItem('theme', pendingTheme);
        applyTheme(pendingTheme);
        if (Number.isInteger(pendingGroupIdx) && groupsList[pendingGroupIdx]) {
            selectedGroupIndex = pendingGroupIdx;
            localStorage.setItem('selectedGroupName', groupsList[pendingGroupIdx].name);
            const cur = groupsList[pendingGroupIdx];
            if (courseFilter !== 'all' && String(cur.course) !== courseFilter) courseFilter = String(cur.course);
        }
        closeModal();
        renderCurrentTab();
    });
}

/* ---------- Служебное ---------- */

function updateRefreshUI() {
    const btn = document.getElementById('refresh-btn');
    if (btn) {
        btn.classList.toggle('spinning', isRefreshing);
        btn.disabled = isRefreshing;
    }
}

function updateUpdatedLabel() {
    const el = document.getElementById('updated-label');
    if (el) {
        el.textContent = demoMode ? 'Демо-режим'
            : (lastUpdated ? 'Обновлено ' + formatAgo(lastUpdated)
            : (groupsList.length ? 'Данные из кэша' : 'Загрузка…'));
    }
    const set = document.getElementById('set-updated');
    if (set) set.textContent = agoText();
}

function tick() {
    const today = getTodayString();
    if (today !== lastDateStr) { lastDateStr = today; showTodayOverride = false; }
    if (currentTab === 'schedule' && groupsList.length) renderScheduleResults();
    updateUpdatedLabel();
}

/* ---------- Парсер расписания: устойчивое извлечение ФИО преподавателя ---------- */

function cleanCell(v) {
    return String(v == null ? '' : v)
        .replace(/\u00A0/g, ' ')
        .replace(/([А-ЯЁA-Z])\.\s+(?=[А-ЯЁA-Z]\.)/g, '$1.')
        .replace(/\s+/g, ' ')
        .trim();
}

const TEACHER_FULL = /^[А-ЯЁа-яё][а-яё\-]*(?:-[А-ЯЁ][а-яё\-]*)?\.?\s*[А-ЯЁ]\.[А-ЯЁ]\.?(?:\s*[,/]\s*[А-ЯЁа-яё][а-яё\-]*(?:-[А-ЯЁ][а-яё\-]*)?\.?\s*[А-ЯЁ]\.[А-ЯЁ]\.?)*$/;
const TEACHER_INI_FIRST = /^[А-ЯЁ]\.[А-ЯЁ]\.?\s*[А-ЯЁа-яё][а-яё\-]*(?:-[А-ЯЁ][а-яё\-]*)?(?:\s*[,/]\s*[А-ЯЁ]\.[А-ЯЁ]\.?\s*[А-ЯЁа-яё][а-яё\-]*(?:-[А-ЯЁ][а-яё\-]*)?)*$/;
const TEACHER_FULLNAME = /^[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]{2,}\s+[А-ЯЁ][а-яё]{2,}$/;
const SUBJECT_WORDS = /безопасност|культур|физическ|математ|истор|информат|философ|эконом|правов|психолог|педагог|хими|биолог|географ|литератур|русск|англ|язык|обеспеч|администр|сетев|маршрут|мдк|разговор|основы|управлен|охран|труд|электив/i;
const TEACHER_PART = /[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?\.?\s*[А-ЯЁ]\.[А-ЯЁ]\.?/;
const TEACHER_PART_INI = /[А-ЯЁ]\.[А-ЯЁ]\.?\s*[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?/;

function isTeacherText(t) {
    if (TEACHER_FULL.test(t) || TEACHER_INI_FIRST.test(t)) return true;
    return TEACHER_FULLNAME.test(t) && !SUBJECT_WORDS.test(t);
}

function isRoomText(t) {
    return /^[0-9]{1,4}[а-яА-Яa-zA-Z]?$/.test(t) ||
        /^[0-9]{1,3}\/[0-9]$/.test(t) ||
        (t.length <= 14 && /зал|ауд|спорт/i.test(t));
}

function looksLikePerson(t) {
    return /[А-ЯЁ]\.\s*[А-ЯЁ]\.?/.test(t) ||
        /^[А-ЯЁ]\./.test(t) ||
        /^[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]/.test(t);
}

function findLessons(rawData, startRow, groupCol, targetDayName) {
    const lessons = [];
    let isCurrentDay = false;
    const timeRegex = /\d{1,2}:\d{2}\s*[-–—]\s*\d{1,2}:\d{2}/g;

    const rowDay = row => DAYS.find(d =>
        row.slice(0, 5).map(c => typeof c === 'string' ? c : '').join(' ').toUpperCase().includes(d));

    const windowTexts = row => {
        const out = [];
        const end = Math.min(groupCol + 4, row.length - 1);
        for (let c = groupCol; c <= end; c++) {
            const t = cleanCell(row[c]);
            if (t) out.push(t);
        }
        return [...new Set(out)];
    };

    const classify = texts => {
        let teacher = '', room = '';
        const leftovers = [];
        for (const text of texts) {
            if (isTeacherText(text)) { if (!teacher) teacher = text; continue; }

            let rest = text;
            const tm = text.match(TEACHER_PART) || text.match(TEACHER_PART_INI);
            if (tm) {
                if (!teacher) teacher = tm[0];
                rest = cleanCell(text.replace(tm[0], ' '))
                    .replace(/^[\s,;.\-–—\/]+/, '')
                    .replace(/[\s,;\/\-–—]+$/, '');
            }
            if (!rest) continue;
            if (/\d{1,2}:\d{2}\s*[-–—]\s*\d{1,2}:\d{2}/.test(rest)) continue;
            if (isRoomText(rest)) { if (!room) room = rest; continue; }

            if (!room) {
                const rm = rest.match(/([а-яёa-z])\s(\d{1,3}[А-ЯA-Zа-я]?)$/i);
                if (rm) {
                    room = rm[2];
                    rest = rest.slice(0, rest.length - rm[2].length - 1).trim();
                }
            }
            if (rest.length >= 2) leftovers.push(rest);
        }
        if (!teacher) {
            const ti = leftovers.findIndex(looksLikePerson);
            if (ti !== -1) teacher = leftovers.splice(ti, 1)[0];
        }
        leftovers.sort((a, b) => b.length - a.length);
        return { subject: leftovers[0] || '', teacher: teacher, room: room };
    };

    for (let r = startRow; r < rawData.length; r++) {
        const row = rawData[r];
        if (!row) continue;

        const foundDay = rowDay(row);
        if (foundDay) {
            if (isCurrentDay) break;
            isCurrentDay = (foundDay === targetDayName);
        }
        if (!isCurrentDay) continue;

        let allTimes = [];
        let numCellStr = '';
        for (let c = 0; c < 6; c++) {
            const cell = row[c];
            if (typeof cell === 'string') {
                const matches = cell.match(timeRegex);
                if (matches) allTimes.push(...matches);
                const trimmed = cell.trim();
                if (!numCellStr && (/^[1-9]$/.test(trimmed) || /^[1-9]\s*пара$/i.test(trimmed))) {
                    numCellStr = trimmed.replace(/\D/g, '');
                }
            }
        }
        if (!allTimes.length) continue;
        const finalTimes = [...new Set(allTimes)].join(' / ');

        const texts = windowTexts(row).filter(t => t !== numCellStr);
        const res = classify(texts);
        if (!res.subject) continue;

        let teacher = res.teacher, room = res.room;

        if (!teacher || !room) {
            const nrow = rawData[r + 1];
            if (nrow && !rowDay(nrow)) {
                const nres = classify(windowTexts(nrow));
                if (!nres.subject) {
                    if (!teacher && nres.teacher) teacher = nres.teacher;
                    if (!room && nres.room) room = nres.room;
                }
            }
        }

        lessons.push({ num: numCellStr || '•', time: finalTimes, subject: res.subject, teacher: teacher, room: room });
    }
    return lessons;
}

/* ---------- Старт ---------- */

document.addEventListener('DOMContentLoaded', () => {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW:', e));
    }

    applyTheme();
    initIOSHint();

    document.getElementById('view-toggle').addEventListener('click', toggleView);
    document.getElementById('refresh-btn').addEventListener('click', () => refreshSchedules());
    document.querySelectorAll('.nav-item').forEach(el =>
        el.addEventListener('click', () => switchTab(el.dataset.tab)));

    if (loadSnapshot()) {
        switchTab('schedule');
    }
    updateUpdatedLabel();
    refreshSchedules();

    setInterval(tick, 60000);
    window.addEventListener('online', () => refreshSchedules());
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            tick();
            if (!demoMode && lastUpdated && Date.now() - lastUpdated > 15 * 60 * 1000) refreshSchedules();
        }
    });
});