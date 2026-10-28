/** 
 * GGM TASKS BACKEND - STAFF APP V24.0 (ULTRA-FAST & PREMIUM)
 * (FIXED: Direct Row Indexing & TextFinder for Sub-second Saves, Backdate Prevention)
 */
const DELEGATED_SHEET_ID = '1tEUckPww1GiD-PgP7yxMxt70W1Q-ueoUGXdI8_-Aq8A'; 
const ROUTINE_SHEET_ID   = '15KTN4Ptp_K1iRPt3fmssGjC39ttKJx-MFMWOj-SjADg'; 
const NEWAI_ROUTINE_SHEET_ID = '1s51ECvMoG-H3wgUsQhGOEmhFjlH_N4ZH4N8-iH1QoJU'; 
const RENEWAL_SHEET_ID   = '11yqI7704f2OGxQwbK-qo4Ko5G5e0M32LRW73JrzOIIs';
const DRIVE_FOLDER_ID    = '1E0_XYKcJjjRa1eBB_ju6H4qip58w9wIS'; 
const RENEWAL_DRIVE_FOLDER_ID = '1QDyFmY8yHpC9hk7lNXq5iTW1vSOFqAGh'; 

const SHEET_CACHE_TTL = 60;   
const USER_CACHE_TTL  = 20;   
const CHUNK_SIZE      = 90000;
const K_DEL = 'GGM_DEL_V1';
const K_ROU = 'GGM_ROU_V1';
const K_ROU_NEWAI = 'GGM_ROU_NW_V1'; 
const K_REN = 'GGM_REN_V1';
const K_LEV = 'GGM_LEV_V1';

function _cache() { return CacheService.getScriptCache(); }

function _getVersion() {
  try {
    const c = _cache();
    let v = c.get('GGM_DV');
    if (!v) { v = String(Date.now()); c.put('GGM_DV', v, 21600); }
    return v;
  } catch (e) { return '0'; }
}
function _bumpVersion() { try { _cache().put('GGM_DV', String(Date.now()), 21600); } catch (e) {} }

function _cacheGet(key) {
  try {
    const c = _cache();
    const meta = c.get(key + '|n');
    if (!meta) return null;
    const n = parseInt(meta, 10);
    if (!n || n < 1) return null;
    const keys = [];
    for (let i = 0; i < n; i++) keys.push(key + '|' + i);
    const parts = c.getAll(keys);
    let str = '';
    for (let i = 0; i < n; i++) {
      const p = parts[key + '|' + i];
      if (p === undefined || p === null) return null;
      str += p;
    }
    return JSON.parse(str);
  } catch (e) { return null; }
}

function _cachePut(key, obj, ttl) {
  try {
    const str = JSON.stringify(obj);
    if (str.length > 850000) return; 
    const n = Math.ceil(str.length / CHUNK_SIZE) || 1;
    const map = {};
    for (let i = 0; i < n; i++) map[key + '|' + i] = str.substring(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    map[key + '|n'] = String(n);
    _cache().putAll(map, ttl);
  } catch (e) {}
}

function _cacheDrop(key) {
  try {
    const c = _cache();
    const meta = c.get(key + '|n');
    const n = meta ? parseInt(meta, 10) : 0;
    const keys = [key + '|n'];
    for (let i = 0; i < n; i++) keys.push(key + '|' + i);
    c.removeAll(keys);
  } catch (e) {}
}

function _readBlock(sheet, startRow, startCol, numCols) {
  const lr = sheet.getLastRow();
  if (lr < startRow) return [];
  const maxCols = sheet.getMaxColumns();
  const avail = Math.max(0, Math.min(numCols, maxCols - startCol + 1));
  if (avail < 1) return [];
  const rows = sheet.getRange(startRow, startCol, lr - startRow + 1, avail).getValues();
  if (avail === numCols) return rows;
  for (let i = 0; i < rows.length; i++) {
    while (rows[i].length < numCols) rows[i].push("");
  }
  return rows;
}

function _loadDelegated() {
  const hit = _cacheGet(K_DEL);
  if (hit) return hit;
  const out = { master: [], staff: [], doers: [] };
  try {
    const ss = SpreadsheetApp.openById(DELEGATED_SHEET_ID);
    const m = ss.getSheetByName('Master');
    if (m) out.master = _readBlock(m, 2, 1, 19);
    const u = ss.getSheetByName('Users');
    if (u) out.staff = _readBlock(u, 2, 3, 1).map(r => r[0] ? String(r[0]).trim() : '');
    const d = ss.getSheetByName('Doer List');
    if (d) out.doers = _readBlock(d, 2, 4, 1).map(r => r[0] ? String(r[0]).trim() : '');
  } catch (e) { return out; }
  _cachePut(K_DEL, out, SHEET_CACHE_TTL);
  return out;
}

function _loadLeave() {
  const hit = _cacheGet(K_LEV);
  if (hit) return hit;
  const out = { data: [] };
  try {
    const ss = SpreadsheetApp.openById(DELEGATED_SHEET_ID);
    const sheet = ss.getSheetByName('Leave');
    if (sheet) out.data = _readBlock(sheet, 2, 1, 10);
  } catch (e) { return out; }
  _cachePut(K_LEV, out, SHEET_CACHE_TTL);
  return out;
}

function _loadRoutine() {
  const hit = _cacheGet(K_ROU);
  if (hit) return hit;
  const out = { master: [], summary: [] };
  try {
    const ss = SpreadsheetApp.openById(ROUTINE_SHEET_ID);
    let m = ss.getSheetByName('Monthly Master'); 
    if (m) out.master = _readBlock(m, 2, 1, 15);
    let s = ss.getSheetByName('SUMMARY');
    if (s) out.summary = _readBlock(s, 1, 1, 30);
  } catch (e) { return out; }
  _cachePut(K_ROU, out, SHEET_CACHE_TTL);
  return out;
}

function _loadNewaiRoutine() {
  const hit = _cacheGet(K_ROU_NEWAI);
  if (hit) return hit;
  const out = { master: [], summary: [] };
  try {
    const ss = SpreadsheetApp.openById(NEWAI_ROUTINE_SHEET_ID);
    let m = ss.getSheetByName('Monthly Master'); 
    if (m) out.master = _readBlock(m, 2, 1, 15);
    let s = ss.getSheetByName('SUMMARY');
    if (s) out.summary = _readBlock(s, 1, 1, 30);
  } catch (e) { return out; }
  _cachePut(K_ROU_NEWAI, out, SHEET_CACHE_TTL);
  return out;
}

function _loadRenewals() {
  const hit = _cacheGet(K_REN);
  if (hit) return hit;
  const out = { data: [] };
  try {
    const ss = SpreadsheetApp.openById(RENEWAL_SHEET_ID);
    const sheet = ss.getSheetByName('TASK FEED');
    if (sheet) out.data = _readBlock(sheet, 5, 1, 22); 
  } catch (e) { return out; }
  _cachePut(K_REN, out, SHEET_CACHE_TTL);
  return out;
}

function _invalidate(which) {
  if (which === 'routine'   || which === 'all') { _cacheDrop(K_ROU); _cacheDrop(K_ROU_NEWAI); }
  if (which === 'delegated' || which === 'all') _cacheDrop(K_DEL);
  if (which === 'renewal'   || which === 'all') _cacheDrop(K_REN);
  if (which === 'leave'     || which === 'all') _cacheDrop(K_LEV);
  _bumpVersion(); 
}

function _asDate(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) {
      const d = new Date(v);
      return isNaN(d.getTime()) ? null : d;
    }
    let m = v.trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
    if (m) {
      let d = new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10), 
                       m[4] ? parseInt(m[4], 10) : 0, m[5] ? parseInt(m[5], 10) : 0);
      return isNaN(d.getTime()) ? null : d;
    }
  }
  return null;
}

