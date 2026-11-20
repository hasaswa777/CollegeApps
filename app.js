// Константы
const SITE_URL = 'https://politech-nsk.ru/index.php/studentam';
const BASE_URL = 'https://politech-nsk.ru';
const PROXY = 'https://schedule-proxy.ivanushca99.workers.dev/?url=';

// Состояние
let groupsDatabase = {}; 
let groupsList = [];
let selectedGroupIndex = 0;
let currentViewMode = 'day'; // 'day' или 'week'
let currentTab = 'schedule'; // 'schedule', 'attendance', 'settings'
let attendanceData = JSON.parse(localStorage.getItem('attendance')) || {};

document.addEventListener('DOMContentLoaded', () => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
    if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
        document.getElementById('ios-hint').style.display = 'block';
    }
    
    // Восстановление темы
    if (localStorage.getItem('theme') === 'light') {
        document.body.classList.add('light');
    }
    
    loadAllSchedules();
});

// --- НАВИГАЦИЯ ---
function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.getElementById(`nav-${tab}`).classList.add('active');
    
    // Скрываем/показываем элементы шапки
    document.getElementById('group-select').style.display = tab === 'schedule' ? 'block' : 'none';
    document.getElementById('view-toggle').style.display = tab === 'schedule' ? 'inline' : 'none';

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

// --- ЗАГРУЗКА ДАННЫХ ---
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

        if (excelUrls.length === 0) throw new Error("Файлы не найдены");
        
        let count = 0;
        for (let url of excelUrls) {
            count++;
            document.getElementById('content').innerHTML = `<div class="loader">Загрузка (${count}/${excelUrls.length})...</div>`;
            try {
                const fileRes = await fetch(PROXY + encodeURIComponent(url));
                const arrayBuffer = await fileRes.arrayBuffer();
                parseAndAddFile(arrayBuffer);
            } catch (e) { console.warn("Ошибка файла: " + url, e); }
        }

        if (groupsList.length === 0) throw new Error("Группы не найдены");

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
        
        switchTab('schedule'); // Открываем вкладку по умолчанию

    } catch (e) {
        console.error(e);
        document.getElementById('content').innerHTML = `<div class="error">Ошибка: ${e.message}</div>`;
    }
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
}

function changeGroup(val) {
    selectedGroupIndex = parseInt(val);
    localStorage.setItem('selectedGroupName', groupsList[selectedGroupIndex].name);
    renderSchedule();
}

// --- РЕНДЕРИНГ ---
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
            content.innerHTML = '<div class="empty-msg">Занятий нет</div>';
            return;
        }

        const dayBlock = document.createElement('div');
        dayBlock.className = 'day-block';
        dayBlock.innerHTML = `<div class="day-title ${isToday ? 'today' : ''}">${displayDayName}</div>`;
        displayLessons.forEach(l => dayBlock.appendChild(createLessonCard(l, isToday)));
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
                lessons.forEach(l => dayBlock.appendChild(createLessonCard(l, isToday)));
                content.appendChild(dayBlock);
            }
        });

        if (!hasAny) content.innerHTML = '<div class="empty-msg">На неделю пар нет</div>';
    }
}

function createLessonCard(l, isToday) {
    const card = document.createElement('div');
    card.className = `lesson-card ${isToday ? 'today' : ''}`;
    
    // Проверяем посещаемость
    const dateStr = getTodayString();
    const record = attendanceData[`${dateStr}_${l.subject}`];
    let statusIcon = '⚪';
    let statusColor = 'var(--text-muted)';
    if (record === 'present') { statusIcon = '✅'; statusColor = 'var(--success)'; }
    else if (record === 'half') { statusIcon = '🟡'; statusColor = 'var(--warning)'; }
    else if (record === 'absent') { statusIcon = '❌'; statusColor = 'var(--danger)'; }

    let metaHtml = '';
    if (l.teacher) metaHtml += `<span>${l.teacher}</span>`;
    if (l.room) metaHtml += `<span class="room-badge">ауд. ${l.room}</span>`;

    let displayTime = l.time.split('/')[0].trim();

    card.innerHTML = `
        <div class="lesson-time-block">
            <div class="lesson-num">${l.num || '•'}</div>
            <div class="lesson-time">${displayTime}</div>
        </div>
        <div class="lesson-info">
            <div class="lesson-subject">${l.subject}</div>
            <div class="lesson-meta">${metaHtml}</div>
        </div>
        ${isToday ? `<button class="attendance-btn" style="color: ${statusColor}" onclick="markAttendance('${l.subject}', '${l.num}')">${statusIcon}</button>` : ''}
    `;
    return card;
}

// --- ПОСЕЩАЕМОСТЬ ---
function getTodayString() {
    let d = new Date();
    return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
}

function markAttendance(subject, num) {
    const dateStr = getTodayString();
    const key = `${dateStr}_${subject}`;
    
    const statuses = ['present', 'half', 'absent', null];
    let current = attendanceData[key] || null;
    let nextIndex = (statuses.indexOf(current) + 1) % statuses.length;
    let nextStatus = statuses[nextIndex];
    
    if (nextStatus) attendanceData[key] = nextStatus;
    else delete attendanceData[key];
    
    localStorage.setItem('attendance', JSON.stringify(attendanceData));
    renderSchedule(); // Перерисовываем
}

