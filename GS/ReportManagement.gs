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

    // 1) 在職員工清單（getAllUsers 失敗時要讓錯誤往上傳，不能悄悄變成「0 位員工」）
    const usersResult = getAllUsers();
    if (!usersResult.ok) {
      return { ok: false, msg: '無法取得員工清單: ' + (usersResult.msg || '未知錯誤') };
    }
    const employees = usersResult.users || [];

    // 2) 班別中繼資料（判斷哪些班別屬於「假別／排休」，以及所屬分類供上色）
    //    這個對照表直接影響「排休 vs 上班」的分類是否正確，載入失敗就不產生報表，
    //    避免所有假別班別被悄悄誤判為上班。
    const shiftTypesResult = getShiftTypes();
    if (!shiftTypesResult.ok) {
      return { ok: false, msg: '無法取得班別設定: ' + (shiftTypesResult.msg || '未知錯誤') };
    }
    const shiftTypeGroup = {};
    const shiftTypeIsLeave = {};
    const shiftTypeMeta = [];
    (shiftTypesResult.groups || []).forEach(g => {
      g.items.forEach(item => {
        shiftTypeGroup[item.name] = g.group;
        shiftTypeIsLeave[item.name] = !!item.isLeave;
        shiftTypeMeta.push({ name: item.name, group: g.group, isLeave: !!item.isLeave });
      });
    });

    // 3) 當月排班資料（所有員工）
    const shiftsResult = getShifts({ startDate: startDate, endDate: endDate });
    const shifts = (shiftsResult.success && shiftsResult.data) ? shiftsResult.data : [];

    // 4) 當月已核准的正式請假（逐日展開，內部函式，來自 LeaveManagement.gs）
    const leaveRecords = getApprovedLeaveRecords(yearMonth) || [];

    // 5) 當月已核准的加班（來自 加班申請 工作表）
    const overtimeRecords = getApprovedOvertimeRecordsForMonth_(yearMonth);

    // 6) 建立「員工 x 日」矩陣
    //    每一天用陣列存放「所有」排班/請假/加班紀錄，而不是只保留最後一筆，
    //    避免同一天有多筆紀錄時（例如當天分別請了 4 小時特休 + 4 小時事假、
    //    或排班誤植了兩筆不同班別）互相覆蓋、統計數字對不上畫面。
    const employeeMap = {};
    employees.forEach(emp => {
      employeeMap[emp.userId] = {
        employeeId: emp.userId,
        employeeName: emp.name,
        dept: emp.dept || '',
        days: {}
      };
    });

    function ensureDay(empId, dayNum) {
      const emp = employeeMap[empId];
      if (!emp) return null;
      if (!emp.days[dayNum]) {
        emp.days[dayNum] = { shifts: [], leaves: [], overtimes: [] };
      }
      return emp.days[dayNum];
    }

    shifts.forEach(s => {
      if (!employeeMap[s.employeeId] || !s.date) return;
      const dayNum = parseInt(s.date.split('-')[2], 10);
      const day = ensureDay(s.employeeId, dayNum);
      if (!day) return;

      day.shifts.push({
        shiftType: s.shiftType,
        shiftGroup: shiftTypeGroup[s.shiftType] || null,
        isDayOff: !!shiftTypeIsLeave[s.shiftType],
        startTime: s.startTime,
        endTime: s.endTime,
        location: s.location,
        note: s.note || ''
      });
    });

    leaveRecords.forEach(rec => {
      if (!employeeMap[rec.employeeId] || !rec.date) return;
      const dayNum = parseInt(rec.date.split('-')[2], 10);
      const day = ensureDay(rec.employeeId, dayNum);
      if (!day) return;

      day.leaves.push({
        leaveType: rec.leaveType,
        hours: parseFloat(rec.workHours) || 0,
        status: rec.status,
        reason: rec.reason || ''
      });
    });

    overtimeRecords.forEach(rec => {
      if (!employeeMap[rec.employeeId] || !rec.date) return;
      const dayNum = parseInt(rec.date.split('-')[2], 10);
      const day = ensureDay(rec.employeeId, dayNum);
      if (!day) return;

      day.overtimes.push({
        hours: rec.hours,
        reason: rec.reason,
        compensationType: rec.compensationType
      });
    });

    // 7) 統計數字一律從最終的 days 內容重新彙總（單一計算來源），
    //    確保畫面上看到的每一格內容跟月統計數字永遠一致。
    const employeesArr = Object.values(employeeMap).map(emp => {
      const summary = { shiftDays: 0, dayOffDays: 0, leaveDays: 0, leaveHours: 0, overtimeHours: 0 };

      Object.values(emp.days).forEach(day => {
        const hasWorkShift = day.shifts.some(sh => !sh.isDayOff);
        const hasDayOffShift = day.shifts.some(sh => sh.isDayOff);
        if (hasWorkShift) summary.shiftDays++;
        if (hasDayOffShift) summary.dayOffDays++;

        if (day.leaves.length > 0) {
          summary.leaveDays++;
          day.leaves.forEach(lv => { summary.leaveHours += lv.hours; });
        }

        day.overtimes.forEach(ot => { summary.overtimeHours += ot.hours; });
      });

      emp.summary = summary;
      return emp;
    }).sort((a, b) => String(a.employeeName).localeCompare(String(b.employeeName), 'zh-TW'));

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

    const dateStr = formatDateForReport_(row[3]);
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
 * 專用日期格式化（yyyy-MM-dd, Asia/Taipei）。
 * 刻意不叫 formatDate：這個專案裡 Constants.gs / OvertimeOperations.gs /
 * LeaveManagement.gs / DbOperations.gs 各自宣告了一份同名的全域 formatDate，
 * Apps Script 會用「最後載入的那份」覆蓋其他定義，行為不可預期。
 * 這裡用獨立名稱，確保這個檔案的日期判斷不受檔案載入順序影響。
 */
function formatDateForReport_(date) {
  if (!date) return '';
  if (typeof date === 'string') return date;
  return Utilities.formatDate(date, 'Asia/Taipei', 'yyyy-MM-dd');
}

/**
 * doGet 對應的 handler
 */
function handleGetMonthlyOverviewReport(params) {
  return getMonthlyOverviewReport(params.token, params.yearMonth);
}