function _uploadFiles(fileDataArray, targetFolderId) {
  let urls = [];
  if (!fileDataArray || !fileDataArray.length) return "";

  let folder;
  try {
    let fId = targetFolderId ? targetFolderId : DRIVE_FOLDER_ID;
    folder = DriveApp.getFolderById(fId);
  } catch(e) {
    return "ERR: Drive Folder not found or permission denied.";
  }

  for (let i = 0; i < fileDataArray.length; i++) {
    try {
      const f = fileDataArray[i];
      if (f && f.fileId) { urls.push(bigUploadTake_(f, folder)); continue; }   // over 5 MB: already in Drive (BigUpload.js)
      if (!f || !f.base64) continue;
      let cleanBase64 = f.base64;
      if (cleanBase64.includes("base64,")) cleanBase64 = cleanBase64.split("base64,")[1];
      cleanBase64 = cleanBase64.replace(/\s/g, '');

      const decoded = Utilities.base64Decode(cleanBase64);
      const blob = Utilities.newBlob(decoded, f.mimeType || 'application/octet-stream', f.filename || ('file_' + Date.now()));
      const file = folder.createFile(blob);
      try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch(err) {}
      urls.push(file.getUrl());
    } catch (e) {
      return "ERR: File creation error: " + e.message;
    }
  }
  return urls.join(', ');
}

function doGet(e) {
  var gate = portalGate_(e);          // GGM Portal: launch pass / Portal-only (Portal.js)
  if (gate.block) return gate.block;
  return portalInject_(bigUploadPage_(HtmlService.createHtmlOutputFromFile('Index')), gate)   // + 50 MB attachments (BigUpload.js)
      .setTitle('GGM Tasks')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=0, viewport-fit=cover');
}

function getFastDateStr(dateObj) {
  if (!dateObj || isNaN(dateObj.getTime())) return "No Date";
  let d = dateObj.getDate().toString().padStart(2, '0');
  let m = (dateObj.getMonth() + 1).toString().padStart(2, '0');
  return `${d}/${m}/${dateObj.getFullYear()}`;
}

function getFastDateTimeStr(dateObj) {
  if (!dateObj || isNaN(dateObj.getTime())) return "";
  let dStr = getFastDateStr(dateObj);
  if (dStr === "No Date") return "";
  let h = dateObj.getHours(), min = dateObj.getMinutes().toString().padStart(2, '0'), ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12; return `${dStr} ${h.toString().padStart(2, '0')}:${min} ${ampm}`;
}

function parseServerDate(val) {
  if (!val) return null;
  if (val instanceof Date && !isNaN(val.getTime())) return val;
  if (typeof val === 'string') {
    let m = val.trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (m) {
      let d = new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
      if (!isNaN(d.getTime())) return d;
    }
  }
  let d = new Date(val);
  if (!isNaN(d.getTime())) return d;
  if (typeof val === 'string') {
    let p = val.includes('/') ? val.split('/') : val.includes('-') ? val.split('-') : [];
    if (p.length === 3) return new Date(p[2], p[1] - 1, p[0]);
  }
  return null;
}

function checkLogin(mobile, password) {
  // Connected to GGM Portal: the portal username/phone + password are tried first (checked by the hub).
  // While Portal-only is OFF the old mobile + password (Users tab) keeps working too.
  var portalMsg = '';
  if (portalEnabled_()) {
    try {
      var b = portalRemoteLogin_(mobile, password);
      return { success: true, name: b.name, fullName: b.fullName, token: b.token };
    } catch (e) {
      if (portalOnly_()) return { success: false, message: e.message || String(e) };
      portalMsg = e.message || String(e);
    }
  }
  var old = mobileLogin_(mobile, password);
  if (!old.success && portalMsg && /wrong/.test(old.message)) old.message = 'Mobile / username or password is wrong.';
  return old;
}

