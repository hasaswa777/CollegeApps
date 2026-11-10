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
                await parseAndAddFile(arrayBuffer);
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

async function parseAndAddFile(arrayBuffer) {
    try {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(arrayBuffer);
        const worksheet = workbook.worksheets[0]; 
        
        let rawData = [];
        worksheet.eachRow((row, rowNumber) => {
            let rowData = [];
            row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                // Извлекаем чистый текст из ячейки
                let val = cell.value;
                if (val && typeof val === 'object' && val.richText) {
                    val = val.richText.map(t => t.text).join('');
                }
                rowData[colNumber - 1] = val || "";
            });
            rawData[rowNumber - 1] = rowData;
        });
        
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

// --- СТРОГИЙ ПОИСК (ТОЛЬКО В КОЛОНКЕ ГРУППЫ) ---
function findLessons(rawData, startRow, groupCol, targetDayName) {
    let lessons = [];
    let isCurrentDay = false;
    const daysArr = ["ВОСКРЕСЕНЬЕ", "ПОНЕДЕЛЬНИК", "ВТОРНИК", "СРЕДА", "ЧЕТВЕРГ", "ПЯТНИЦА", "СУББОТА"];
    
    const teacherRegex = /^[А-ЯЁа-яё\-]+\s*[А-ЯЁ]\.\s*[А-ЯЁ]\./; // Более мягкая проверка на препода (напр. Иванов И.И.)
    const timeRegex = /\d{1,2}:\d{2}/; // Просто ищем двоеточие (время)

    for (let r = startRow; r < rawData.length; r++) {
        if (!rawData[r]) continue;
        
        // Ищем день недели (строго в первых 2 колонках)
        let rowString = rawData[r].slice(0, 2).map(c => typeof c === 'string' ? c : '').join(" ").toUpperCase();
        let foundDay = daysArr.find(d => rowString.includes(d));
        
        if (foundDay) {
            if (isCurrentDay) break;
            isCurrentDay = (foundDay === targetDayName);
            continue;
        }

        if (!isCurrentDay) continue;

        // Ищем номер пары и время (строго в 1-й и 2-й колонке)
        let time1 = "";
        let num1 = "";
        let col1 = rawData[r][1] ? String(rawData[r][1]).trim() : "";
        let col2 = rawData[r][2] ? String(rawData[r][2]).trim() : "";

        if (col1.match(/^\d{1,2}$/)) num1 = col1;
        if (col1.match(timeRegex)) time1 = col1;
        if (col2.match(timeRegex)) time1 = col2;

        if (time1) {
            // Проверяем следующую строку на наличие второй части времени
            let time2 = "";
            if (r + 1 < rawData.length) {
                let nextRowStr = rawData[r+1].slice(0, 2).map(c => typeof c === 'string' ? c : '').join(" ").toUpperCase();
                if (!daysArr.some(d => nextRowStr.includes(d))) {
                    let nextCol2 = rawData[r+1][2] ? String(rawData[r+1][2]).trim() : "";
                    if (nextCol2.match(timeRegex) && nextCol2 !== time1) time2 = nextCol2;
                }
            }

            let finalTimes = time1 + (time2 ? " / " + time2 : "");
            
            // БЕРЕМ ДАННЫЕ СТРОГО ИЗ КОЛОНКИ ГРУППЫ
            let groupCell = rawData[r][groupCol] ? String(rawData[r][groupCol]).trim() : "";
            
            // Если в колонке группы пусто, значит это, скорее всего, "окно" или объединенная ячейка сверху
            if (groupCell && groupCell !== "—" && !groupCell.match(timeRegex)) {
                let lines = groupCell.split('\n').map(s => s.trim()).filter(s => s.length > 0);
                let subject = lines.length > 0 ? lines[0] : groupCell;
                let teacher = "";
                
                // Если преподаватель записан на следующей строке в той же ячейке
                if (lines.length > 1) teacher = lines[1];

                // Пытаемся найти препода в соседних колонках, если не нашли в ячейке
                if (!teacher) {
                    for(let c = groupCol + 1; c < groupCol + 3; c++) {
                         let neighbor = rawData[r][c] ? String(rawData[r][c]).trim() : "";
                         if (neighbor && teacherRegex.test(neighbor)) { teacher = neighbor; break; }
                    }
                }
                
                lessons.push({ num: num1 || "•", time: finalTimes, subject: subject, teacher: teacher, room: "" });
            }
            
            // Если следующая строка была продолжением этой же пары, пропускаем её
            if (time2) r++; 
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

        card.innerHTML = `
            <div class="lesson-time-block">
                <div class="lesson-num">${l.num}</div>
                <div class="lesson-time">${l.time.split('/')[0].trim()}</div>
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