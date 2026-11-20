/* Расписание НПК — app.js v2.1 */

const SITE_URL = 'https://politech-nsk.ru/index.php/studentam';
const BASE_URL = 'https://politech-nsk.ru';
const PROXY = 'https://schedule-proxy.ivanushca99.workers.dev/?url=';
const APP_VERSION = '2.1';

const DAYS = ['ВОСКРЕСЕНЬЕ', 'ПОНЕДЕЛЬНИК', 'ВТОРНИК', 'СРЕДА', 'ЧЕТВЕРГ', 'ПЯТНИЦА', 'СУББОТА'];
const WEEK_DAYS = ['ПОНЕДЕЛЬНИК', 'ВТОРНИК', 'СРЕДА', 'ЧЕТВЕРГ', 'ПЯТНИЦА', 'СУББОТА'];

let sheets = [];            // листы Excel хранятся по одному разу
let groupsDatabase = {};    // имя группы -> { sheetId, rowIndex, colIndex }
let groupsList = [];        // [{ name, course }]
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

function getTodayString() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear();
}

function formatDateShort(ts) {
    const d = new Date(ts);
    const p = n => String(n).padStart(2, '0');
    return p(d.getDate()) + '.' + p(d.getMonth() + 1) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
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

/* ---------- Тема ---------- */

function applyTheme() {
    const light = localStorage.getItem('theme') === 'light';
    document.body.classList.toggle('light', light);
    const meta = document.getElementById('meta-theme');
    if (meta) meta.setAttribute('content', light ? '#FFFFFF' : '#1C1B1F');
}

function toggleTheme() {
    localStorage.setItem('theme', document.body.classList.contains('light') ? 'dark' : 'light');
    applyTheme();
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
    const isSchedule = tab === 'schedule';
    document.getElementById('group-select').style.display = isSchedule && groupsList.length ? 'block' : 'none';
    document.getElementById('view-toggle').style.display = isSchedule ? 'inline-block' : 'none';
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

/* ---------- Определение курса (работает в любом учебном году) ---------- */

function detectCourse(groupName, now) {
    now = now || new Date();
    const m = groupName.match(/\d+/);
    if (!m) return 0;
    const last = parseInt(m[0].charAt(m[0].length - 1), 10);
    const startYear = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1; // учебный год с сентября
    let course = (startYear % 10) - last + 1;
    if (course <= 0) course += 10;
    return (course >= 1 && course <= 4) ? course : 0; // 0 = «Другие»
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

        const excelUrls = [];
        doc.querySelectorAll('a[href]').forEach(link => {
            const href = link.getAttribute('href') || '';
            const low = href.toLowerCase();
            if (low.includes('.xlsx') || low.includes('.xls')) {
                const full = href.startsWith('http') ? href : BASE_URL + href;
                if (!excelUrls.includes(full)) excelUrls.push(full);
            }
        });
        if (!excelUrls.length) throw new Error('На странице не найдено файлов расписания');

        // качаем все файлы параллельно
        const results = await Promise.allSettled(excelUrls.map(async url => {
            const r = await fetch(PROXY + encodeURIComponent(url));
            if (!r.ok) throw new Error('HTTP ' + r.status + ' для ' + url);
            return r.arrayBuffer();
        }));

        const target = { sheets: [], db: {}, list: [] };
        results.forEach(r => {
            if (r.status === 'fulfilled') {
                try { parseWorkbook(r.value, target); }
                catch (e) { console.warn('Ошибка парсинга файла', e); }
            } else {
                console.warn('Ошибка загрузки файла', r.reason);
            }
        });
        if (!target.list.length) throw new Error('Не удалось распознать ни одной группы');

        sheets = target.sheets;
        groupsDatabase = target.db;
        groupsList = target.list.sort((a, b) =>
            (a.course || 99) - (b.course || 99) || a.name.localeCompare(b.name, 'ru'));
        demoMode = false;
        showTodayOverride = false;

        if (fromCache) {
            statusBanner = { type: 'warn', text: 'Нет сети — показано расписание из кэша браузера.' };
        } else {
            lastUpdated = Date.now();
            statusBanner = null;
            saveSnapshot();
        }

        populateGroupSelector();
        restoreSelectedGroup();
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
    sheets = [[
        ['День', 'Пара', 'Время', 'Группа'],
        ['ПОНЕДЕЛЬНИК', '1', '8:30 - 9:15', 'Демо-предмет'],
        ['ВТОРНИК', '2', '10:30 - 11:15', 'Демо-предмет']
    ]];
    groupsDatabase = { '224 СА (Демо)': { sheetId: 0, rowIndex: 1, colIndex: 3 } };
    groupsList = [{ name: '224 СА (Демо)', course: 2 }];
    selectedGroupIndex = 0;
    statusBanner = { type: 'error', text: 'Сайт колледжа временно недоступен. Показано демо-расписание.' };
    populateGroupSelector();
    restoreSelectedGroup();
    switchTab(currentTab);
}

/* ---------- Снапшот в localStorage (мгновенный старт) ---------- */

function saveSnapshot() {
    try {
        const groups = groupsList.map(g => {
            const ref = groupsDatabase[g.name];
            return { name: g.name, course: g.course, sheetId: ref.sheetId, rowIndex: ref.rowIndex, colIndex: ref.colIndex };
        });
        localStorage.setItem('scheduleCache', JSON.stringify({ t: lastUpdated, sheets: sheets, groups: groups }));
    } catch (e) {
        console.warn('Кэш расписания не сохранён (возможно, слишком большой):', e);
    }
}

function loadSnapshot() {
    try {
        const raw = localStorage.getItem('scheduleCache');
        if (!raw) return false;
        const data = JSON.parse(raw);
        if (!data || !Array.isArray(data.sheets) || !Array.isArray(data.groups) || !data.groups.length) return false;
        sheets = data.sheets;
        groupsDatabase = {};
        groupsList = [];
        data.groups.forEach(g => {
            if (!g || typeof g.name !== 'string' || !sheets[g.sheetId]) return;
            groupsDatabase[g.name] = { sheetId: g.sheetId, rowIndex: g.rowIndex, colIndex: g.colIndex };
            groupsList.push({ name: g.name, course: g.course || 0 });
        });
        if (!groupsList.length) return false;
        lastUpdated = typeof data.t === 'number' ? data.t : null;
        return true;
    } catch (e) { return false; }
}

/* ---------- Выбор группы ---------- */

function populateGroupSelector() {
    const select = document.getElementById('group-select');
    select.innerHTML = '';
    let currentCourse = -1;
    let optgroup = null;
    groupsList.forEach((g, i) => {
        if (g.course !== currentCourse) {
            currentCourse = g.course;
            optgroup = document.createElement('optgroup');
            optgroup.label = g.course ? g.course + ' курс' : 'Другие';
            select.appendChild(optgroup);
        }
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = g.name;
        optgroup.appendChild(opt);
    });
    select.style.display = currentTab === 'schedule' ? 'block' : 'none';
    select.onchange = () => {
        selectedGroupIndex = parseInt(select.value, 10) || 0;
        const g = groupsList[selectedGroupIndex];
        if (g) localStorage.setItem('selectedGroupName', g.name);
        renderSchedule();
    };
}

function restoreSelectedGroup() {
    const saved = localStorage.getItem('selectedGroupName');
    if (saved) {
        const idx = groupsList.findIndex(g => g.name === saved);
        if (idx !== -1) selectedGroupIndex = idx;
    }
    if (selectedGroupIndex >= groupsList.length) selectedGroupIndex = 0;
    document.getElementById('group-select').value = String(selectedGroupIndex);
}

/* ---------- Баннер статуса ---------- */

function makeBanner(b) {
    const div = document.createElement('div');
    div.className = 'banner ' + b.type;
    div.innerHTML = '<span>' + esc(b.text) + '</span><button class="btn banner-retry">Повторить</button>';
    div.querySelector('.banner-retry').addEventListener('click', () => refreshSchedules());
    return div;
}

/* ---------- Расписание ---------- */

function renderSchedule() {
    if (!groupsList.length) return;
    const group = groupsList[selectedGroupIndex];
    const g = group ? groupsDatabase[group.name] : null;
    const rawData = g ? sheets[g.sheetId] : null;
    if (!rawData) return;

    const content = document.getElementById('content');
    content.innerHTML = '';
    if (statusBanner) content.appendChild(makeBanner(statusBanner));

    if (currentViewMode === 'day') renderDayView(content, rawData, g);
    else renderWeekView(content, rawData, g);
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
    const now = new Date();
    const todayIdx = now.getDay();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const todayLessons = findLessons(rawData, g.rowIndex, g.colIndex, DAYS[todayIdx]);

    const allEnded = todayLessons.length > 0 && todayLessons.every(l => {
        const ranges = parseTimeRanges(l.time);
        return ranges.length > 0 && ranges.every(r => r.end <= nowMin);
    });

    if (todayLessons.length && (!allEnded || showTodayOverride)) {
        appendDayBlock(content, DAYS[todayIdx], todayLessons, true, nowMin);
        return;
    }

    if (allEnded) {
        const link = document.createElement('button');
        link.className = 'show-today';
        link.textContent = 'Пары на сегодня закончились — показать сегодня';
        link.addEventListener('click', () => { showTodayOverride = true; renderSchedule(); });
        content.appendChild(link);
    }

    // ищем ближайший день с парами (не только завтра)
    for (let off = 1; off <= 6; off++) {
        const idx = (todayIdx + off) % 7;
        const lessons = findLessons(rawData, g.rowIndex, g.colIndex, DAYS[idx]);
        if (lessons.length) {
            appendDayBlock(content, DAYS[idx] + (off === 1 ? ' (завтра)' : ''), lessons, false, nowMin);
            return;
        }
    }
    content.insertAdjacentHTML('beforeend', '<div class="empty-msg">Занятий нет 🎉</div>');
}

function renderWeekView(content, rawData, g) {
    const now = new Date();
    const todayName = DAYS[now.getDay()];
    const nowMin = now.getHours() * 60 + now.getMinutes();
    let hasAny = false;
    WEEK_DAYS.forEach(dayName => {
        const lessons = findLessons(rawData, g.rowIndex, g.colIndex, dayName);
        if (lessons.length) {
            hasAny = true;
            appendDayBlock(content, dayName, lessons, dayName === todayName, nowMin);
        }
    });
    if (!hasAny) content.insertAdjacentHTML('beforeend', '<div class="empty-msg">На неделю пар нет</div>');
}

function appendDayBlock(content, label, lessons, isToday, nowMin) {
    const block = document.createElement('div');
    block.className = 'day-block';
    block.innerHTML = '<div class="day-title ' + (isToday ? 'today' : '') + '">' + esc(label) + '</div>';
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
        block.appendChild(createLessonCard(l, isToday, st));
    });
    content.appendChild(block);
}