/** The app's own login: mobile + password from the Delegated sheet's Users tab. */
function mobileLogin_(mobile, password) {
  try {
    const ss = SpreadsheetApp.openById(DELEGATED_SHEET_ID);
    const sheet = ss.getSheetByName('Users');
    if (!sheet) return { success: false, message: "User list not found. Contact admin." };

    const data = _readBlock(sheet, 2, 1, 4);
    const inMob = String(mobile || "").trim(), inPass = String(password || "").trim();

    let matchedName = "", found = false;
    for (let i = 0; i < data.length; i++) {
      if (!data[i][0]) continue; 
      if (String(data[i][0]).trim() === inMob && String(data[i][1]).trim() === inPass) {
        matchedName = data[i][2] ? String(data[i][2]).trim() : "Employee";
        found = true; break;
      }
    }
    if (!found) return { success: false, message: "Mobile number or password is wrong." };

    const parts = matchedName.split('-');
    const clean = (parts.length >= 2) ? parts.slice(1).join('-').split('(')[0].trim() : matchedName.split('(')[0].trim();

    let exactFullName = matchedName;
    const doerSheet = ss.getSheetByName('Doer List');
    if (doerSheet) {
        const doerData = _readBlock(doerSheet, 2, 1, 4);
        for (let j = 0; j < doerData.length; j++) {
            if (String(doerData[j][1]).trim() === inMob) {
                if (doerData[j][3]) exactFullName = String(doerData[j][3]).trim();
                break;
            }
        }
    }
    var shortName = clean || matchedName || "Employee";
    var token = portalNewSession_({ u: inMob, n: shortName, d: exactFullName }, 'legacy');
    return { success: true, name: shortName, fullName: exactFullName, token: token };
  } catch (error) { return { success: false, message: "Server busy. Try again." }; }
}

/** Page → the signed-in person's tasks. The name comes from the session, not the browser. */
function getAllTasksForUser(token, userNameIgnored, forceFresh) {
  var sess = staffSessionOrNull_(token);
  if (!sess) return { sessionExpired: true };
  return getAllTasksForUser_(sess.name, forceFresh);
}

