const SITE_URL = 'https://politech-nsk.ru/index.php/studentam';
const BASE_URL = 'https://politech-nsk.ru';
const PROXY = 'https://schedule-proxy.ivanushca99.workers.dev/?url=';

let groupsDatabase = {}; 
let groupsList = [];
let selectedGroupIndex = 0;
let currentViewMode = 'day';
let currentTab = 'schedule';
let attendanceData = JSON.parse(localStorage.getItem('attendance')) || {};

document.addEventListener('DOMContentLoaded', () => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
    if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
        document.getElementById('ios-hint').style.display = 'block';
    }
    if (localStorage.getItem('theme') === 'light') {
        document.body.classList.add('light');
    }
    loadAllSchedules();
});

function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.getElementById(`nav-${tab}`).classList.add('active');
    
    const groupSelect = document.getElementById('group-select');
    const viewToggle = document.getElementById('view-toggle');
    
    if (tab === 'schedule') {
        groupSelect.style.display = groupsList.length > 0 ? 'block' : 'none';
        viewToggle.style.display = 'inline-block';
    } else {
        groupSelect.style.display = 'none';
        viewToggle.style.display = 'none';
    }

    renderCurrentTab();
}

function toggleTheme() {
    document.body.classList.toggle('light');
    localStorage.setItem('theme', document.body.classList.contains('light') ? 'light' : 'dark');
}

function toggleView() {
    if (currentTab !== 'schedule') return;
    currentViewMode = currentViewMode === 'day' ? 'week' : 'day';
    renderSchedule();
}

async function loadAllSchedules() {
    try {
        const response = await fetch(PROXY + encodeURIComponent(SITE_URL));
        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const links = Array.from(doc.querySelectorAll('a[href]'));
        
        let excelUrls = [];
        for (let link of links) {
            const href = link.getAttribute('href');
            if (href && (href.toLowerCase().includes('.xlsx') || href.toLowerCase().includes('.xls'))) {
                let fullUrl = href.startsWith('http') ? href : BASE_URL + href;
                if (!excelUrls.includes(fullUrl)) excelUrls.push(fullUrl);
            }
        }

        if (excelUrls.length === 0) {
            enableDemoMode();
            return;
        }
        
        let count = 0;
        for (let url of excelUrls) {
            count++;
            document.getElementById('content').innerHTML = `<div class="loader">Загрузка файла (${count}/${excelUrls.length})...</div>`;
            try {
                const fileRes = await fetch(PROXY + encodeURIComponent(url));
                const arrayBuffer = await fileRes.arrayBuffer();
                parseAndAddFile(arrayBuffer);
            } catch (e) { console.warn("Ошибка файла: " + url, e); }
        }

        if (groupsList.length === 0) {
            enableDemoMode();
            return;
        }

        groupsList.sort((a, b) => a.course - b.course || a.name.localeCompare(b.name));
        populateGroupSelector();
        
        const savedGroupName = localStorage.getItem('selectedGroupName');
        if (savedGroupName) {
            const idx = groupsList.findIndex(g => g.name === savedGroupName);
            if (idx !== -1) {
                selectedGroupIndex = idx;
                document.getElementById('group-select').value = selectedGroupIndex;
            }
        }
        
        switchTab('schedule');

    } catch (e) {
        console.error(e);
        enableDemoMode();
    }
}

function enableDemoMode() {
    groupsList = [{ name: "224 СА (Демо)", course: 2 }];
    groupsDatabase["224 СА (Демо)"] = {
        rawData: [
            ["День", "Пара", "Время", "Группа"],
            ["ПОНЕДЕЛЬНИК", "1", "8:30 - 9:15", "Демо-предмет"],
            ["ВТОРНИК", "2", "10:30 - 11:15", "Демо-предмет"]
        ],
        rowIndex: 1, colIndex: 3
    };
    populateGroupSelector();
    switchTab('schedule');
    setTimeout(() => {
        document.getElementById('content').innerHTML = `
            <div class="error">Сайт колледжа временно недоступен. Показано демо-расписание.</div>
        ` + document.getElementById('content').innerHTML;
    }, 100);
}

