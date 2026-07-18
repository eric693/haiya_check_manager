/**
 * report.js - 管理者整合報表（排班／請假／加班）
 * 由 GS/ReportManagement.gs 的 getMonthlyOverviewReport 提供資料，
 * 在前端組成「員工 x 每月1~31日」矩陣，點擊格子可看當日明細。
 */

// ========== 全域狀態 ==========
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth(); // 0-11
let reportData = null; // 最近一次 API 回傳的完整資料

const LEAVE_TYPE_LABELS = {
    ANNUAL_LEAVE: { full: '特休假', short: '特休' },
    COMP_TIME_OFF: { full: '加班補休假', short: '補休' },
    PERSONAL_LEAVE: { full: '事假', short: '事假' },
    SICK_LEAVE: { full: '未住院病假', short: '病假' },
    HOSPITALIZATION_LEAVE: { full: '住院病假', short: '住院' },
    BEREAVEMENT_LEAVE: { full: '喪假', short: '喪假' },
    MARRIAGE_LEAVE: { full: '婚假', short: '婚假' },
    PATERNITY_LEAVE: { full: '陪產檢及陪產假', short: '陪產' },
    MATERNITY_LEAVE: { full: '產假', short: '產假' },
    OFFICIAL_LEAVE: { full: '公假（含兵役假）', short: '公假' },
    WORK_INJURY_LEAVE: { full: '公傷假', short: '公傷' },
    ABSENCE_WITHOUT_LEAVE: { full: '曠工', short: '曠工' },
    NATURAL_DISASTER_LEAVE: { full: '天然災害停班', short: '天災' },
    FAMILY_CARE_LEAVE: { full: '家庭照顧假', short: '照顧' },
    MENSTRUAL_LEAVE: { full: '生理假', short: '生理' }
};

// ========== 初始化 / 權限檢查 ==========
document.addEventListener('DOMContentLoaded', async () => {
    const token = localStorage.getItem('sessionToken');
    if (!token) {
        showPermissionDenied();
        return;
    }

    try {
        const res = await fetch(`${apiUrl}?action=checkSession&token=${token}`);
        const data = await res.json();

        if (!data.ok || !data.user || data.user.dept !== '管理員') {
            showPermissionDenied();
            return;
        }

        document.getElementById('report-body').style.display = 'block';
        updateMonthLabel();
        await loadReport();
    } catch (err) {
        console.error('權限檢查失敗:', err);
        showPermissionDenied();
    }
});

function showPermissionDenied() {
    document.getElementById('permission-denied').style.display = 'block';
    document.getElementById('report-body').style.display = 'none';
}

// ========== 月份切換 ==========
function updateMonthLabel() {
    document.getElementById('current-month-label').textContent =
        `${currentYear}年${String(currentMonth + 1).padStart(2, '0')}月`;
}

function changeMonth(delta) {
    currentMonth += delta;
    if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    updateMonthLabel();
    loadReport();
}

function goToCurrentMonth() {
    const now = new Date();
    currentYear = now.getFullYear();
    currentMonth = now.getMonth();
    updateMonthLabel();
    loadReport();
}

// ========== 資料載入 ==========
async function loadReport() {
    const wrapper = document.getElementById('matrix-wrapper');
    wrapper.innerHTML = '<div class="loading">載入報表資料中...</div>';

    const yearMonth = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;

    try {
        const token = localStorage.getItem('sessionToken');
        const params = new URLSearchParams({
            action: 'getMonthlyOverviewReport',
            token: token,
            yearMonth: yearMonth
        });
        const res = await fetch(`${apiUrl}?${params}`);
        const data = await res.json();

        if (!data.ok) {
            wrapper.innerHTML = `<div class="empty-state"><div class="empty-state-icon">載入失敗</div><p>${escapeHtml(data.msg || data.code || '未知錯誤')}</p></div>`;
            return;
        }

        reportData = data;
        populateDeptFilter();
        renderStats();
        renderMatrix();

    } catch (err) {
        console.error('載入整合報表失敗:', err);
        wrapper.innerHTML = '<div class="empty-state"><div class="empty-state-icon">發生錯誤</div><p>載入報表時發生錯誤，請稍後再試。</p></div>';
    }
}