function getAllTasksForUser_(userName, forceFresh) {
  const searchName = String(userName || "").trim().toLowerCase();
  const firstName = searchName.split(" ")[0]; 

  if (forceFresh === true) { _invalidate('all'); }

  const uKey = 'GGM_UR|' + searchName + '|' + _getVersion();
  if (forceFresh !== true) {
    const cachedRes = _cacheGet(uKey);
    if (cachedRes) return cachedRes;
  }

  let result = { routineTasks: [], delegatedTasks: [], renewalTasks: [], leaveRequests: [], staffList: [], stats: { routineWeeklyTotal: 0, routineWeeklyDone: 0, routineMonthlyTotal: 0, routineMonthlyDone: 0, dailyScore: "0%", monthlyScore: "0" }, exactFullName: userName, isPeon: false, error: "" };

  const tz = "Asia/Kolkata";
  const now = new Date();
  const todayStr = Utilities.formatDate(now, tz, "dd/MM/yyyy");
  const tp = todayStr.split('/');
  const currentYear = parseInt(tp[2], 10);
  const currentMonth = parseInt(tp[1], 10) - 1; 

  let currentWeekStart = new Date(currentYear, currentMonth, parseInt(tp[0], 10));
  let day = currentWeekStart.getDay(); 
  currentWeekStart.setDate(currentWeekStart.getDate() - day + (day == 0 ? -6:1)); 
  const weekStartMs = currentWeekStart.getTime();

  let currentWeekEnd = new Date(currentWeekStart); 
  currentWeekEnd.setDate(currentWeekStart.getDate() + 6); 
  currentWeekEnd.setHours(23,59,59,999);
  const weekEndMs = currentWeekEnd.getTime();

  const isPeon = searchName.includes('peon') || searchName.includes('office boy') || searchName.includes('officeboy') || searchName.includes('satyanarayan') || searchName.includes('ram avatar');
  result.isPeon = isPeon;

  const _words = (s) => String(s || "").toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[0-9]/g, ' ').replace(/[^a-z\u0900-\u097F]+/g, ' ').split(/\s+/).filter(w => !['jpr', 'newai', 'kcl', 'saw', 'kha', 'fac', 'amg'].includes(w) && w.length > 0);
  const myWords = _words(searchName);

  const isNameMatch = (dbName) => {
    if (!dbName) return false;
    const d = String(dbName).toLowerCase().replace(/\s+/g, ' ').trim();
    if (d === searchName) return true;

    const dw = _words(d.split('-').length >= 2 ? d.split('-').slice(1).join('-') : d);
    if (!dw.length || !myWords.length) return false;

    if (dw.join(' ') === myWords.join(' ')) return true;

    const isDwVipin = dw.includes('vipin');
    const isMyWordsVipin = myWords.includes('vipin');

    if (isDwVipin && isMyWordsVipin) {
        if (!dw.includes('goyal') && myWords.includes('goyal')) return false;
        if (dw.includes('goyal') && !myWords.includes('goyal')) return false;
    }

    if (myWords.every(w => dw.indexOf(w) > -1)) return true;
    if (dw.every(w => myWords.indexOf(w) > -1)) return true;

    return (dw.length === 1 && dw[0] === firstName) || (myWords.length === 1 && dw.indexOf(firstName) > -1);
  };

  function processRoutineData(rouData, locationPrefix, locName) {
      const data = rouData.master;
      for (let i = 0; i < data.length; i++) {
        if (!data[i][0] || !isNameMatch(data[i][0])) continue; 

        let tId = locationPrefix + (data[i][3] ? String(data[i][3]).trim() : ("ROW_" + (i + 2))); 
        let staffRemark = data[i][11] ? String(data[i][11]).trim() : ""; 
        let staffFileUrl = data[i][12] ? String(data[i][12]).trim() : ""; 
        let rawStatus = data[i][8] ? String(data[i][8]).trim().toLowerCase() : "";
        let mappedStatus = 'pending';
        if (rawStatus === 'done' || rawStatus === 'completed') mappedStatus = 'completed';
        else if (rawStatus === 'review') mappedStatus = 'review';
        else if (String(data[i][7]).trim() !== "") mappedStatus = 'completed'; 

        let dateObj = parseServerDate(data[i][6]), isDone = (mappedStatus === 'completed');
        let taskTimeMs = dateObj ? dateObj.getTime() : 0, taskMonth = dateObj ? dateObj.getMonth() : -1, taskYear = dateObj ? dateObj.getFullYear() : -1;

        let dateStr = dateObj ? getFastDateStr(dateObj) : "No Date";
        let actualDateRaw = data[i][7], actualDateObj = _asDate(actualDateRaw);
        let actualDateStr = actualDateObj ? getFastDateTimeStr(actualDateObj) : (actualDateRaw ? String(actualDateRaw) : "");
        let isToday = (dateStr === todayStr), freqClean = String(data[i][4] || "NA").toUpperCase().trim(), isDaily = (freqClean === "D" || freqClean === "DAILY");

        if (taskMonth === currentMonth && taskYear === currentYear) {
            result.stats.routineMonthlyTotal++; if(isDone) result.stats.routineMonthlyDone++;
            if(taskTimeMs >= weekStartMs && taskTimeMs <= weekEndMs) { result.stats.routineWeeklyTotal++; if(isDone) result.stats.routineWeeklyDone++; }
        }

        let shouldSendToClient = false;
        if (!dateObj) { shouldSendToClient = !isDone; } 
        else if (isDone) { if ((taskMonth === currentMonth && taskYear === currentYear) || isToday) shouldSendToClient = true; } 
        else { shouldSendToClient = true; }

        if (shouldSendToClient || mappedStatus === 'review') {
            result.routineTasks.push({ taskId: tId, title: data[i][5] || "Untitled task", freq: freqClean, isDaily: isDaily, dueDate: dateStr, actualDate: actualDateStr, status: mappedStatus, isToday: isToday, staffRemark: staffRemark, staffFileUrl: staffFileUrl, type: 'routine', location: locName });
        }
      }

      const sumData = rouData.summary;
      if (sumData && sumData.length > 1 && locName === 'jaipur') {
          const headers = sumData[1];
          const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
          const currentMonthStr = monthNames[currentMonth] + " " + currentYear;

          let monthColIndex = -1;
          for (let c = 4; c < headers.length; c++) {
              let hStr = String(headers[c]).trim();
              if (hStr.includes(currentMonthStr) || hStr.includes(monthNames[currentMonth])) { monthColIndex = c; break; }
          }

          for (let r = 2; r < sumData.length; r++) {
              if (!sumData[r][2]) continue;
              if (isNameMatch(sumData[r][2])) {
                  let rawDaily = sumData[r][3];
                  if (rawDaily !== "" && rawDaily != null) {
                      if (typeof rawDaily === 'number') {
                          result.stats.dailyScore = (rawDaily <= 1 && rawDaily >= -1) ? Math.round(rawDaily * 100) + "%" : rawDaily + "%";
                      } else {
                          let str = String(rawDaily).trim();
                          if(str !== "" && !str.endsWith('%')) str += "%";
                          result.stats.dailyScore = str || "0%";
                      }
                  }

                  if (monthColIndex !== -1) {
                      let rawMonth = sumData[r][monthColIndex];
                      result.stats.monthlyScore = (rawMonth !== "" && rawMonth != null) ? String(rawMonth).trim() : "0";
                  }
                  break;
              }
          }
      }
  }

  try { processRoutineData(_loadRoutine(), "JPR_", "jaipur"); } catch(e) {}
  if (isPeon) { try { processRoutineData(_loadNewaiRoutine(), "NEWAI_", "newai"); } catch(e) {} }

  try {
      const del = _loadDelegated();
      for (let j = 0; j < (del.doers || []).length; j++) {
          if (isNameMatch(del.doers[j])) { result.exactFullName = del.doers[j]; break; }
      }

      let sMap = new Map();
      let staffSource = (del.doers && del.doers.length > 0) ? del.doers : del.staff;

      (staffSource || []).forEach(raw => { if(raw && !isNameMatch(raw)) { sMap.set(raw, raw); } });
      result.staffList = Array.from(sMap.entries()).map(([val, lbl]) => ({ value: val, label: lbl }));

      const data = del.master || [];
      for (let i = 0; i < data.length; i++) {
        let ownerName = data[i][2] ? String(data[i][2]).trim() : "";
        let transferToName = data[i][17] ? String(data[i][17]).trim() : ""; 
        let isOwner = isNameMatch(ownerName);
        let isTransferTarget = isNameMatch(transferToName);

        if (!isOwner && !isTransferTarget) continue; 

        let tId = data[i][1] ? String(data[i][1]).trim() : ("ROW_" + (i + 2)); 
        let title = data[i][3] ? data[i][3].toString().trim() : "No title";
        let statusRaw = data[i][9] ? data[i][9].toString().trim().toLowerCase() : "pending";
        // Task Delegation marks a task revised a 3rd time "Week Shifted" and creates a fresh copy:
        // showing the old row too gave staff a duplicate that never went away.
        if (statusRaw === 'week shifted' || statusRaw === 'cancelled') continue;
        let givenBy = data[i][10] ? data[i][10].toString().trim() : "N/A";
        let photoLink = data[i][11] ? data[i][11].toString().trim() : ""; 
        let remark = data[i][13] ? data[i][13].toString().trim() : ""; 
        let staffRemark = data[i][14] ? String(data[i][14]).trim() : ""; 
        let staffFileUrl = data[i][15] ? data[i][15].toString().trim() : ""; 
        let extraNote = data[i][16] ? data[i][16].toString().trim() : ""; 

        let rawDate = data[i][4], dateObj = parseServerDate(rawDate), dueDate = dateObj ? getFastDateStr(dateObj) : "No Date";
        let actualDateRaw = data[i][7], actualDateObj = _asDate(actualDateRaw);
        let actualDateStr = actualDateObj ? getFastDateTimeStr(actualDateObj) : (actualDateRaw ? String(actualDateRaw) : "");
        let approvalDateRaw = data[i][17], approvalDateObj = _asDate(approvalDateRaw);
        let approvalDateStr = approvalDateObj ? getFastDateTimeStr(approvalDateObj) : (approvalDateRaw ? String(approvalDateRaw) : "");

        let isToday = (dueDate === todayStr), mappedStatus = 'pending';
        if(statusRaw === 'review') mappedStatus = 'review'; else if(statusRaw === 'rejected') mappedStatus = 'rejected'; else if(statusRaw === 'done' || statusRaw === 'completed') mappedStatus = 'completed';

        let tStatus = 'none';
        if (transferToName && (mappedStatus === 'pending' || mappedStatus === 'rejected')) {
            if (isOwner && !isTransferTarget) tStatus = 'outgoing';
            if (!isOwner && isTransferTarget) tStatus = 'incoming';
        }

        result.delegatedTasks.push({ 
            taskId: tId, title: title, dueDate: dueDate, actualDate: actualDateStr, approvalDate: approvalDateStr, status: mappedStatus, 
            givenBy: givenBy, remark: remark, staffRemark: staffRemark, extraNote: extraNote, photoLink: photoLink, staffFileUrl: staffFileUrl,
            isToday: isToday, type: 'delegated', transferStatus: tStatus, transferTo: transferToName, originalOwner: ownerName
        });
      }
  } catch(e) {}

  try {
      const renData = _loadRenewals();
      const rData = renData.data || [];
      for (let i = 0; i < rData.length; i++) {

          let assignee = rData[i][6] ? String(rData[i][6]).trim() : "";
          if (!isNameMatch(assignee)) continue;

          let isDoneCheckbox = rData[i][16] === true || String(rData[i][16]).trim().toUpperCase() === 'TRUE';
          let statusRaw = rData[i][20] ? String(rData[i][20]).trim().toLowerCase() : "";
          let renewedOnVal = rData[i][13] ? String(rData[i][13]).trim() : "";

          let mappedStatus = 'pending';
          if (statusRaw === 'completed' || isDoneCheckbox) { mappedStatus = 'completed'; } 
          else if (statusRaw === 'review') { mappedStatus = 'review'; } 
          else if (statusRaw === 'rejected') { mappedStatus = 'rejected'; } 
          else if (renewedOnVal && !statusRaw) { mappedStatus = 'review'; }

          let taskId = rData[i][1] ? String(rData[i][1]).trim() : ("REN_" + i);
          let title = rData[i][4] ? String(rData[i][4]).trim() : "Untitled Renewal";
          let reference = rData[i][5] ? String(rData[i][5]).trim() : "";
          let triggerRaw = rData[i][8], triggerObj = _asDate(triggerRaw);
          let triggerDate = triggerObj ? getFastDateStr(triggerObj) : (triggerRaw ? String(triggerRaw).trim() : "");
          let dueRaw = rData[i][9], dueObj = _asDate(dueRaw);
          let dueDate = dueObj ? getFastDateStr(dueObj) : (dueRaw ? String(dueRaw).trim() : "");
          let priority = rData[i][11] ? String(rData[i][11]).trim() : "Normal";
          let cost = rData[i][15] ? String(rData[i][15]).trim() : "";
          let docLink = rData[i][19] ? String(rData[i][19]).trim() : "";
          let adminRemark = rData[i][21] ? String(rData[i][21]).trim() : ""; 

          result.renewalTasks.push({
              taskId: taskId, title: title, reference: reference, triggerDate: triggerDate, dueDate: dueDate, actualDate: renewedOnVal, priority: priority, status: mappedStatus, cost: cost, docLink: docLink, remark: adminRemark, type: 'renewal'
          });
      }
  } catch(e) {}

  try {
      const lvData = _loadLeave();
      const lRows = lvData.data || [];
      for (let i = 0; i < lRows.length; i++) {
          let empName = lRows[i][1] ? String(lRows[i][1]).trim() : "";
          if (!isNameMatch(empName)) continue;

          let timestampStr = (lRows[i][0] instanceof Date) ? getFastDateTimeStr(lRows[i][0]) : String(lRows[i][0] || '');
          let startDateStr = (lRows[i][4] instanceof Date) ? getFastDateStr(lRows[i][4]) : String(lRows[i][4] || '');
          let endDateStr   = (lRows[i][5] instanceof Date) ? getFastDateStr(lRows[i][5]) : String(lRows[i][5] || '');

          result.leaveRequests.push({
              timestamp: timestampStr, leaveType: String(lRows[i][3] || ''), startDate: startDateStr, endDate: endDateStr, duration: String(lRows[i][6] || ''), reason: String(lRows[i][7] || ''), status: String(lRows[i][8] || 'Pending'), remark: String(lRows[i][9] || '')
          });
      }
      result.leaveRequests.reverse(); 
  } catch(e) {}

  _cachePut(uKey, result, USER_CACHE_TTL);
  return result;
}

