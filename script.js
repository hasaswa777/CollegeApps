function findLessons(rawData, startRow, groupCol, targetDayName) {
    let lessons = [];
    let isCurrentDay = false;
    const daysArr = ["ВОСКРЕСЕНЬЕ", "ПОНЕДЕЛЬНИК", "ВТОРНИК", "СРЕДА", "ЧЕТВЕРГ", "ПЯТНИЦА", "СУББОТА"];
    
    // Регулярка для поиска препода (Иванов И.И.)
    const teacherRegex = /^[А-ЯЁа-яё\-]+\s*[А-ЯЁ]\.\s*[А-ЯЁ]\./;
    const timeRegex = /\d{1,2}:\d{2}/;

    for (let r = startRow; r < rawData.length; r++) {
        if (!rawData[r]) continue;
        
        // 1. Ищем день недели в ЛЮБОЙ ячейке строки
        let rowString = rawData[r].map(c => typeof c === 'string' ? c : '').join(" ").toUpperCase();
        let foundDay = daysArr.find(d => rowString.includes(d));
        
        if (foundDay) {
            if (isCurrentDay) break; // Если собрали пары на сегодня, выходим
            isCurrentDay = (foundDay === targetDayName);
            continue;
        }

        if (!isCurrentDay) continue;

        // 2. Ищем время и номер пары (строго в 1-й и 2-й колонках)
        let time1 = "";
        let num1 = "";
        let col1 = rawData[r][1] ? String(rawData[r][1]).trim() : "";
        let col2 = rawData[r][2] ? String(rawData[r][2]).trim() : "";

        if (col1.match(/^\d{1,2}$/)) num1 = col1;
        if (col1.match(timeRegex)) time1 = col1;
        if (col2.match(timeRegex)) time1 = col2;

        // Если нашли время — значит это пара
        if (time1) {
            // Проверяем следующую строку на вторую часть времени
            let time2 = "";
            if (r + 1 < rawData.length) {
                let nextRowStr = rawData[r+1].map(c => typeof c === 'string' ? c : '').join(" ").toUpperCase();
                if (!daysArr.some(d => nextRowStr.includes(d))) {
                    let nextCol2 = rawData[r+1][2] ? String(rawData[r+1][2]).trim() : "";
                    if (nextCol2.match(timeRegex) && nextCol2 !== time1) time2 = nextCol2;
                }
            }

            let finalTimes = time1 + (time2 ? " / " + time2 : "");
            
            // 3. БЕРЕМ ДАННЫЕ СТРОГО ИЗ КОЛОНКИ ГРУППЫ
            let groupCell = rawData[r][groupCol] ? String(rawData[r][groupCol]).trim() : "";
            
            // Если в ячейке группы есть текст (и это не прочерк и не время)
            if (groupCell && groupCell !== "—" && !groupCell.match(timeRegex)) {
                // Разбиваем ячейку по переносу строки (Предмет \n Преподаватель)
                let lines = groupCell.split('\n').map(s => s.trim()).filter(s => s.length > 0);
                let subject = lines.length > 0 ? lines[0] : groupCell;
                let teacher = "";
                
                if (lines.length > 1) teacher = lines[1];

                // Если препода нет в ячейке, ищем его в соседних колонках справа
                if (!teacher) {
                    for(let c = groupCol + 1; c < groupCol + 3; c++) {
                         let neighbor = rawData[r][c] ? String(rawData[r][c]).trim() : "";
                         if (neighbor && teacherRegex.test(neighbor)) { teacher = neighbor; break; }
                    }
                }
                
                lessons.push({ num: num1 || "•", time: finalTimes, subject: subject, teacher: teacher, room: "" });
            }
            
            // Пропускаем вторую строку пары, если мы её прочитали
            if (time2) r++; 
        }
    }
    return lessons;
}