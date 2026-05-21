// WifiPunchSettings.gs - WiFi打卡設定管理

const SHEET_WIFI_LOCATIONS = 'WIFI打卡設定';
const PUNCH_MODE_KEY = 'PUNCH_MODE';

// Sheet 欄位索引（0-based，從第 2 列資料開始）
const WIFI_COL = {
  NAME:       0,  // A: 地點名稱
  SSID:       1,  // B: WiFi SSID
  NOTE:       2,  // C: 備註
  ALLOWED_IP: 3   // D: 允許的對外 IP（可空，空則不驗證）
};

// ==================== 打卡模式設定 ====================

/**
 * 取得打卡模式
 * @returns {string} 'gps' | 'wifi' | 'both'
 */
function getPunchMode() {
  return PropertiesService.getScriptProperties().getProperty(PUNCH_MODE_KEY) || 'gps';
}

/**
 * 設定打卡模式（管理員）
 */
function setPunchMode(token, mode) {
  try {
    const session = checkSession_(token);
    if (!session.ok || !session.user) return { ok: false, msg: '未授權或 session 已過期' };
    if (session.user.dept !== '管理員') return { ok: false, msg: '需要管理員權限' };
    if (!['gps', 'wifi', 'both'].includes(mode)) return { ok: false, msg: '無效的打卡模式' };

    PropertiesService.getScriptProperties().setProperty(PUNCH_MODE_KEY, mode);
    Logger.log('✅ 打卡模式已設定為: ' + mode);
    return { ok: true, mode: mode, msg: '打卡模式已更新' };
  } catch (error) {
    Logger.log('❌ setPunchMode 錯誤: ' + error);
    return { ok: false, msg: error.message };
  }
}

/**
 * 取得所有打卡設定（前端用）
 */
function getPunchSettings() {
  try {
    const mode = getPunchMode();
    const wifiResult = getWifiLocations_();
    return {
      ok: true,
      mode: mode,
      wifiLocations: wifiResult.ok ? wifiResult.locations : []
    };
  } catch (error) {
    Logger.log('❌ getPunchSettings 錯誤: ' + error);
    return { ok: false, msg: error.message };
  }
}

// ==================== WiFi 地點管理 ====================

/**
 * 取得所有 WiFi 打卡地點（內部用）
 */
function getWifiLocations_() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_WIFI_LOCATIONS);
    if (!sheet) sheet = createWifiLocationSheet_(ss);

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { ok: true, locations: [] };

    const values = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
    const locations = values
      .map((row, i) => ({
        rowIndex: i + 2,
        name:      String(row[WIFI_COL.NAME]       || '').trim(),
        ssid:      String(row[WIFI_COL.SSID]       || '').trim(),
        note:      String(row[WIFI_COL.NOTE]       || '').trim(),
        allowedIp: String(row[WIFI_COL.ALLOWED_IP] || '').trim()
      }))
      .filter(loc => loc.name && loc.ssid);

    return { ok: true, locations };
  } catch (error) {
    Logger.log('❌ getWifiLocations_ 錯誤: ' + error);
    return { ok: false, msg: error.message };
  }
}

/**
 * 取得所有 WiFi 打卡地點（API handler 用）
 */
function getWifiLocations(token) {
  try {
    if (!token || !validateSession(token)) {
      return { ok: false, msg: '未授權或 session 已過期' };
    }
    return getWifiLocations_();
  } catch (error) {
    Logger.log('❌ getWifiLocations 錯誤: ' + error);
    return { ok: false, msg: error.message };
  }
}

/**
 * 新增 WiFi 打卡地點（管理員）
 * @param {string} token
 * @param {string} name       - 地點顯示名稱
 * @param {string} ssid       - WiFi SSID
 * @param {string} note       - 備註（可選）
 * @param {string} allowedIp  - 允許的公司對外 IP（可選，空則不驗證）
 */
function addWifiLocation(token, name, ssid, note, allowedIp) {
  try {
    const session = checkSession_(token);
    if (!session.ok || !session.user) return { ok: false, msg: '未授權或 session 已過期' };
    if (session.user.dept !== '管理員') return { ok: false, msg: '需要管理員權限' };
    if (!name || !ssid) return { ok: false, msg: '名稱和 SSID 為必填' };

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_WIFI_LOCATIONS);
    if (!sheet) sheet = createWifiLocationSheet_(ss);

    const ip = (allowedIp || '').trim();
    sheet.appendRow([name.trim(), ssid.trim(), (note || '').trim(), ip]);
    Logger.log('✅ 新增 WiFi 地點: ' + name + ' (SSID: ' + ssid + ', IP: ' + (ip || '不驗證') + ')');
    return { ok: true, msg: '已新增 WiFi 打卡地點' };
  } catch (error) {
    Logger.log('❌ addWifiLocation 錯誤: ' + error);
    return { ok: false, msg: error.message };
  }
}

/**
 * 刪除 WiFi 打卡地點（管理員）
 */