// -------------------------------------------------------------------------
// O(1) ULTRA-FAST BACKEND OPERATIONS (TextFinder + Direct Row Updates)
// -------------------------------------------------------------------------

// Helper to quickly find row by ID
function _getFastRow(sheet, colLetter, searchId) {
    if (String(searchId).startsWith("ROW_")) {
        return parseInt(String(searchId).split("_")[1], 10);
    }
    let match = sheet.getRange(colLetter + ":" + colLetter).createTextFinder(searchId).matchEntireCell(true).findNext();
    return match ? match.getRow() : -1;
}

function markRoutineTaskDone(token, taskId, fileDataArray) {
  var sess = staffSessionOrNull_(token);
  if (!sess) return { success: false, expired: true, message: 'Your sign-in has ended. Please log in again.' };
  let finalFileStr = "";
  if (fileDataArray && fileDataArray.length > 0) {
      finalFileStr = _uploadFiles(fileDataArray);
      if (finalFileStr.startsWith("ERR:")) return { success: false, message: finalFileStr };
  }
  var lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch(e) { return {success: false, message: "System is busy."}; }
  
  try {
      let exactTimeStr = Utilities.formatDate(new Date(), "Asia/Kolkata", "dd/MM/yyyy HH:mm:ss"); 
      let isNewai = String(taskId).includes("NEWAI_");
      let cleanId = String(taskId).replace("NEWAI_", "").replace("JPR_", "").trim().toUpperCase();
      let sheet = SpreadsheetApp.openById(isNewai ? NEWAI_ROUTINE_SHEET_ID : ROUTINE_SHEET_ID).getSheetByName("Monthly Master");

      let r = _getFastRow(sheet, "D", cleanId);
      if (r > 1) {
          sheet.getRange(r, 8, 1, 2).setValues([[exactTimeStr, "Done"]]);
          if (finalFileStr) sheet.getRange(r, 13).setValue(finalFileStr); // Col M
          SpreadsheetApp.flush(); _invalidate('routine');
          return { success: true };
      }
      return { success: false, message: "Task not found" };
  } catch(e) { return { success: false, message: e.toString() }; }
  finally { lock.releaseLock(); }
}