// ========== 統計卡片 ==========
function renderStats() {
    if (!reportData) return;
    const employees = reportData.employees || [];

    let dayoffTotal = 0, leaveDaysTotal = 0, leaveHoursTotal = 0, overtimeHoursTotal = 0;
    employees.forEach(emp => {
        const s = emp.summary || {};
        dayoffTotal += s.dayOffDays || 0;
        leaveDaysTotal += s.leaveDays || 0;
        leaveHoursTotal += s.leaveHours || 0;
        overtimeHoursTotal += s.overtimeHours || 0;
    });

    document.getElementById('stat-employee-count').textContent = employees.length;
    document.getElementById('stat-dayoff-count').textContent = dayoffTotal;
    document.getElementById('stat-leave-count').textContent = leaveDaysTotal;
    document.getElementById('stat-leave-hours-sub').textContent = `${roundNum(leaveHoursTotal)} 小時`;
    document.getElementById('stat-overtime-hours').textContent = roundNum(overtimeHoursTotal);
}

// ========== 部門篩選 ==========
function populateDeptFilter() {
    const select = document.getElementById('filter-dept');
    const current = select.value;
    const depts = Array.from(new Set((reportData.employees || []).map(e => e.dept).filter(Boolean))).sort();

    select.innerHTML = '<option value="">全部部門</option>';
    depts.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d;
        opt.textContent = d;
        select.appendChild(opt);
    });

    if (depts.includes(current)) select.value = current;
}

// ========== 矩陣渲染 ==========
function getFilteredEmployees() {
    if (!reportData) return [];
    const keyword = document.getElementById('search-employee').value.trim().toLowerCase();
    const dept = document.getElementById('filter-dept').value;

    return (reportData.employees || []).filter(emp => {
        if (dept && emp.dept !== dept) return false;
        if (keyword && !String(emp.employeeName).toLowerCase().includes(keyword)) return false;
        return true;
    });
}

// 每欄（每一天）的週末/今日狀態只跟欄位有關，跟員工列無關，
// 整張表只算一次，不要在每個員工的每一格重算。
function buildColumnMeta(daysInMonth) {
    const now = new Date();
    const isCurrentMonth = now.getFullYear() === currentYear && now.getMonth() === currentMonth;
    const todayDate = now.getDate();
    const meta = [];
    for (let d = 1; d <= daysInMonth; d++) {
        const wd = new Date(currentYear, currentMonth, d).getDay();
        meta.push({
            day: d,
            weekday: wd,
            isWeekend: (wd === 0 || wd === 6),
            isToday: isCurrentMonth && d === todayDate
        });
    }
    return meta;
}

function renderMatrix() {
    const wrapper = document.getElementById('matrix-wrapper');
    if (!reportData) return;

    const daysInMonth = reportData.daysInMonth;
    const employees = getFilteredEmployees();

    if (employees.length === 0) {
        wrapper.innerHTML = '<div class="empty-state"><div class="empty-state-icon">查無資料</div><p>沒有符合篩選條件的員工</p></div>';
        return;
    }

    const weekdayNames = ['日', '一', '二', '三', '四', '五', '六'];
    const columns = buildColumnMeta(daysInMonth);

    let dayRow = '<tr><th class="col-name">員工 / 部門</th>';
    let wdRow = '<tr class="weekday-row"><th class="col-name"></th>';

    columns.forEach(col => {
        const classes = [col.isWeekend ? 'weekend' : '', col.isToday ? 'today-col' : ''].filter(Boolean).join(' ');
        dayRow += `<th class="${classes}">${col.day}</th>`;
        wdRow += `<th class="${classes}">${weekdayNames[col.weekday]}</th>`;
    });
    dayRow += '</tr>';
    wdRow += '</tr>';

    let bodyRows = '';
    employees.forEach(emp => {
        bodyRows += buildEmployeeRow(emp, columns);
    });

    wrapper.innerHTML = `
        <table class="matrix">
            <thead>${dayRow}${wdRow}</thead>
            <tbody>${bodyRows}</tbody>
        </table>
    `;
}