function deleteWifiLocation(token, rowIndex) {
  try {
    const session = checkSession_(token);
    if (!session.ok || !session.user) return { ok: false, msg: '未授權或 session 已過期' };
    if (session.user.dept !== '管理員') return { ok: false, msg: '需要管理員權限' };

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_WIFI_LOCATIONS);
    if (!sheet) return { ok: false, msg: '找不到 WiFi 設定工作表' };

    const row = parseInt(rowIndex);
    if (isNaN(row) || row < 2) return { ok: false, msg: '無效的列索引' };

    sheet.deleteRow(row);
    Logger.log('✅ 已刪除 WiFi 地點 (列 ' + row + ')');
    return { ok: true, msg: '已刪除 WiFi 打卡地點' };
  } catch (error) {
    Logger.log('❌ deleteWifiLocation 錯誤: ' + error);
    return { ok: false, msg: error.message };
  }
}

// ==================== IP 驗證 ====================

/**
 * 驗證用戶端 IP 是否符合地點設定
 * @param {string} matchedIp  - 設定的允許 IP（可為空）
 * @param {string} clientIp   - 前端回報的公開 IP
 * @returns {{ ok: boolean, reason?: string }}
 */
function verifyClientIp_(matchedIp, clientIp) {
  // 地點沒設定 IP → 不驗證，直接通過
  if (!matchedIp) {
    Logger.log('   IP 驗證：未設定，略過');
    return { ok: true };
  }

  // 地點有設定 IP，但前端沒送過來
  if (!clientIp) {
    Logger.log('   IP 驗證：設定了 ' + matchedIp + '，但前端未提供 IP');
    return { ok: false, reason: '無法取得您的網路 IP，請確認網路連線後重試' };
  }

  const clientTrimmed  = clientIp.trim();
  // 支援多個 IP 以逗號分隔（e.g., "203.0.113.1,203.0.113.2"）
  const allowedList = matchedIp.split(',').map(s => s.trim()).filter(Boolean);

  if (allowedList.includes(clientTrimmed)) {
    Logger.log('   IP 驗證通過: ' + clientTrimmed);
    return { ok: true };
  }

  Logger.log('   IP 驗證失敗: 設定 [' + matchedIp + '] vs 實際 [' + clientTrimmed + ']');
  return {
    ok: false,
    reason: '您目前的網路 IP（' + clientTrimmed + '）不在公司允許範圍內，請連接公司 WiFi 後再打卡'
  };
}

// ==================== WiFi 打卡核心 ====================

/**
 * 執行 WiFi 打卡（網頁版）
 * @param {string} sessionToken
 * @param {string} type      - '上班' | '下班'
 * @param {string} ssid      - 使用者選擇的 WiFi SSID
 * @param {string} clientIp  - 前端偵測到的公開 IP（由 api.ipify.org 取得）
 */
function punchWifi(sessionToken, type, ssid, clientIp) {
  try {
    Logger.log('📶 WiFi打卡開始');
    Logger.log('   type: '     + type);
    Logger.log('   ssid: '     + ssid);
    Logger.log('   clientIp: ' + (clientIp || '(未提供)'));

    const employee = checkSession_(sessionToken);
    const user = employee.user;
    if (!user) return { ok: false, code: 'ERR_SESSION_INVALID' };

    if (!ssid) return { ok: false, code: 'ERR_MISSING_SSID', msg: '未提供 WiFi 名稱' };

    // 驗證 SSID 是否在允許清單中
    const wifiResult = getWifiLocations_();
    if (!wifiResult.ok) return { ok: false, code: 'ERR_WIFI_CHECK_FAILED', msg: '無法取得 WiFi 設定' };

    const matchedLocation = wifiResult.locations.find(
      loc => loc.ssid === ssid || loc.name === ssid
    );

    if (!matchedLocation) {
      Logger.log('❌ SSID 不在允許清單: ' + ssid);
      return { ok: false, code: 'ERR_WIFI_NOT_ALLOWED', msg: '此 WiFi 網路不在允許的打卡範圍內' };
    }

    Logger.log('✅ SSID 驗證通過: ' + matchedLocation.name);

    // ★ IP 驗證
    const ipCheck = verifyClientIp_(matchedLocation.allowedIp, clientIp);
    if (!ipCheck.ok) {
      return { ok: false, code: 'ERR_IP_NOT_ALLOWED', msg: ipCheck.reason };
    }

    // 防重複打卡
    const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_ATTENDANCE);
    const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    const attendanceValues = sh.getDataRange().getValues();

    for (let i = 1; i < attendanceValues.length; i++) {
      const row = attendanceValues[i];
      if (!row[0]) continue;
      const rowDate   = Utilities.formatDate(new Date(row[0]), Session.getScriptTimeZone(), 'yyyy-MM-dd');
      const rowUserId = String(row[1]).trim();
      const rowType   = String(row[4]).trim();
      const rowNote   = String(row[7] || '').trim();
      if (rowNote === '補打卡') continue;
      if (rowDate === today && rowUserId === user.userId && rowType === type) {
        return { ok: false, code: 'ERR_DUPLICATE_PUNCH', msg: '今天已打過' + type + '卡，請勿重複打卡' };
      }
    }

    // 寫入打卡記錄
    const now  = new Date();
    const time = Utilities.formatDate(now, 'Asia/Taipei', 'HH:mm:ss');
    const ipTag = clientIp ? ' [IP:' + clientIp.trim() + ']' : '';
    const newRow = [
      now,
      user.userId,
      user.dept,
      user.name,
      type,
      'WiFi:' + ssid + ipTag,
      matchedLocation.name,
      'WiFi打卡',
      '',
      'Web App'
    ];
    sh.getRange(sh.getLastRow() + 1, 1, 1, newRow.length).setValues([newRow]);

    Logger.log('✅ WiFi打卡成功: ' + user.name + ' - ' + type + ' @ ' + matchedLocation.name);
    return { ok: true, code: 'PUNCH_SUCCESS', params: { type: type }, time: time, location: matchedLocation.name };
  } catch (error) {
    Logger.log('❌ punchWifi 錯誤: ' + error);
    return { ok: false, code: 'ERR_INTERNAL', msg: error.message };
  }
}