function markRoutineTaskDoneBatch(token, taskIdsArray) {
  var sess = staffSessionOrNull_(token);
  if (!sess) return { success: false, expired: true, message: 'Your sign-in has ended. Please log in again.' };
  if (!taskIdsArray || taskIdsArray.length === 0) return { success: true };
  
  var lock = LockService.getScriptLock();
  try { lock.waitLock(18000); } catch(e) { return {success: false, message: "System is busy."}; }
  
  try {
    let exactTimeStr = Utilities.formatDate(new Date(), "Asia/Kolkata", "dd/MM/yyyy HH:mm:ss"); 
    let updatedCount = 0;
    
    const processSheetBulk = (sheetId, idsList) => {
        if (!idsList || idsList.length === 0) return;
        let sheet = SpreadsheetApp.openById(sheetId).getSheetByName("Monthly Master");
        idsList.forEach(id => {
            let r = _getFastRow(sheet, "D", id);
            if(r > 1) { sheet.getRange(r, 8, 1, 2).setValues([[exactTimeStr, "Done"]]); updatedCount++; }
        });
    };

    let jprIds = taskIdsArray.filter(id => !String(id).includes("NEWAI_")).map(id => String(id).replace("JPR_", "").trim().toUpperCase());
    let newaiIds = taskIdsArray.filter(id => String(id).includes("NEWAI_")).map(id => String(id).replace("NEWAI_", "").trim().toUpperCase());

    processSheetBulk(ROUTINE_SHEET_ID, jprIds);
    processSheetBulk(NEWAI_ROUTINE_SHEET_ID, newaiIds);

    if (updatedCount > 0) { SpreadsheetApp.flush(); _invalidate('routine'); }
    return { success: true, updated: updatedCount };
  } catch(e) { return { success: false, message: e.toString() }; }
  finally { lock.releaseLock(); }
}

function markDelegatedTaskReview(token, taskId, fileDataArray) {
  var sess = staffSessionOrNull_(token);
  if (!sess) return { success: false, expired: true, message: 'Your sign-in has ended. Please log in again.' };
  let finalFileStr = "";
  if (fileDataArray && fileDataArray.length > 0) {
      finalFileStr = _uploadFiles(fileDataArray);
      if (finalFileStr.startsWith("ERR:")) return { success: false, message: finalFileStr };
  }
  var lock = LockService.getScriptLock();
  try { lock.waitLock(18000); } catch(e) { return {success: false, message: "System is busy."}; }
  
  try {
    let exactTimeStr = Utilities.formatDate(new Date(), "Asia/Kolkata", "dd/MM/yyyy HH:mm:ss");
    let sheet = SpreadsheetApp.openById(DELEGATED_SHEET_ID).getSheetByName('Master');
    let cleanId = String(taskId).trim().toUpperCase();
    
    let r = _getFastRow(sheet, "B", cleanId);
    if (r > 1) {
        let givenBy = String(sheet.getRange(r, 11).getValue()).trim();
        let newStatus = (givenBy.toLowerCase() === 'self') ? 'Completed' : 'Review';
        sheet.getRange(r, 8).setValue(exactTimeStr); 
        sheet.getRange(r, 10).setValue(newStatus);
        if (finalFileStr) sheet.getRange(r, 16).setValue(finalFileStr);
        SpreadsheetApp.flush(); _invalidate('delegated'); 
        return { success: true, status: newStatus };
    }
    return { success: false, message: "Task not found." };
  } catch (error) { return { success: false, message: error.toString() }; }
  finally { lock.releaseLock(); }
}