function createLessonCard(l, isToday, st) {
    const card = document.createElement('div');
    card.className = 'lesson-card' + (isToday ? ' today' : '') + (st && st.state === 'now' ? ' now' : '');

    const uniqueId = getTodayString() + '_' + l.subject + '_' + l.time + '_' + l.num;
    const record = attendanceData[uniqueId];

    let statusIcon = '⚪', statusColor = 'var(--text-muted)';
    if (record === 'present') { statusIcon = '✅'; statusColor = 'var(--success)'; }
    else if (record === 'half') { statusIcon = '🟡'; statusColor = 'var(--warning)'; }
    else if (record === 'absent') { statusIcon = '❌'; statusColor = 'var(--danger)'; }

    let chip = '';
    if (st && st.state === 'now') chip = '<span class="chip chip-now">идёт сейчас</span>';
    else if (st && st.state === 'next') chip = '<span class="chip chip-next">через ' + formatMins(st.mins) + '</span>';

    let metaHtml = '';
    if (l.teacher) metaHtml += '<span>' + esc(l.teacher) + '</span>';
    if (l.room) metaHtml += '<span class="room-badge">ауд. ' + esc(l.room) + '</span>';

    card.innerHTML = `
        <div class="lesson-time-block">
            <div class="lesson-num">${esc(l.num || '•')}</div>
            <div class="lesson-time">${esc(l.time)}</div>
        </div>
        <div class="lesson-info">
            <div class="lesson-subject">${esc(l.subject)} ${chip}</div>
            <div class="lesson-meta">${metaHtml}</div>
        </div>
        ${isToday ? `<button class="attendance-btn" style="color: ${statusColor}" aria-label="Отметить посещение">${statusIcon}</button>` : ''}
    `;

    const btn = card.querySelector('.attendance-btn');
    if (btn) btn.addEventListener('click', () => markAttendance(uniqueId));
    return card;
}