function renderAttendance() {
    const content = document.getElementById('content');
    content.innerHTML = '<h2 style="margin-bottom:16px;">Посещаемость</h2>';
    
    const stats = {};
    for (const [key, status] of Object.entries(attendanceData)) {
        const subject = key.split('_')[1];
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

// --- НАСТРОЙКИ ---
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
            <div style="font-size:12px; color:var(--text-muted); margin-top:8px;">
                Чтобы сменить группу, вернитесь на вкладку «Расписание» и выберите нужную в выпадающем списке.
            </div>
        </div>
        
        <div class="settings-group">
            <div class="settings-title">О приложении</div>
            <div class="settings-row">
                <span>Версия</span>
                <span>Web 1.0</span>
            </div>
            <div class="settings-row">
                <span>Разработчик</span>
                <span>CollegeApp</span>
            </div>
        </div>
    `;
}

// --- ЛОГИКА ПОИСКА (КАК В ANDROID) ---
function findLessons(rawData, startRow, groupCol, targetDayName) {
    let lessons = [];
    let isCurrentDay = false;
    const daysArr = ["ВОСКРЕСЕНЬЕ", "ПОНЕДЕЛЬНИК", "ВТОРНИК", "СРЕДА", "ЧЕТВЕРГ", "ПЯТНИЦА", "СУББОТА"];
    
    const teacherRegex = /^[А-ЯЁа-яё\-]+\.?\s*[А-ЯЁ]\.[А-ЯЁ]\.(?:\s*,\s*[А-ЯЁа-яё\-]+\.?\s*[А-ЯЁ]\.[А-ЯЁ]\.)*$/;
    const timeRegex = /\d{1,2}:\d{2}\s*[-–—]\s*\d{1,2}:\d{2}/;

    for (let r = startRow; r < rawData.length; r++) {
        if (!rawData[r]) continue;
        
        let rowString = rawData[r].slice(0, 4).map(c => typeof c === 'string' ? c : '').join(" ").toUpperCase();
        let foundDay = daysArr.find(d => rowString.includes(d));
        
        if (foundDay) {
            if (isCurrentDay) break;
            isCurrentDay = (foundDay === targetDayName);
            continue;
        }

        if (!isCurrentDay) continue;

        let time1 = "";
        let num1 = "";
        for(let c=1; c<5; c++) {
            let cell = rawData[r][c];
            if (typeof cell === 'string') {
                let match = cell.match(timeRegex);
                if (match) time1 = match[0];
                if (cell.match(/^\d{1,2}$/)) num1 = cell;
            }
        }

        if (time1) {
            let time2 = "";
            let num2 = "";
            let nextRowIsDay = false;
            
            if (r + 1 < rawData.length) {
                let nextRowStr = rawData[r + 1].slice(0, 4).map(c => typeof c === 'string' ? c : '').join(" ").toUpperCase();
                nextRowIsDay = daysArr.some(d => nextRowStr.includes(d));
                
                if (!nextRowIsDay) {
                    for(let c=1; c<5; c++) {
                        let cell = rawData[r+1][c];
                        if (typeof cell === 'string') {
                            let match = cell.match(timeRegex);
                            if (match) time2 = match[0];
                            if (cell.match(/^\d{1,2}$/)) num2 = cell;
                        }
                    }
                }
            }

            let isNextRowNewPair = num2 && num2.match(/^\d{1,2}$/) && num2 !== num1;
            let finalTimes = time1;
            if (!isNextRowNewPair && time2 && time2 !== time1) finalTimes = time1 + " / " + time2;

            let lessonNum = num1 || num2;
            let rowsToScan = isNextRowNewPair ? [r] : [r, r+1];
            
            let texts = [];
            for (let row of rowsToScan) {
                if (row >= rawData.length) continue;
                for (let c = groupCol; c <= Math.min(groupCol + 4, rawData[row].length - 1); c++) {
                    if (rawData[row][c]) texts.push(String(rawData[row][c]).replace(/\n/g, " ").trim());
                }
            }

            let subject = "", teacher = "", room = "";

            for (let text of [...new Set(texts)]) {
                if (teacherRegex.test(text)) { if (!teacher) teacher = text; }
                else if (timeRegex.test(text)) { }
                else if (text === lessonNum) { }
                else if (text.match(/^[0-9]{1,4}[а-яА-Яa-zA-Z]?$/) || text.match(/^[0-9]{1,3}[\/\\\\][0-9]$/) || text.toLowerCase().includes("зал") || text.toLowerCase().includes("ауд") || text.toLowerCase().includes("спорт")) {
                    if (!room) room = text;
                } else {
                    if (text.length >= 2 && (!subject || text.length > subject.length)) subject = text;
                }
            }

            if (subject) lessons.push({ num: lessonNum, time: finalTimes, subject, teacher, room });
            
            if (!isNextRowNewPair && time2) r++; 
        }
    }
    return lessons;
}