function markDelegatedTaskReviewBatch(token, taskIdsArray) {
  var sess = staffSessionOrNull_(token);
  if (!sess) return { success: false, expired: true, message: 'Your sign-in has ended. Please log in again.' };
  if (!taskIdsArray || taskIdsArray.length === 0) return { success: true };
  
  var lock = LockService.getScriptLock();
  try { lock.waitLock(18000); } catch(e) { return {success: false, message: "System is busy."}; }
  
  try {
    let exactTimeStr = Utilities.formatDate(new Date(), "Asia/Kolkata", "dd/MM/yyyy HH:mm:ss");
    let sheet = SpreadsheetApp.openById(DELEGATED_SHEET_ID).getSheetByName('Master');
    let updatedCount = 0;

    taskIdsArray.forEach(id => {
        let cleanId = String(id).trim().toUpperCase();
        let r = _getFastRow(sheet, "B", cleanId);
        if(r > 1) {
            let givenBy = String(sheet.getRange(r, 11).getValue()).trim();
            let newStatus = (givenBy.toLowerCase() === 'self') ? 'Completed' : 'Review';
            sheet.getRange(r, 8).setValue(exactTimeStr);
            sheet.getRange(r, 10).setValue(newStatus);
            updatedCount++;
        }
    });

    if (updatedCount > 0) { SpreadsheetApp.flush(); _invalidate('delegated'); }
    return { success: true, updated: updatedCount };
  } catch (error) { return { success: false, message: error.toString() }; }
  finally { lock.releaseLock(); }
}

function addRemarkToTask(token, taskId, remarkText, type, fileDataArray, isJustNote) {
  var sess = staffSessionOrNull_(token);
  if (!sess) return { success: false, expired: true, message: 'Your sign-in has ended. Please log in again.' };
  let finalFileStr = "";
  if (fileDataArray && fileDataArray.length > 0) {
      finalFileStr = _uploadFiles(fileDataArray);
      if (finalFileStr.startsWith("ERR:")) return { success: false, message: finalFileStr };
  }
  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch(e) { return {success: false, message: "System is busy."}; }

  try {
    let exactTimeStr = Utilities.formatDate(new Date(), "Asia/Kolkata", "dd/MM/yyyy HH:mm:ss"); 
    let searchId = String(taskId).trim().toUpperCase();

    if (type === 'delegated') {
        let sheet = SpreadsheetApp.openById(DELEGATED_SHEET_ID).getSheetByName('Master');
        let r = _getFastRow(sheet, "B", searchId);
        if (r > 1) {
            if (!isJustNote) {
                let givenBy = String(sheet.getRange(r, 11).getValue()).trim();
                let newStatus = (givenBy.toLowerCase() === 'self') ? 'Completed' : 'Review';
                sheet.getRange(r, 8, 1, 3).setValues([[exactTimeStr, sheet.getRange(r,9).getValue(), newStatus]]); 
            }
            if (remarkText) sheet.getRange(r, 15).setValue(remarkText); 
            if (finalFileStr) sheet.getRange(r, 16).setValue(finalFileStr); 
            SpreadsheetApp.flush(); _invalidate('delegated'); 
            return { success: true, fileUrl: finalFileStr };
        }
    } else if (type === 'routine') {
        let isNewai = searchId.startsWith("NEWAI_");
        let cleanId = searchId.replace("NEWAI_", "").replace("JPR_", "").trim();
        let sheet = SpreadsheetApp.openById(isNewai ? NEWAI_ROUTINE_SHEET_ID : ROUTINE_SHEET_ID).getSheetByName("Monthly Master");

        let r = _getFastRow(sheet, "D", cleanId);
        if (r > 1) {
            if (!isJustNote) sheet.getRange(r, 8, 1, 2).setValues([[exactTimeStr, "Done"]]);
            if (remarkText) sheet.getRange(r, 12).setValue(remarkText);
            if (finalFileStr) sheet.getRange(r, 13).setValue(finalFileStr); 
            SpreadsheetApp.flush(); _invalidate('routine'); return { success: true, fileUrl: finalFileStr };
        }
    } else if (type === 'renewal') {
        let sheet = SpreadsheetApp.openById(RENEWAL_SHEET_ID).getSheetByName('TASK FEED');
        let r = _getFastRow(sheet, "B", searchId);
        if (r > 1) {
            if (remarkText) sheet.getRange(r, 22).setValue(remarkText);
            SpreadsheetApp.flush(); _invalidate('renewal'); return { success: true };
        }
    }
    return { success: false, message: "Task not found." };
  } catch(e) { return { success: false, message: e.toString() }; }
  finally { lock.releaseLock(); }
}

function submitRenewalTaskDone(token, taskId, payload) {
  var sess = staffSessionOrNull_(token);
  if (!sess) return { success: false, expired: true, message: 'Your sign-in has ended. Please log in again.' };
  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch(e) { return {success: false, message: "System is busy."}; }
  try {
    let fileStr = "";
    if (payload.files && payload.files.length > 0) {
        fileStr = _uploadFiles(payload.files, RENEWAL_DRIVE_FOLDER_ID);
        if (fileStr.startsWith("ERR:")) return { success: false, message: fileStr };
    }

    let sheet = SpreadsheetApp.openById(RENEWAL_SHEET_ID).getSheetByName('TASK FEED');
    let searchId = String(taskId).trim().toUpperCase();
    let r = _getFastRow(sheet, "B", searchId);

    if (r > 1) {
        let fmtDate = (dStr) => { if (!dStr) return ""; let parts = dStr.split('-'); return (parts.length === 3) ? `${parts[2]}/${parts[1]}/${parts[0]}` : dStr; };

        sheet.getRange(r, 14, 1, 3).setValues([[fmtDate(payload.renewedOn), fmtDate(payload.newValidUntil), payload.totalCost]]);
        if (fileStr) sheet.getRange(r, 20).setValue(fileStr); 
        sheet.getRange(r, 21).setValue("Review");
        if(payload.staffRemark) sheet.getRange(r, 22).setValue(payload.staffRemark);

        SpreadsheetApp.flush(); _invalidate('renewal');
        return { success: true };
    }
    return { success: false, message: "Task ID not found in sheet." };
  } catch(e) { return { success: false, message: e.toString() }; } 
  finally { lock.releaseLock(); }
}