/* ---------- Посещаемость ---------- */

function markAttendance(uniqueId) {
    const statuses = ['present', 'half', 'absent', null];
    const current = attendanceData[uniqueId] || null;
    const nextStatus = statuses[(statuses.indexOf(current) + 1) % statuses.length];
    if (nextStatus) attendanceData[uniqueId] = nextStatus;
    else delete attendanceData[uniqueId];
    saveAttendance();
    if (navigator.vibrate) { try { navigator.vibrate(10); } catch (e) {} }
    renderSchedule();
}

function saveAttendance() {
    try { localStorage.setItem('attendance', JSON.stringify(attendanceData)); }
    catch (e) { console.warn('Не удалось сохранить посещаемость', e); }
}

function renderAttendance() {
    const content = document.getElementById('content');
    content.innerHTML = `
        <h2 class="page-title">Посещаемость</h2>
        <div class="toolbar">
            <button class="btn" id="att-export">⬇️ Экспорт</button>
            <button class="btn" id="att-import">⬆️ Импорт</button>
            <button class="btn btn-danger" id="att-reset">🗑️ Сброс</button>
        </div>`;
    document.getElementById('att-export').addEventListener('click', exportAttendance);
    document.getElementById('att-import').addEventListener('click', () => document.getElementById('import-file').click());
    document.getElementById('att-reset').addEventListener('click', resetAttendance);

    const stats = {};
    let totalPresent = 0, totalAll = 0;
    for (const [key, status] of Object.entries(attendanceData)) {
        const parts = key.split('_');
        if (parts.length < 4) continue;
        const subject = parts.slice(1, -2).join('_'); // предмет может содержать '_'
        if (!stats[subject]) stats[subject] = { present: 0, total: 0 };
        stats[subject].total++;
        totalAll++;
        if (status === 'present') { stats[subject].present += 1; totalPresent += 1; }
        else if (status === 'half') { stats[subject].present += 0.5; totalPresent += 0.5; }
    }

    const subjects = Object.keys(stats).sort((a, b) => a.localeCompare(b, 'ru'));
    if (!subjects.length) {
        content.insertAdjacentHTML('beforeend', '<div class="empty-msg">Нет данных. Отметьте пары в расписании.</div>');
        return;
    }

    content.appendChild(makeStatsCard('Все предметы', totalPresent, totalAll));
    subjects.forEach(sub => content.appendChild(makeStatsCard(sub, stats[sub].present, stats[sub].total)));
}