function parseAndAddFile(arrayBuffer) {
    try {
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        let rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
        
        rawData.forEach((row, rowIndex) => {
            row.forEach((cell, colIndex) => {
                if (typeof cell === 'string' && cell.trim().length > 2) {
                    if (/^\d{3}\s+[А-ЯЁA-Z]{2,4}/.test(cell.trim())) {
                        let groupName = cell.trim();
                        if (!groupsDatabase[groupName]) {
                            let numMatch = groupName.match(/\d+/);
                            let baseNum = numMatch ? numMatch[0] : "0";
                            let courseDigit = parseInt(baseNum.charAt(baseNum.length - 1));
                            
                            let realCourse = courseDigit;
                            if (courseDigit === 6) realCourse = 1;
                            else if (courseDigit === 5) realCourse = 2;
                            else if (courseDigit === 4) realCourse = 3;
                            else if (courseDigit === 3) realCourse = 4;

                            groupsDatabase[groupName] = {
                                rawData: rawData,
                                rowIndex: rowIndex,
                                colIndex: colIndex
                            };
                            groupsList.push({ name: groupName, course: realCourse });
                        }
                    }
                }
            });
        });
    } catch (e) { console.warn("Ошибка парсинга", e); }
}

function populateGroupSelector() {
    const select = document.getElementById('group-select');
    select.innerHTML = '';
    let currentCourse = -1;
    let optgroup = null;

    groupsList.forEach((g, i) => {
        if (g.course !== currentCourse) {
            currentCourse = g.course;
            optgroup = document.createElement('optgroup');
            optgroup.label = `${currentCourse} курс`;
            select.appendChild(optgroup);
        }
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = g.name;
        optgroup.appendChild(opt);
    });

    select.style.display = 'block';
    select.onchange = (e) => {
        selectedGroupIndex = parseInt(e.target.value);
        localStorage.setItem('selectedGroupName', groupsList[selectedGroupIndex].name);
        renderSchedule(); 
    };
}

function renderCurrentTab() {
    if (currentTab === 'schedule') renderSchedule();
    else if (currentTab === 'attendance') renderAttendance();
    else if (currentTab === 'settings') renderSettings();
}

function renderSchedule() {
    if (groupsList.length === 0) return;
    const group = groupsList[selectedGroupIndex];
    const data = groupsDatabase[group.name];
    if (!data) return;

    const content = document.getElementById('content');
    content.innerHTML = '';

    if (currentViewMode === 'day') {
        const days = ["ВОСКРЕСЕНЬЕ", "ПОНЕДЕЛЬНИК", "ВТОРНИК", "СРЕДА", "ЧЕТВЕРГ", "ПЯТНИЦА", "СУББОТА"];
        let todayIdx = new Date().getDay();
        let tomorrowIdx = (todayIdx + 1) % 7;
        
        let todayLessons = findLessons(data.rawData, data.rowIndex, data.colIndex, days[todayIdx]);
        let displayLessons = todayLessons;
        let displayDayName = days[todayIdx];
        let isToday = true;
        
        if (todayLessons.length === 0) {
            let tomorrowLessons = findLessons(data.rawData, data.rowIndex, data.colIndex, days[tomorrowIdx]);
            if (tomorrowLessons.length > 0) {
                displayLessons = tomorrowLessons;
                displayDayName = days[tomorrowIdx] + " (Завтра)";
                isToday = false;
            }
        }

        if (displayLessons.length === 0) {
            content.innerHTML = '<div class="empty-msg">Занятий нет 🎉</div>';
            return;
        }

        const dayBlock = document.createElement('div');
        dayBlock.className = 'day-block';
        dayBlock.innerHTML = `<div class="day-title ${isToday ? 'today' : ''}">${displayDayName}</div>`;
        displayLessons.forEach((l, idx) => dayBlock.appendChild(createLessonCard(l, isToday, idx)));
        content.appendChild(dayBlock);

    } else {
        const daysOrder = ["ПОНЕДЕЛЬНИК", "ВТОРНИК", "СРЕДА", "ЧЕТВЕРГ", "ПЯТНИЦА", "СУББОТА"];
        const todayName = ["ВОСКРЕСЕНЬЕ", "ПОНЕДЕЛЬНИК", "ВТОРНИК", "СРЕДА", "ЧЕТВЕРГ", "ПЯТНИЦА", "СУББОТА"][new Date().getDay()];
        
        let hasAny = false;
        daysOrder.forEach(dayName => {
            const lessons = findLessons(data.rawData, data.rowIndex, data.colIndex, dayName);
            if (lessons.length > 0) {
                hasAny = true;
                const isToday = dayName === todayName;
                const dayBlock = document.createElement('div');
                dayBlock.className = 'day-block';
                dayBlock.innerHTML = `<div class="day-title ${isToday ? 'today' : ''}">${dayName}</div>`;
                lessons.forEach((l, idx) => dayBlock.appendChild(createLessonCard(l, isToday, idx)));
                content.appendChild(dayBlock);
            }
        });

        if (!hasAny) content.innerHTML = '<div class="empty-msg">На неделю пар нет</div>';
    }
}

