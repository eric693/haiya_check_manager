// ReportManagement.gs - 管理者整合報表（排班／請假／加班）
// 將「排班」「請假」「加班」三個系統的月資料合併成單一矩陣，
// 提供 report.html 產生「每月 1 日 ~ 月底、每位員工一列」的總覽報表。

/**
 * 取得指定月份的整合總覽報表（僅限管理員）
 * @param {string} sessionToken
 * @param {string} yearMonth  格式 yyyy-MM，例如 "2026-07"
 * @return {{ok:boolean, yearMonth:string, daysInMonth:number, employees:Array, shiftTypeMeta:Array}}
 */
function getMonthlyOverviewReport(sessionToken, yearMonth) {
  try {
    const session = checkSession_(sessionToken);
    if (!session.ok || !session.user) {
      return { ok: false, code: 'ERR_SESSION_INVALID' };
    }
    if (session.user.dept !== '管理員') {
      return { ok: false, code: 'ERR_PERMISSION_DENIED', msg: '需要管理員權限' };
    }
    if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) {
      return { ok: false, msg: '年月格式錯誤，需為 yyyy-MM' };
    }

    const month = parseInt(yearMonth.split('-')[1], 10);
    const year = parseInt(yearMonth.split('-')[0], 10);
    const daysInMonth = new Date(year, month, 0).getDate();
    const startDate = `${yearMonth}-01`;
    const endDate = `${yearMonth}-${String(daysInMonth).padStart(2, '0')}`;

    // 1) 在職員工清單
    const usersResult = getAllUsers();
    const employees = (usersResult.users || []).filter(u => u.status === '啟用' || !u.status);

    // 2) 班別中繼資料（判斷哪些班別屬於「假別／排休」，以及所屬分類供上色）
    const shiftTypesResult = getShiftTypes();
    const shiftTypeGroup = {};
    const shiftTypeIsLeave = {};
    const shiftTypeMeta = [];
    if (shiftTypesResult.ok && shiftTypesResult.groups) {
      shiftTypesResult.groups.forEach(g => {
        g.items.forEach(item => {
          shiftTypeGroup[item.name] = g.group;
          shiftTypeIsLeave[item.name] = !!item.isLeave;
          shiftTypeMeta.push({ name: item.name, group: g.group, isLeave: !!item.isLeave });
        });
      });
    }

    // 3) 當月排班資料（所有員工）
    const shiftsResult = getShifts({ startDate: startDate, endDate: endDate });
    const shifts = (shiftsResult.success && shiftsResult.data) ? shiftsResult.data : [];

    // 4) 當月已核准的正式請假（逐日展開，內部函式，來自 LeaveManagement.gs）
    const leaveRecords = getApprovedLeaveRecords(yearMonth) || [];

    // 5) 當月已核准的加班（來自 加班申請 工作表）
    const overtimeRecords = getApprovedOvertimeRecordsForMonth_(yearMonth);

    // 6) 建立「員工 x 日」矩陣
    const employeeMap = {};
    employees.forEach(emp => {
      employeeMap[emp.userId] = {
        employeeId: emp.userId,
        employeeName: emp.name,
        dept: emp.dept || '',
        days: {},
        summary: {
          shiftDays: 0,
          dayOffDays: 0,
          leaveDays: 0,
          leaveHours: 0,
          overtimeHours: 0
        }
      };
    });

    function ensureDay(empId, dayNum) {
      const emp = employeeMap[empId];
      if (!emp) return null;
      if (!emp.days[dayNum]) {
        emp.days[dayNum] = {
          shiftType: null, shiftGroup: null, isDayOff: false,
          startTime: null, endTime: null, location: null, shiftNote: null,
          leaveType: null, leaveHours: 0, leaveStatus: null, leaveReason: null,
          overtimeHours: 0, overtimeReason: null, overtimeCompType: null
        };
      }
      return emp.days[dayNum];
    }

    shifts.forEach(s => {
      if (!employeeMap[s.employeeId] || !s.date) return;
      const dayNum = parseInt(s.date.split('-')[2], 10);
      const cell = ensureDay(s.employeeId, dayNum);
      if (!cell) return;

      cell.shiftType = s.shiftType;
      cell.shiftGroup = shiftTypeGroup[s.shiftType] || null;
      cell.isDayOff = !!shiftTypeIsLeave[s.shiftType];
      cell.startTime = s.startTime;
      cell.endTime = s.endTime;
      cell.location = s.location;
      cell.shiftNote = s.note || '';

      const summary = employeeMap[s.employeeId].summary;
      if (cell.isDayOff) summary.dayOffDays++;
      else summary.shiftDays++;
    });

    leaveRecords.forEach(rec => {
      if (!employeeMap[rec.employeeId] || !rec.date) return;
      const dayNum = parseInt(rec.date.split('-')[2], 10);
      const cell = ensureDay(rec.employeeId, dayNum);
      if (!cell) return;

      cell.leaveType = rec.leaveType;
      cell.leaveHours = (cell.leaveHours || 0) + (parseFloat(rec.workHours) || 0);
      cell.leaveStatus = rec.status;
      cell.leaveReason = rec.reason || '';

      const summary = employeeMap[rec.employeeId].summary;
      summary.leaveDays += 1;
      summary.leaveHours += (parseFloat(rec.workHours) || 0);
    });

    overtimeRecords.forEach(rec => {
      if (!employeeMap[rec.employeeId] || !rec.date) return;
      const dayNum = parseInt(rec.date.split('-')[2], 10);
      const cell = ensureDay(rec.employeeId, dayNum);
      if (!cell) return;

      cell.overtimeHours = (cell.overtimeHours || 0) + rec.hours;
      cell.overtimeReason = rec.reason;
      cell.overtimeCompType = rec.compensationType;

      employeeMap[rec.employeeId].summary.overtimeHours += rec.hours;
    });

    const employeesArr = Object.values(employeeMap).sort((a, b) =>
      String(a.employeeName).localeCompare(String(b.employeeName), 'zh-TW')
    );

    return {
      ok: true,
      yearMonth: yearMonth,
      daysInMonth: daysInMonth,
      employees: employeesArr,
      shiftTypeMeta: shiftTypeMeta
    };

  } catch (error) {
    Logger.log('getMonthlyOverviewReport 錯誤: ' + error.message + '\n' + error.stack);
    return { ok: false, msg: '報表產生失敗: ' + error.message };
  }
}

/**
 * 取得指定月份、已核准的加班紀錄（所有員工）
 * 讀取「加班申請」工作表 (SHEET_OVERTIME，定義於 OvertimeOperations.gs)
 */
function getApprovedOvertimeRecordsForMonth_(yearMonth) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_OVERTIME);
  if (!sheet) return [];

  const values = sheet.getDataRange().getValues();
  const records = [];

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const status = String(row[9] || '').trim().toLowerCase();
    if (status !== 'approved') continue;

    const dateStr = formatDate(row[3]);
    if (!dateStr || !dateStr.startsWith(yearMonth)) continue;

    records.push({
      employeeId: row[1],
      employeeName: row[2],
      date: dateStr,
      hours: parseFloat(row[6]) || 0,
      reason: row[7] || '',
      compensationType: row[15] || 'pay'
    });
  }

  return records;
}

/**
 * doGet 對應的 handler
 */
function handleGetMonthlyOverviewReport(params) {
  return getMonthlyOverviewReport(params.token, params.yearMonth);
}
