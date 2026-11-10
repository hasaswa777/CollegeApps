const SITE_URL = 'https://' + 'politech-nsk.ru/index.php/studentam';
const BASE_URL = 'https://' + 'politech-nsk.ru';
const PROXY = 'https://' + 'schedule-proxy.ivanushca99.workers.dev/?url=';

let groupsDatabase = {}; 
let groupsList = [];
let selectedGroupIndex = 0;

document.addEventListener('DOMContentLoaded', () => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
    if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
        const hint = document.getElementById('ios-hint');
        if (hint) hint.style.display = 'block';
    }
    loadAllSchedules();
});

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
            document.getElementById('content').innerHTML = `<div class="loader">⏳ Загрузка (${count}/${excelUrls.length})...</div>`;
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
        renderSchedule();

    } catch (e) {
        console.error(e);
        showError("Ошибка загрузки. Проверьте интернет.");
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

    select.style.display = 'block';
    select.onchange = (e) => {
        selectedGroupIndex = parseInt(e.target.value);
        localStorage.setItem('selectedGroupName', groupsList[selectedGroupIndex].name);
        renderSchedule(); 
    };
}

function renderSchedule() {
    if (groupsList.length === 0) return;
    const group = groupsList[selectedGroupIndex];
    const data = groupsDatabase[group.name];
    if (!data) return;

    const days = ["ВОСКРЕСЕНЬЕ", "ПОНЕДЕЛЬНИК", "ВТОРНИК", "СРЕДА", "ЧЕТВЕРГ", "ПЯТНИЦА", "СУББОТА"];
    let todayIdx = new Date().getDay();
    let tomorrowIdx = (todayIdx + 1) % 7;
    
    let todayLessons = findLessons(data.rawData, data.rowIndex, data.colIndex, days[todayIdx]);
    let displayLessons = todayLessons;
    let displayDayName = days[todayIdx];
    
    if (todayLessons.length === 0) {
        let tomorrowLessons = findLessons(data.rawData, data.rowIndex, data.colIndex, days[tomorrowIdx]);
        if (tomorrowLessons.length > 0) {
            displayLessons = tomorrowLessons;
            displayDayName = days[tomorrowIdx] + " (Завтра)";
        }
    }

    document.getElementById('day-title').textContent = displayDayName;
    renderLessons(displayLessons);
}

// --- ПОЛНОСТЬЮ ПЕРЕПИСАННАЯ ЛОГИКА (КАК В ANDROID) ---
function findLessons(rawData, startRow, groupCol, targetDayName) {
    let lessons = [];
    let isCurrentDay = false;
    const daysArr = ["ВОСКРЕСЕНЬЕ", "ПОНЕДЕЛЬНИК", "ВТОРНИК", "СРЕДА", "ЧЕТВЕРГ", "ПЯТНИЦА", "СУББОТА"];
    
    const teacherRegex = /^[А-ЯЁа-яё\-]+\.?\s*[А-ЯЁ]\.[А-ЯЁ]\.(?:\s*,\s*[А-ЯЁа-яё\-]+\.?\s*[А-ЯЁ]\.[А-ЯЁ]\.)*$/;
    const timeRegex = /\d{1,2}:\d{2}\s*[-–—]\s*\d{1,2}:\d{2}/;

    for (let r = startRow; r < rawData.length; r++) {
        if (!rawData[r]) continue;
        
        let rowString = rawData[r].slice(0, 5).map(c => typeof c === 'string' ? c : '').join(" ").toUpperCase();
        let foundDay = daysArr.find(d => rowString.includes(d));
        
        if (foundDay) {
            if (isCurrentDay) break;
            isCurrentDay = (foundDay === targetDayName);
            continue;
        }

        if (!isCurrentDay) continue;

        // 1. Ищем номер пары и время (в первых колонках)
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

        // 2. Проверяем следующую строку (часто там вторая половина времени или номер)
        let time2 = "";
        let num2 = "";
        let nextRowIsDay = false;
        
        if (r + 1 < rawData.length) {
            let nextRowStr = rawData[r+1].slice(0, 5).map(c => typeof c === 'string' ? c : '').join(" ").toUpperCase();
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

        // 3. Если нашли время, значит это пара
        if (time1) {
            let isNextRowNewPair = num2 && num2.match(/^\d{1,2}$/) && num2 !== num1;
            let finalTimes = time1;
            if (!isNextRowNewPair && time2 && time2 !== time1) {
                finalTimes = time1 + " / " + time2;
            }

            let lessonNum = num1 || num2;
            let rowsToScan = isNextRowNewPair ? [r] : [r, r+1];
            
            // 4. Собираем ВСЕ тексты из строки (включая объединенные ячейки и соседние колонки)
            let texts = [];
            for (let row of rowsToScan) {
                if (row >= rawData.length) continue;
                for (let c = groupCol; c <= Math.min(groupCol + 5, rawData[row].length - 1); c++) {
                    if (rawData[row][c]) texts.push(String(rawData[row][c]).replace(/\n/g, " ").trim());
                }
            }

            let subject = "";
            let teacher = "";
            let room = "";

            // 5. Фильтруем тексты по регуляркам (как в Kotlin)
            for (let text of [...new Set(texts)]) {
                if (teacherRegex.test(text)) { if (!teacher) teacher = text; }
                else if (timeRegex.test(text)) { /* skip */ }
                else if (text === lessonNum) { /* skip */ }
                else if (text.match(/^[0-9]{1,4}[а-яА-Яa-zA-Z]?$/) || text.match(/^[0-9]{1,3}[\/\\\\][0-9]$/) || text.toLowerCase().includes("зал") || text.toLowerCase().includes("ауд") || text.toLowerCase().includes("спорт")) {
                    if (!room) room = text;
                } else {
                    // Если текст длинный и не похож на кабинет/преподавателя — это предмет
                    if (text.length >= 2 && (!subject || text.length > subject.length)) subject = text;
                }
            }

            if (subject) {
                lessons.push({ num: lessonNum, time: finalTimes, subject, teacher, room });
            }
            
            // Сдвигаем указатель, если мы поглотили вторую строку
            if (!isNextRowNewPair && time2) r++; 
        }
    }
    return lessons;
}

function renderLessons(lessons) {
    const content = document.getElementById('content');
    if (lessons.length === 0) {
        content.innerHTML = '<div class="loader">🎉 Пар нет!</div>';
        return;
    }

    content.innerHTML = '';
    lessons.forEach(l => {
        const card = document.createElement('div');
        card.className = 'lesson-card';
        
        let metaHtml = '';
        if (l.teacher) metaHtml += `<span>${l.teacher}</span>`;
        if (l.room) metaHtml += `<span class="room-badge">ауд. ${l.room}</span>`;

        card.innerHTML = `
            <div class="lesson-time-block">
                <div class="lesson-num">${l.num || '•'}</div>
                <div class="lesson-time">${l.time.split('/')[0].split('-')[0].trim()}</div>
            </div>
            <div class="lesson-info">
                <div class="lesson-subject">${l.subject}</div>
                <div class="lesson-meta">${metaHtml}</div>
            </div>
        `;
        content.appendChild(card);
    });
}

function showError(msg) {
    document.getElementById('content').innerHTML = `<div class="error">${msg}</div>`;
}