function createLessonCard(l, isToday, idx) {
    const card = document.createElement('div');
    card.className = `lesson-card ${isToday ? 'today' : ''}`;
    
    const dateStr = getTodayString();
    const uniqueId = `${dateStr}_${l.subject}_${l.time}_${l.num}`;
    const record = attendanceData[uniqueId];
    
    let statusIcon = '⚪';
    let statusColor = 'var(--text-muted)';
    if (record === 'present') { statusIcon = '✅'; statusColor = 'var(--success)'; }
    else if (record === 'half') { statusIcon = '🟡'; statusColor = 'var(--warning)'; }
    else if (record === 'absent') { statusIcon = '❌'; statusColor = 'var(--danger)'; }

    let metaHtml = '';
    if (l.teacher) metaHtml += `<span>${l.teacher}</span>`;
    if (l.room) metaHtml += `<span class="room-badge">ауд. ${l.room}</span>`;

    // Убираем обрезку времени, выводим полностью. Если слишком длинно — CSS перенесет
    card.innerHTML = `
        <div class="lesson-time-block">
            <div class="lesson-num">${l.num || '•'}</div>
            <div class="lesson-time" style="white-space: normal; word-break: break-word; font-size: 10px;">${l.time}</div>
        </div>
        <div class="lesson-info">
            <div class="lesson-subject">${l.subject}</div>
            <div class="lesson-meta">${metaHtml}</div>
        </div>
        ${isToday ? `<button class="attendance-btn" style="color: ${statusColor}" onclick="markAttendance('${uniqueId}')">${statusIcon}</button>` : ''}
    `;
    return card;
}

function getTodayString() {
    let d = new Date();
    return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
}

function markAttendance(uniqueId) {
    const statuses = ['present', 'half', 'absent', null];
    let current = attendanceData[uniqueId] || null;
    let nextIndex = (statuses.indexOf(current) + 1) % statuses.length;
    let nextStatus = statuses[nextIndex];
    
    if (nextStatus) attendanceData[uniqueId] = nextStatus;
    else delete attendanceData[uniqueId];
    
    localStorage.setItem('attendance', JSON.stringify(attendanceData));
    renderSchedule();
}

function renderAttendance() {
    const content = document.getElementById('content');
    content.innerHTML = '<h2 style="margin-bottom:16px;">Посещаемость</h2>';
    
    const stats = {};
    for (const [key, status] of Object.entries(attendanceData)) {
        const parts = key.split('_');
        if (parts.length < 2) continue;
        const subject = parts[1];
        
        if (!stats[subject]) stats[subject] = { present: 0, total: 0 };
        stats[subject].total++;
        
        if (status === 'present') stats[subject].present += 1;
        else if (status === 'half') stats[subject].present += 0.5;
    }
    
    const subjects = Object.keys(stats).sort();
    if (subjects.length === 0) {
        content.innerHTML += '<div class="empty-msg">Нет данных. Отметьте пары в расписании.</div>';
        return;
    }
    
    subjects.forEach(sub => {
        const s = stats[sub];
        const percent = s.total === 0 ? 0 : Math.round((s.present / s.total) * 100);
        const color = percent >= 70 ? 'var(--success)' : 'var(--danger)';
        
        const card = document.createElement('div');
        card.className = 'lesson-card';
        card.style.borderLeftColor = color;
        card.innerHTML = `
            <div class="lesson-info">
                <div style="display:flex; justify-content:space-between;">
                    <div class="lesson-subject">${sub}</div>
                    <div style="font-weight:bold; color:${color};">${percent}%</div>
                </div>
                <div style="background:var(--border); height:6px; border-radius:3px; margin-top:8px; overflow:hidden;">
                    <div style="background:${color}; width:${percent}%; height:100%;"></div>
                </div>
                <div class="lesson-meta" style="margin-top:6px;">Посещено: ${s.present} из ${s.total}</div>
            </div>
        `;
        content.appendChild(card);
    });
}