function makeStatsCard(title, present, total) {
    const percent = total ? Math.round((present / total) * 100) : 0;
    const color = percent >= attendanceThreshold ? 'var(--success)' : 'var(--danger)';
    const card = document.createElement('div');
    card.className = 'lesson-card';
    card.style.borderLeftColor = color;
    card.innerHTML = `
        <div class="lesson-info">
            <div class="stats-head">
                <div class="lesson-subject">${esc(title)}</div>
                <div class="stats-percent" style="color: ${color}">${percent}%</div>
            </div>
            <div class="stats-bar"><div class="stats-fill" style="background: ${color}; width: ${percent}%;"></div></div>
            <div class="lesson-meta stats-meta">Посещено: ${present} из ${total}</div>
        </div>`;
    return card;
}

function exportAttendance() {
    const payload = { app: 'CollegeApps', version: 2, exported: new Date().toISOString(), attendance: attendanceData };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'посещаемость_' + getTodayString() + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function importAttendance(file) {
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const data = JSON.parse(reader.result);
            const src = (data && typeof data === 'object' && data.attendance) ? data.attendance : data;
            if (!src || typeof src !== 'object' || Array.isArray(src)) throw new Error('bad format');
            const valid = {};
            for (const [k, v] of Object.entries(src)) {
                if (v === 'present' || v === 'half' || v === 'absent') valid[k] = v;
            }
            const count = Object.keys(valid).length;
            if (!count) throw new Error('empty');
            if (!confirm('Импортировать ' + count + ' записей? Текущие данные будут заменены.')) return;
            attendanceData = valid;
            saveAttendance();
            renderCurrentTab();
        } catch (e) {
            alert('Не удалось прочитать файл. Ожидается JSON, созданный кнопкой «Экспорт».');
        }
    };
    reader.readAsText(file);
}