function buildEmployeeRow(emp, columns) {
    let html = `<tr>
        <td class="col-name">
            <div class="emp-name">${escapeHtml(emp.employeeName)}</div>
            <div class="emp-dept">${escapeHtml(emp.dept || '')}</div>
        </td>`;

    columns.forEach(col => {
        const classes = ['day-col', col.isWeekend ? 'weekend' : '', col.isToday ? 'today-col' : ''].filter(Boolean).join(' ');
        const day = emp.days ? emp.days[col.day] : null;

        html += `<td class="${classes}" onclick="openDetailModal('${emp.employeeId}', ${col.day})">
            <div class="day-cell-inner">${buildDayCellHTML(day)}</div>
        </td>`;
    });

    html += '</tr>';
    return html;
}

function shortenShiftLabel(name) {
    if (!name) return '';
    let s = String(name).replace(/^廚房/, '').replace(/^外場/, '').replace(/班$/, '');
    if (s.length > 4) s = s.substring(0, 4);
    return s || name;
}

function leaveLabel(leaveType) {
    return LEAVE_TYPE_LABELS[leaveType] || { full: leaveType, short: String(leaveType).substring(0, 2) };
}

// 一天可能有多筆排班／請假／加班紀錄（例如同一天分別請了兩種不同假別），
// 全部列出，不能只取最後一筆蓋掉前面的。
function buildDayCellHTML(day) {
    if (!day) return '<span class="empty-day">-</span>';

    let html = '';

    (day.shifts || []).forEach(sh => {
        if (sh.isDayOff) {
            html += `<span class="shift-pill dayoff-pill" title="${escapeHtml(sh.shiftType)}">${escapeHtml(shortenShiftLabel(sh.shiftType))}</span>`;
        } else {
            let cls = 'badge-custom';
            const group = sh.shiftGroup || '';
            if (group.includes('廚房')) cls = 'badge-kitchen';
            else if (group.includes('外場')) cls = 'badge-floor';
            const timeStr = (sh.startTime && sh.endTime) ? `${sh.startTime}-${sh.endTime}` : '';
            html += `<span class="shift-pill ${cls}" title="${escapeHtml(sh.shiftType)} ${timeStr}">${escapeHtml(shortenShiftLabel(sh.shiftType))}</span>`;
        }
    });

    (day.leaves || []).forEach(lv => {
        const label = leaveLabel(lv.leaveType);
        html += `<span class="leave-pill" title="請假：${escapeHtml(label.full)} ${roundNum(lv.hours)}小時">${escapeHtml(label.short)}</span>`;
    });

    (day.overtimes || []).forEach(ot => {
        html += `<span class="overtime-pill">OT ${roundNum(ot.hours)}h</span>`;
    });

    return html || '<span class="empty-day">-</span>';
}