/**
 * LINE Bot 執行 WiFi 打卡
 * 注意：LINE Bot 無法取得使用者 IP，故 IP 驗證在此略過，
 *       僅做 SSID 驗證。需要更嚴格管控時建議僅允許網頁版 WiFi 打卡。
 */
function punchWifiByLineUserId(userId, type, ssid) {
  try {
    Logger.log('📶 LINE WiFi打卡開始');
    Logger.log('   userId: ' + userId);
    Logger.log('   type: '   + type);
    Logger.log('   ssid: '   + ssid);

    const employee = findEmployeeByLineUserId_(userId);
    if (!employee.ok) return { success: false, msg: '找不到員工資料' };

    if (!ssid) return { success: false, msg: '未提供 WiFi 名稱' };

    // SSID 驗證
    const wifiResult = getWifiLocations_();
    if (!wifiResult.ok) return { success: false, msg: '無法取得 WiFi 設定' };

    const matchedLocation = wifiResult.locations.find(
      loc => loc.ssid === ssid || loc.name === ssid
    );
    if (!matchedLocation) return { success: false, msg: '此 WiFi 網路不在允許的打卡範圍內' };

    // LINE 無法取得客戶端 IP，若地點設定了 IP 則提示
    if (matchedLocation.allowedIp) {
      Logger.log('⚠️ LINE WiFi打卡：此地點設有 IP 限制，LINE 無法驗證 IP，允許通過（SSID 已驗證）');
    }

    // 防重複打卡
    const sh  = SpreadsheetApp.getActive().getSheetByName(SHEET_ATTENDANCE);
    const now = new Date();
    const today = Utilities.formatDate(now, 'Asia/Taipei', 'yyyy-MM-dd');
    const attendanceValues = sh.getDataRange().getValues();

    for (let i = 1; i < attendanceValues.length; i++) {
      const row = attendanceValues[i];
      if (!row[0]) continue;
      const rowDate   = Utilities.formatDate(new Date(row[0]), 'Asia/Taipei', 'yyyy-MM-dd');
      const rowUserId = String(row[1]).trim();
      const rowType   = String(row[4]).trim();
      const rowNote   = String(row[7] || '').trim();
      if (rowNote === '補打卡') continue;
      if (rowDate === today && rowUserId === userId && rowType === type) {
        return { success: false, msg: '今天已打過' + type + '卡，請勿重複打卡' };
      }
    }

    const time = Utilities.formatDate(now, 'Asia/Taipei', 'HH:mm:ss');
    const newRow = [
      now,
      userId,
      employee.dept,
      employee.name,
      type,
      'WiFi:' + ssid,
      matchedLocation.name,
      'LINE Bot - WiFi打卡',
      '',
      'LINE Official Account'
    ];
    sh.getRange(sh.getLastRow() + 1, 1, 1, newRow.length).setValues([newRow]);

    Logger.log('✅ LINE WiFi打卡成功: ' + employee.name + ' - ' + type);
    return { success: true, time: time, locationName: matchedLocation.name };
  } catch (error) {
    Logger.log('❌ punchWifiByLineUserId 錯誤: ' + error);
    return { success: false, msg: error.message };
  }
}

// ==================== 工具函數 ====================

/**
 * 建立 WiFi 打卡設定工作表（含允許IP欄）
 */
function createWifiLocationSheet_(ss) {
  const sheet = ss.insertSheet(SHEET_WIFI_LOCATIONS);
  const headers = ['名稱', 'SSID（WiFi 名稱）', '備註', '允許的對外 IP（可留空）'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#0ea5e9');
  headerRange.setFontColor('#ffffff');
  headerRange.setHorizontalAlignment('center');

  sheet.setColumnWidth(1, 150);
  sheet.setColumnWidth(2, 200);
  sheet.setColumnWidth(3, 160);
  sheet.setColumnWidth(4, 220);
  sheet.setFrozenRows(1);

  Logger.log('✅ WIFI打卡設定工作表已建立');
  return sheet;
}