function resetAttendance() {
    if (!confirm('Удалить всю историю посещаемости? Это действие нельзя отменить.')) return;
    attendanceData = {};
    saveAttendance();
    renderCurrentTab();
}

/* ---------- Настройки ---------- */

function renderSettings() {
    const content = document.getElementById('content');
    const groupName = groupsList[selectedGroupIndex] ? groupsList[selectedGroupIndex].name : 'Не выбрана';
    content.innerHTML = `
        <h2 class="page-title">Настройки</h2>
        <div class="settings-group">
            <div class="settings-title">Оформление</div>
            <div class="settings-row settings-clickable" id="set-theme">
                <span>Светлая / Тёмная</span><span class="settings-emoji">🌓</span>
            </div>
        </div>
        <div class="settings-group">
            <div class="settings-title">Группа</div>
            <div class="settings-row"><span>Текущая группа</span><span class="settings-value">${esc(groupName)}</span></div>
        </div>
        <div class="settings-group">
            <div class="settings-title">Посещаемость</div>
            <div class="settings-row">
                <span>Порог «хорошей» посещаемости, %</span>
                <input type="number" id="set-threshold" class="num-input" min="0" max="100" value="${attendanceThreshold}">
            </div>
        </div>
        <div class="settings-group">
            <div class="settings-title">Данные</div>
            <div class="settings-row"><span>Обновлено</span><span class="settings-value" id="set-updated">${esc(agoText())}</span></div>
            <div class="settings-row"><span>Загрузить расписание заново</span><button class="btn" id="set-refresh">🔄 Обновить</button></div>
        </div>
        <div class="settings-group">
            <div class="settings-title">О приложении</div>
            <div class="settings-row"><span>Версия</span><span class="settings-value">${APP_VERSION}</span></div>
            <div class="settings-row"><span>Источник расписания</span><a class="settings-link" href="${SITE_URL}" target="_blank" rel="noopener">politech-nsk.ru</a></div>
        </div>`;
    document.getElementById('set-theme').addEventListener('click', toggleTheme);
    document.getElementById('set-refresh').addEventListener('click', () => refreshSchedules());
    document.getElementById('set-threshold').addEventListener('change', e => {
        let v = parseInt(e.target.value, 10);
        if (!Number.isFinite(v)) v = 70;
        attendanceThreshold = Math.min(100, Math.max(0, v));
        e.target.value = attendanceThreshold;
        localStorage.setItem('attThreshold', String(attendanceThreshold));
    });
}