function renderSettings() {
    const content = document.getElementById('content');
    content.innerHTML = `
        <h2 style="margin-bottom:16px;">Настройки</h2>
        
        <div class="settings-group">
            <div class="settings-title">Тема оформления</div>
            <div class="settings-row" onclick="toggleTheme()">
                <span>Светлая / Тёмная</span>
                <span style="font-size:20px;">🌓</span>
            </div>
        </div>

        <div class="settings-group">
            <div class="settings-title">Группа</div>
            <div class="settings-row">
                <span>Текущая группа</span>
                <span style="color:var(--accent); font-weight:bold;">${groupsList[selectedGroupIndex]?.name || 'Не выбрана'}</span>
            </div>
        </div>
    `;
}

// --- САМЫЙ УМНЫЙ ПАРСЕР (С ПОИСКОМ ВСЕХ ВРЕМЕН И ПЕРВЫХ ПАР) ---
function findLessons(rawData, startRow, groupCol, targetDayName) {
    let lessons = [];
    let isCurrentDay = false;
    const daysArr = ["ВОСКРЕСЕНЬЕ", "ПОНЕДЕЛЬНИК", "ВТОРНИК", "СРЕДА", "ЧЕТВЕРГ", "ПЯТНИЦА", "СУББОТА"];
    
    const teacherRegex = /^[А-ЯЁа-яё\-]+\.?\s*[А-ЯЁ]\.[А-ЯЁ]\.(?:\s*,\s*[А-ЯЁа-яё\-]+\.?\s*[А-ЯЁ]\.[А-ЯЁ]\.)*$/;
    const timeRegex = /\d{1,2}:\d{2}\s*[-–—]\s*\d{1,2}:\d{2}/g; // Флаг g для поиска всех совпадений

    for (let r = startRow; r < rawData.length; r++) {
        if (!rawData[r]) continue;
        
        let rowString = rawData[r].slice(0, 5).map(c => typeof c === 'string' ? c : '').join(" ").toUpperCase();
        let foundDay = daysArr.find(d => rowString.includes(d));
        
        if (foundDay) {
            if (isCurrentDay) break; // Мы дошли до следующего дня, выходим
            isCurrentDay = (foundDay === targetDayName);
            
            // ВАЖНО: Не делаем continue! В этой же строке может быть первая пара (например, 8:30)
        }

        if (!isCurrentDay) continue;

        // 1. Ищем ВСЕ временные интервалы в строке (в первых 6 колонках)
        let allTimes = [];
        let numCellStr = "";
        for(let c=0; c<6; c++) {
            let cell = rawData[r][c];
            if (typeof cell === 'string') {
                // Ищем все интервалы времени
                let matches = cell.match(timeRegex);
                if (matches) allTimes.push(...matches);
                
                // Запоминаем первую попавшуюся цифру от 1 до 9 как номер пары
                let trimmed = cell.trim();
                if (!numCellStr && (/^[1-9]$/.test(trimmed) || /^[1-9]\s*пара$/i.test(trimmed))) {
                    numCellStr = trimmed.replace(/\D/g, '');
                }
            }
        }

        if (allTimes.length === 0) continue; // Если времени нет, это не пара

        // Убираем дубликаты времени, если вдруг нашли одно и то же
        allTimes = [...new Set(allTimes)];
        let finalTimes = allTimes.join(" / ");

        // 2. Проверяем, есть ли на этой строке пары для нашей группы
        let texts = [];
        for (let c = groupCol; c <= Math.min(groupCol + 4, rawData[r].length - 1); c++) {
            if (rawData[r][c]) texts.push(String(rawData[r][c]).replace(/\n/g, " ").trim());
        }

        // Если в этой строке есть название предмета (для нашей группы)
        let subject = "", teacher = "", room = "";

        for (let text of [...new Set(texts)]) {
            if (teacherRegex.test(text)) { if (!teacher) teacher = text; }
            // Игнорируем время (т.к. мы его уже собрали)
            else if (/\d{1,2}:\d{2}\s*[-–—]\s*\d{1,2}:\d{2}/.test(text)) { }
            else if (text === numCellStr) { }
            else if (text.match(/^[0-9]{1,4}[а-яА-Яa-zA-Z]?$/) || text.match(/^[0-9]{1,3}[\/\\\\][0-9]$/) || text.toLowerCase().includes("зал") || text.toLowerCase().includes("ауд") || text.toLowerCase().includes("спорт")) {
                if (!room) room = text;
            } else {
                if (text.length >= 2 && (!subject || text.length > subject.length)) subject = text;
            }
        }

        // Если нашли предмет — добавляем пару!
        if (subject) {
            lessons.push({ num: numCellStr || "•", time: finalTimes, subject, teacher, room });
        }
    }
    return lessons;
}
