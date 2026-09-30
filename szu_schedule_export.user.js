// ==UserScript==
// @name         深大课表一键导出 .ics
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  深圳大学教务系统课表一键导出 .ics 日历文件，导入到深大智能课表或手机日历
// @author       SZU Schedule
// @match        *://ehall.szu.edu.cn/jwapp/sys/wdkb/*
// @match        *://ehall.szu.edu.cn/jwapp/sys/xskb/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // ========== 深大作息时间 ==========
    const PERIOD_TIMES = {
        1:  { start: '08:30', end: '09:15' },
        2:  { start: '09:20', end: '10:05' },
        3:  { start: '10:25', end: '11:10' },
        4:  { start: '11:15', end: '12:00' },
        5:  { start: '14:00', end: '14:45' },
        6:  { start: '14:55', end: '15:40' },
        7:  { start: '15:50', end: '16:35' },
        8:  { start: '16:40', end: '17:25' },
        9:  { start: '19:00', end: '19:45' },
        10: { start: '19:50', end: '20:35' },
        11: { start: '20:40', end: '21:25' },
        12: { start: '21:30', end: '22:15' }
    };

    // ========== 创建悬浮按钮 ==========
    function createButton() {
        const btn = document.createElement('div');
        btn.id = 'szu-ics-export-btn';
        btn.innerHTML = '📥 导出课表';
        btn.style.cssText = `
            position: fixed;
            top: 100px;
            right: 20px;
            z-index: 2147483647;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 12px 20px;
            border-radius: 25px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
            transition: all 0.2s ease;
            user-select: none;
            font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
        `;
        btn.onmouseenter = () => {
            btn.style.transform = 'translateY(-2px) scale(1.05)';
        };
        btn.onmouseleave = () => {
            btn.style.transform = 'translateY(0) scale(1)';
        };
        btn.onclick = handleExport;
        document.body.appendChild(btn);
    }

    // ========== 显示提示 ==========
    function showTip(text, isError) {
        const btn = document.getElementById('szu-ics-export-btn');
        if (!btn) return;
        const originalText = btn.innerHTML;
        btn.innerHTML = isError ? '❌ ' + text : '✅ ' + text;
        btn.style.background = isError ? '#ff4d4f' : '#52c41a';
        setTimeout(() => {
            btn.innerHTML = originalText;
            btn.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
        }, 3000);
    }

    // ========== 获取课表数据 ==========
    function getScheduleData() {
        return new Promise((resolve, reject) => {
            // 方法1：直接调用教务系统接口
            const url = '/jwapp/sys/wdkb/modules/xskcb/cxxszhxqkb.do';

            fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                credentials: 'include'
            })
            .then(res => res.json())
            .then(data => {
                const rows = data?.datas?.xskcb?.rows;
                if (rows && rows.length > 0) {
                    resolve(rows);
                } else {
                    // 方法2：尝试另一个接口路径
                    return fetch('/jwapp/sys/xskb/modules/xskb/cxxsxqkb.do', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded',
                            'X-Requested-With': 'XMLHttpRequest'
                        },
                        credentials: 'include'
                    }).then(r => r.json());
                }
            })
            .then(data => {
                if (data && Array.isArray(data)) {
                    resolve(data);
                } else if (data?.datas?.xskcb?.rows) {
                    resolve(data.datas.xskcb.rows);
                } else if (data?.datas?.xskb?.rows) {
                    resolve(data.datas.xskb.rows);
                } else {
                    // 方法3：从页面 DOM 中提取
                    const fromDom = extractFromDOM();
                    if (fromDom && fromDom.length > 0) {
                        resolve(fromDom);
                    } else {
                        reject(new Error('未找到课表数据，请确保课表页面已加载完成'));
                    }
                }
            })
            .catch(() => {
                // 接口失败，尝试 DOM 提取
                const fromDom = extractFromDOM();
                if (fromDom && fromDom.length > 0) {
                    resolve(fromDom);
                } else {
                    reject(new Error('获取失败，请刷新页面后重试'));
                }
            });
        });
    }

    // ========== 从 DOM 提取（兜底）==========
    function extractFromDOM() {
        const courses = [];
        // 尝试查找课表表格中的课程元素
        const items = document.querySelectorAll('.kb-item, .course-item, [class*="kb-list"], [class*="course-info"]');
        if (items.length === 0) return null;

        // 这个方法不太可靠，作为兜底
        return courses.length > 0 ? courses : null;
    }

    // ========== 解析课表数据并生成 ICS ==========
    function generateICS(rows) {
        if (!rows || rows.length === 0) return '';

        const CRLF = '\r\n'; // ICS 标准要求 CRLF 换行

        // 提取学期信息
        const firstRow = rows[0];
        const xnxqdm = firstRow.XNXQDM || firstRow.XNXQ || '2026-2027-1';

        // 计算开学日期
        const termStart = getTermStart(rows);

        // 合并同一门课的不同周次
        const courseMap = new Map();

        for (const row of rows) {
            const name = row.KCM || row.kcm || '';
            const teacher = row.SKJS || row.skjs || row.JS || '';
            const location = row.JASMC || row.jasmc || row.JS || '';
            const dayOfWeek = parseInt(row.SKXQ || row.skxq || row.XQ || 0);
            const startPeriod = parseInt(row.KSJC || row.ksjc || row.KCJCDM || 0);
            const endPeriod = parseInt(row.JSJC || row.jsjc || row.KCJCDM2 || 0);
            const skzc = row.SKZC || row.skzc || row.ZC || '';

            if (!name || dayOfWeek < 1 || startPeriod < 1) continue;

            const key = `${name}_${dayOfWeek}_${startPeriod}_${endPeriod}_${location}`;
            if (!courseMap.has(key)) {
                courseMap.set(key, {
                    name, teacher, location, dayOfWeek, startPeriod, endPeriod,
                    weeks: new Set()
                });
            }

            // 解析周次字符串（SKZC 是 01 字符串，1 表示有课）
            if (skzc && typeof skzc === 'string') {
                for (let i = 0; i < skzc.length; i++) {
                    if (skzc[i] === '1') courseMap.get(key).weeks.add(i + 1);
                }
            } else if (Array.isArray(skzc)) {
                skzc.forEach(w => courseMap.get(key).weeks.add(parseInt(w)));
            }
        }

        // 生成 ICS 内容（用独立事件，兼容性最好）
        let lines = [];
        lines.push('BEGIN:VCALENDAR');
        lines.push('VERSION:2.0');
        lines.push('PRODID:-//SZU S2C Tool//CN');
        lines.push('CALSCALE:GREGORIAN');
        lines.push('METHOD:PUBLISH');
        lines.push('X-WR-CALNAME:深大课表 ' + xnxqdm);
        lines.push('X-WR-TIMEZONE:CST');

        const uidPrefix = 'szu' + Math.floor(Date.now() / 1000);
        let uidCount = 0;

        for (const course of courseMap.values()) {
            if (course.weeks.size === 0) continue;

            const startTime = PERIOD_TIMES[course.startPeriod]?.start || '08:00';
            const endTime = PERIOD_TIMES[course.endPeriod]?.end || '22:00';
            const sortedWeeks = [...course.weeks].sort((a, b) => a - b);
            const weeksText = formatWeeksText(sortedWeeks);

            // 每一周生成一个独立的 VEVENT（手机日历兼容性最好）
            for (const weekNum of sortedWeeks) {
                const eventDate = getDateOfWeek(termStart, weekNum, course.dayOfWeek);
                const dtStart = formatICSTime(eventDate, startTime);
                const dtEnd = formatICSTime(eventDate, endTime);
                const uid = uidPrefix + '_' + (uidCount++) + '_w' + weekNum;

                lines.push('BEGIN:VEVENT');
                lines.push('UID:' + uid);
                lines.push('SUMMARY:' + course.name);
                lines.push('DTSTART;TZID=CST:' + dtStart);
                lines.push('DTEND;TZID=CST:' + dtEnd);
                lines.push('LOCATION:' + course.location);
                lines.push('DESCRIPTION:教师: ' + course.teacher + '\\n周次: ' + weeksText + '\\n节次: 第' + course.startPeriod + '-' + course.endPeriod + '节');
                // 添加课前提醒
                lines.push('BEGIN:VALARM');
                lines.push('ACTION:DISPLAY');
                lines.push('DESCRIPTION:' + course.name + ' - ' + course.location);
                lines.push('TRIGGER:-PT30M');
                lines.push('END:VALARM');
                lines.push('END:VEVENT');
            }
        }

        lines.push('END:VCALENDAR');

        // 用 CRLF 连接（ICS 标准）
        return lines.join(CRLF) + CRLF;
    }

    // ========== 辅助函数 ==========

    // 获取当前周数（从页面读取）
    function getCurrentWeek() {
        // 尝试从页面上找周次信息
        const selectors = [
            '.current-week', '.week-current', '#currentWeek',
            '[class*="currentWeek"]', '[class*="current-week"]',
            '.dqxq', '.dqqsh'
        ];
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) {
                const match = el.textContent.match(/第\s*(\d+)\s*周/);
                if (match) return parseInt(match[1]);
            }
        }
        // 尝试从全局变量找
        try {
            if (window.APP_DATA?.currentWeek) return window.APP_DATA.currentWeek;
            if (window.pageData?.dqxq) return window.pageData.dqxq;
        } catch(e) {}
        return null;
    }

    // 获取开学日期
    function getTermStart(rows) {
        const now = new Date();
        const todayDayOfWeek = now.getDay() || 7; // 周日是0，转为7
        const thisMonday = new Date(now);
        thisMonday.setDate(now.getDate() - todayDayOfWeek + 1);
        thisMonday.setHours(0, 0, 0, 0);

        // 方法1：从页面获取当前周数
        const currentWeek = getCurrentWeek();
        if (currentWeek && currentWeek > 0) {
            const termStart = new Date(thisMonday);
            termStart.setDate(thisMonday.getDate() - (currentWeek - 1) * 7);
            return termStart;
        }

        // 方法2：从 SKZC 推算（找一个包含"1"的位置，结合当前日期反推）
        // 这个方法不太准，作为兜底
        for (const row of rows) {
            const skzc = row.SKZC || row.skzc || '';
            if (!skzc || typeof skzc !== 'string') continue;

            // 找到所有有课的周
            const weeksWithClass = [];
            for (let i = 0; i < skzc.length; i++) {
                if (skzc[i] === '1') weeksWithClass.push(i + 1);
            }

            if (weeksWithClass.length > 0) {
                // 假设当前周是中间某个有课的周，不太准
                // 还是让用户确认吧
                break;
            }
        }

        // 方法3：弹窗让用户输入开学日期
        const defaultDate = '2026-09-07';
        const userInput = prompt(
            '请输入本学期开学日期（第一周的周一）\n格式：YYYY-MM-DD\n例如：2026-09-07',
            defaultDate
        );

        if (userInput) {
            const d = new Date(userInput);
            if (!isNaN(d.getTime())) {
                // 确保是周一
                const day = d.getDay() || 7;
                if (day !== 1) {
                    d.setDate(d.getDate() - day + 1);
                }
                return d;
            }
        }

        // 最后兜底
        return new Date(2026, 8, 7);
    }

    function getDateOfWeek(termStart, weekNum, dayOfWeek) {
        const date = new Date(termStart);
        date.setDate(termStart.getDate() + (weekNum - 1) * 7 + (dayOfWeek - 1));
        return date;
    }

    function formatICSTime(date, timeStr) {
        const [h, m] = timeStr.split(':');
        const d = new Date(date);
        d.setHours(parseInt(h), parseInt(m), 0, 0);
        const y = d.getFullYear();
        const mo = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const hr = String(d.getHours()).padStart(2, '0');
        const mi = String(d.getMinutes()).padStart(2, '0');
        return `${y}${mo}${day}T${hr}${mi}00`;
    }

    function formatICSDate(date) {
        const y = date.getUTCFullYear();
        const mo = String(date.getUTCMonth() + 1).padStart(2, '0');
        const d = String(date.getUTCDate()).padStart(2, '0');
        const h = String(date.getUTCHours()).padStart(2, '0');
        const mi = String(date.getUTCMinutes()).padStart(2, '0');
        const s = String(date.getUTCSeconds()).padStart(2, '0');
        return `${y}${mo}${d}T${h}${mi}${s}Z`;
    }

    function getICSWeekday(dayNum) {
        const map = { 1: 'MO', 2: 'TU', 3: 'WE', 4: 'TH', 5: 'FR', 6: 'SA', 7: 'SU' };
        return map[dayNum] || 'MO';
    }

    function formatWeeksText(weeks) {
        if (!weeks || weeks.length === 0) return '';
        const sorted = [...weeks].sort((a, b) => a - b);
        const ranges = [];
        let start = sorted[0];
        let end = sorted[0];

        for (let i = 1; i < sorted.length; i++) {
            if (sorted[i] === end + 1) {
                end = sorted[i];
            } else {
                ranges.push(start === end ? `${start}周` : `${start}-${end}周`);
                start = sorted[i];
                end = sorted[i];
            }
        }
        ranges.push(start === end ? `${start}周` : `${start}-${end}周`);
        return ranges.join('、');
    }

    function escapeICS(str) {
        if (!str) return '';
        return String(str).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
    }

    // ========== 下载文件 ==========
    function downloadFile(content, filename) {
        const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // ========== 导出处理 ==========
    function handleExport() {
        const btn = document.getElementById('szu-ics-export-btn');
        if (!btn) return;

        btn.innerHTML = '⏳ 正在获取...';
        btn.style.pointerEvents = 'none';

        getScheduleData()
            .then(rows => {
                btn.innerHTML = '📝 生成中...';
                const icsContent = generateICS(rows);

                if (!icsContent || icsContent.indexOf('BEGIN:VEVENT') === -1) {
                    throw new Error('未解析到课程');
                }

                const termName = rows[0]?.XNXQDM || rows[0]?.XNXQ || '本学期';
                const filename = `深大课表_${termName}.ics`;
                downloadFile(icsContent, filename);

                showTip('导出成功！');
            })
            .catch(err => {
                showTip(err.message || '导出失败', true);
            })
            .finally(() => {
                btn.style.pointerEvents = '';
            });
    }

    // ========== 初始化 ==========
    function init() {
        // 等待页面加载完成后再创建按钮
        if (document.body) {
            createButton();
        } else {
            setTimeout(init, 500);
        }
    }

    // 延迟一下确保页面框架加载
    setTimeout(init, 1500);

})();