function requestTransfer(token, taskId, targetNameExact) {
  var sess = staffSessionOrNull_(token);
  if (!sess) return { success: false, expired: true, message: 'Your sign-in has ended. Please log in again.' };
  var lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch(e) { return {success: false, message: "System is busy."}; }
  try {
    let sheet = SpreadsheetApp.openById(DELEGATED_SHEET_ID).getSheetByName('Master');
    let r = _getFastRow(sheet, "B", String(taskId).trim().toUpperCase());

    if (r > 1) {
        sheet.getRange(r, 18).setValue(targetNameExact); 
        SpreadsheetApp.flush(); _invalidate('delegated'); return { success: true };
    }
    return { success: false, message: "Task not found." };
  } catch (e) { return { success: false, message: e.toString() }; }
  finally { lock.releaseLock(); }
}

function processTransferResponse(token, taskId, action, currentUserNameExact) {
  var sess = staffSessionOrNull_(token);
  if (!sess) return { success: false, expired: true, message: 'Your sign-in has ended. Please log in again.' };
  currentUserNameExact = sess.full;          // always the signed-in person
  var lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch(e) { return {success: false, message: "System is busy."}; }
  try {
    let sheet = SpreadsheetApp.openById(DELEGATED_SHEET_ID).getSheetByName('Master');
    let r = _getFastRow(sheet, "B", String(taskId).trim().toUpperCase());

    if (r > 1) {
        if (action === 'accept') {
            sheet.getRange(r, 3).setValue(currentUserNameExact); 
            sheet.getRange(r, 18).setValue("");              
        } else if (action === 'reject' || action === 'cancel') {
            sheet.getRange(r, 18).setValue("");              
        }
        SpreadsheetApp.flush(); _invalidate('delegated'); return { success: true };
    }
    return { success: false, message: "Task not found." };
  } catch (e) { return { success: false, message: e.toString() }; }
  finally { lock.releaseLock(); }
}

function createSelfTask(token, userNameExact, taskTitle, dueDateStr) {
  var sess = staffSessionOrNull_(token);
  if (!sess) return { success: false, expired: true, message: 'Your sign-in has ended. Please log in again.' };
  userNameExact = sess.full;                 // always the signed-in person
  var lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch(e) { return {success: false, message: "System is busy."}; }
  try {
    const ss = SpreadsheetApp.openById(DELEGATED_SHEET_ID);
    const sheet = ss.getSheetByName('Master');
    const now = new Date();
    const lr = sheet.getLastRow();
    let nextNumber = 1; 

    if (lr > 1) {
        const ids = sheet.getRange(Math.max(2, lr - 50), 2, 51, 1).getValues();
        let maxNum = 0;
        for (let i = 0; i < ids.length; i++) {
            const match = String(ids[i][0]).trim().match(/^TK-(\d+)$/i);
            if (match && match[1]) {
                const num = parseInt(match[1], 10);
                if (num > maxNum) maxNum = num;
            }
        }
        if (maxNum > 0) nextNumber = maxNum + 1;
    }

    const newId = "TK-" + nextNumber.toString().padStart(3, '0');
    let targetDate = now;
    if (dueDateStr) {
        let parts = dueDateStr.split('-');
        if (parts.length === 3) {
            let d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), now.getHours(), now.getMinutes());
            let todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            let selectedMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate());
            if (selectedMidnight < todayMidnight) return { success: false, message: "Backdated tasks are not allowed." };
            targetDate = d;
        }
    }

    sheet.appendRow([now, newId, userNameExact, taskTitle, targetDate, "", "", "", "", "Pending", "Self"]);
    SpreadsheetApp.flush(); _invalidate('delegated');
    return { success: true, taskId: newId };
  } catch (error) { return { success: false, message: error.toString() }; }
  finally { lock.releaseLock(); }
}

function submitAdvancedLeave(token, leaveData) {
  var sess = staffSessionOrNull_(token);
  if (!sess) return { success: false, expired: true, message: 'Your sign-in has ended. Please log in again.' };
  leaveData = leaveData || {}; leaveData.employeeName = sess.full;   // always the signed-in person
  var lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch(e) { return {success: false, message: "System is busy. Please retry."}; }
  try {
    let now = new Date();
    let todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    if (leaveData.startDate) {
        let startDObj = new Date(leaveData.startDate);
        if (startDObj < todayMidnight) return { success: false, message: "Backdated leaves are not allowed." };
    }

    const ss = SpreadsheetApp.openById(DELEGATED_SHEET_ID);
    let leaveSheet = ss.getSheetByName('Leave');
    if (!leaveSheet) return { success: false, message: "Leave sheet not found." };
    let exactTimeStr = Utilities.formatDate(now, "Asia/Kolkata", "dd/MM/yyyy HH:mm:ss");
    let startD = leaveData.startDate ? Utilities.formatDate(new Date(leaveData.startDate), "Asia/Kolkata", "dd/MM/yyyy") : "";
    let endD = leaveData.endDate ? Utilities.formatDate(new Date(leaveData.endDate), "Asia/Kolkata", "dd/MM/yyyy") : "";

    leaveSheet.appendRow([exactTimeStr, leaveData.employeeName, leaveData.reportingPerson, leaveData.leaveType, startD, endD, leaveData.durationType, leaveData.reason, "Pending", ""]);
    SpreadsheetApp.flush(); _invalidate('leave'); 
    return { success: true };
  } catch (e) { return { success: false, message: e.toString() }; } finally { lock.releaseLock(); }
}