// ========== 明細彈窗 ==========
function openDetailModal(employeeId, dayNum) {
    if (!reportData) return;
    const emp = (reportData.employees || []).find(e => e.employeeId === employeeId);
    if (!emp) return;

    const day = emp.days ? emp.days[Number(dayNum)] : null;
    const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    const wd = ['日', '一', '二', '三', '四', '五', '六'][new Date(currentYear, currentMonth, dayNum).getDay()];

    let sectionsHtml = '';

    (day && day.shifts ? day.shifts : []).forEach(sh => {
        sectionsHtml += `
            <div class="modal-section">
                <h4>排班</h4>
                <div class="modal-row"><span>班別</span><span>${escapeHtml(sh.shiftType)}</span></div>
                ${(!sh.isDayOff && sh.startTime) ? `<div class="modal-row"><span>時間</span><span>${escapeHtml(sh.startTime)} - ${escapeHtml(sh.endTime || '')}</span></div>` : ''}
                ${sh.location ? `<div class="modal-row"><span>地點</span><span>${escapeHtml(sh.location)}</span></div>` : ''}
                ${sh.note ? `<div class="modal-row"><span>備註</span><span>${escapeHtml(sh.note)}</span></div>` : ''}
            </div>`;
    });

    (day && day.leaves ? day.leaves : []).forEach(lv => {
        const label = leaveLabel(lv.leaveType);
        sectionsHtml += `
            <div class="modal-section">
                <h4>請假</h4>
                <div class="modal-row"><span>假別</span><span>${escapeHtml(label.full)}</span></div>
                <div class="modal-row"><span>時數</span><span>${roundNum(lv.hours)} 小時</span></div>
                ${lv.reason ? `<div class="modal-row"><span>原因</span><span>${escapeHtml(lv.reason)}</span></div>` : ''}
            </div>`;
    });

    (day && day.overtimes ? day.overtimes : []).forEach(ot => {
        const compLabel = ot.compensationType === 'comp_leave' ? '補休' : '薪資加給';
        sectionsHtml += `
            <div class="modal-section">
                <h4>加班</h4>
                <div class="modal-row"><span>時數</span><span>${roundNum(ot.hours)} 小時</span></div>
                <div class="modal-row"><span>補償方式</span><span>${compLabel}</span></div>
                ${ot.reason ? `<div class="modal-row"><span>原因</span><span>${escapeHtml(ot.reason)}</span></div>` : ''}
            </div>`;
    });

    if (!sectionsHtml) {
        sectionsHtml = '<div class="modal-empty">當日無排班、請假或加班紀錄</div>';
    }

    const box = document.getElementById('detail-modal-box');
    box.innerHTML = `
        <h3>${escapeHtml(emp.employeeName)}</h3>
        <div class="modal-sub">${dateStr} (${wd})　${escapeHtml(emp.dept || '')}</div>
        ${sectionsHtml}
        <button class="btn btn-secondary modal-close-btn" onclick="closeDetailModal()">關閉</button>
    `;

    document.getElementById('detail-modal').classList.add('show');
}

function closeDetailModal() {
    document.getElementById('detail-modal').classList.remove('show');
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDetailModal();
});

// ========== 匯出 CSV ==========
function buildDayCellText(day) {
    if (!day) return '';
    const parts = [];

    (day.shifts || []).forEach(sh => {
        const timeStr = (!sh.isDayOff && sh.startTime) ? ` ${sh.startTime}-${sh.endTime}` : '';
        parts.push(`${sh.shiftType}${timeStr}`);
    });

    (day.leaves || []).forEach(lv => {
        const label = leaveLabel(lv.leaveType);
        parts.push(`請假:${label.full}(${roundNum(lv.hours)}h)`);
    });

    (day.overtimes || []).forEach(ot => {
        parts.push(`加班:${roundNum(ot.hours)}h`);
    });

    return parts.join(' / ');
}

function exportMatrixCSV() {
    if (!reportData) return;
    const employees = getFilteredEmployees();
    if (employees.length === 0) {
        alert('目前沒有可匯出的資料');
        return;
    }

    const daysInMonth = reportData.daysInMonth;
    const headers = ['員工姓名', '部門'];
    for (let d = 1; d <= daysInMonth; d++) headers.push(`${d}日`);
    headers.push('排休天數', '請假天數', '請假時數', '加班時數');

    const rows = employees.map(emp => {
        const row = [emp.employeeName, emp.dept || ''];
        for (let d = 1; d <= daysInMonth; d++) {
            row.push(buildDayCellText(emp.days ? emp.days[d] : null));
        }
        const s = emp.summary || {};
        row.push(s.dayOffDays || 0, s.leaveDays || 0, roundNum(s.leaveHours || 0), roundNum(s.overtimeHours || 0));
        return row;
    });

    const csvContent = [headers, ...rows]
        .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        .join('\n');

    const blob = new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `整合報表_${currentYear}-${String(currentMonth + 1).padStart(2, '0')}.csv`;
    link.click();
}

// ========== 工具函式 ==========
function roundNum(n) {
    const num = parseFloat(n) || 0;
    return Math.round(num * 100) / 100;
}

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