/* ---------- Служебные обновления UI ---------- */

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
    if (currentTab === 'schedule' && groupsList.length) renderSchedule();
    updateUpdatedLabel();
}

/* ---------- Парсер расписания ---------- */

function findLessons(rawData, startRow, groupCol, targetDayName) {
    const lessons = [];
    let isCurrentDay = false;

    const teacherRegex = /^[А-ЯЁа-яё\-]+\.?\s*[А-ЯЁ]\.[А-ЯЁ]\.(?:\s*,\s*[А-ЯЁа-яё\-]+\.?\s*[А-ЯЁ]\.[А-ЯЁ]\.)*$/;
    const timeRegex = /\d{1,2}:\d{2}\s*[-–—]\s*\d{1,2}:\d{2}/g;

    for (let r = startRow; r < rawData.length; r++) {
        if (!rawData[r]) continue;

        const rowString = rawData[r].slice(0, 5).map(c => typeof c === 'string' ? c : '').join(' ').toUpperCase();
        const foundDay = DAYS.find(d => rowString.includes(d));

        if (foundDay) {
            if (isCurrentDay) break; // дошли до следующего дня
            isCurrentDay = (foundDay === targetDayName);
            // не continue: в этой же строке может быть первая пара
        }
        if (!isCurrentDay) continue;

        // 1. все временные интервалы строки (первые 6 колонок)
        let allTimes = [];
        let numCellStr = '';
        for (let c = 0; c < 6; c++) {
            const cell = rawData[r][c];
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

        allTimes = [...new Set(allTimes)];
        const finalTimes = allTimes.join(' / ');

        // 2. ячейки нашей группы (возможны подгруппы в соседних колонках)
        const texts = [];
        for (let c = groupCol; c <= Math.min(groupCol + 4, rawData[r].length - 1); c++) {
            if (rawData[r][c]) texts.push(String(rawData[r][c]).replace(/\n/g, ' ').trim());
        }

        let subject = '', teacher = '', room = '';
        for (const text of [...new Set(texts)]) {
            if (teacherRegex.test(text)) { if (!teacher) teacher = text; }
            else if (/\d{1,2}:\d{2}\s*[-–—]\s*\d{1,2}:\d{2}/.test(text)) { /* время уже собрано */ }
            else if (text === numCellStr) { /* номер пары */ }
            else if (/^[0-9]{1,4}[а-яА-Яa-zA-Z]?$/.test(text) || /^[0-9]{1,3}[\/][0-9]$/.test(text) ||
                     text.toLowerCase().includes('зал') || text.toLowerCase().includes('ауд') || text.toLowerCase().includes('спорт')) {
                if (!room) room = text;
            } else {
                if (text.length >= 2 && (!subject || text.length > subject.length)) subject = text;
            }
        }

        if (subject) lessons.push({ num: numCellStr || '•', time: finalTimes, subject: subject, teacher: teacher, room: room });
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

    document.getElementById('theme-btn').addEventListener('click', toggleTheme);
    document.getElementById('view-toggle').addEventListener('click', toggleView);
    document.getElementById('refresh-btn').addEventListener('click', () => refreshSchedules());
    document.querySelectorAll('.nav-item').forEach(el =>
        el.addEventListener('click', () => switchTab(el.dataset.tab)));
    document.getElementById('import-file').addEventListener('change', e => {
        const file = e.target.files && e.target.files[0];
        if (file) importAttendance(file);
        e.target.value = '';
    });

    // мгновенный старт из снапшота, затем фоновое обновление
    if (loadSnapshot()) {
        populateGroupSelector();
        restoreSelectedGroup();
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
