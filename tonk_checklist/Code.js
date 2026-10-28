/**
 * GGM MASTER BACKEND (Dual UI System - Driver & Staff)
 * Build: v16.0 (High-Speed Parallel Save Architecture)
 */

const DELEGATED_SHEET_ID = '1tEUckPww1GiD-PgP7yxMxt70W1Q-ueoUGXdI8_-Aq8A'; 
const ROUTINE_SHEET_ID   = '1FT2ZCdzMIpqw2LQjs5l5zbCX6d1ir5mpm6Bux3dlA3Q'; 
const DRIVE_FOLDER_ID    = '1E0_XYKcJjjRa1eBB_ju6H4qip58w9wIS';

const SHEET_CACHE_TTL = 60;   
const USER_CACHE_TTL  = 20;   
const CHUNK_SIZE      = 90000;
const K_DEL = 'GGM_DEL_V1';
const K_ROU = 'GGM_ROU_V1';

// ==========================================
// CACHE & UTILS (All Safe & Kept Intact)
// ==========================================
function _cache() { return CacheService.getScriptCache(); }

function _getVersion() {
  try {
    const c = _cache(); let v = c.get('GGM_DV');
    if (!v) { v = String(Date.now()); c.put('GGM_DV', v, 21600); }
    return v;
  } catch (e) { return '0'; }
}

function _bumpVersion() { try { _cache().put('GGM_DV', String(Date.now()), 21600); } catch (e) {} }

function _cacheGet(key) {
  try {
    const c = _cache(); const meta = c.get(key + '|n');
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
    const c = _cache(); const meta = c.get(key + '|n');
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

function _asDate(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
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
  h = h % 12 || 12; 
  return `${dStr} ${h.toString().padStart(2, '0')}:${min} ${ampm}`;
}

// ==========================================
// CORE APP & MENU
// ==========================================
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('GGM Checklist')
    .addItem('🚀 Sync & Generate 1-Year Tasks', 'drv_submitButtonClicked')
    .addItem('🧹 Clean Duplicates & Orphans', 'cleanMasterSheets')
    .addItem('🔄 Manual Sync: Monthly to Master', 'syncMonthlyToMasterUI')
    .addItem('👥 Assign Buddy', 'showAssignBuddyDialog')
    .addItem('⚙️ Setup Setup Time', 'setTrigger')
    .addToUi();
}

function doGet(e) {
  var gate = portalGate_(e);          // GGM Portal: launch pass / Portal-only (Portal.js)
  if (gate.block) return gate.block;
  return portalInject_(bigUploadPage_(HtmlService.createHtmlOutputFromFile('index')), gate)   // + 50 MB attachments (BigUpload.js)
      .setTitle('GGM Master Workspace')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=0, viewport-fit=cover');
}

// ==========================================
// THE ULTIMATE ONEDIT PROTECTIONS
// ==========================================
function onEdit(e) {
  if (!e || !e.range || !e.source) return;

  try {
    const ssId = e.source.getId();
    const sheet = e.range.getSheet();
    const sheetName = sheet.getName();
    const rowStart = e.range.getRow();
    const colStart = e.range.getColumn();
    const numRows = e.range.getNumRows();
    const numCols = e.range.getNumColumns();

    if (ssId === ROUTINE_SHEET_ID) {
      if (sheetName === "Task List" && rowStart > 1 && colStart <= 5) {
        let statusRange = sheet.getRange(rowStart, 6, numRows, 1);
        let values = statusRange.getValues();
        let changed = false;
        for (let i = 0; i < values.length; i++) {
          if (String(values[i][0]).trim().toLowerCase() === "sent") { values[i][0] = ""; changed = true; }
        }
        if (changed) statusRange.setValues(values);
        return; 
      }

      if (sheetName === "Checklist" && rowStart <= 3) {
        var maxRowsChk = sheet.getMaxRows();
        if (maxRowsChk >= 5) sheet.getRange(5, 4, maxRowsChk - 4, 31).clearNote();
        SpreadsheetApp.flush(); Utilities.sleep(500); updateChecklistNotes(); 
      } else if ((sheetName === "Monthly Master" || sheetName === "Master") && (colStart <= 9 && (colStart + numCols - 1) >= 8)) {
        SpreadsheetApp.flush(); Utilities.sleep(500); updateChecklistNotes(); 
      }
    }

    if (ssId === DELEGATED_SHEET_ID) {
      if (sheetName === 'Master' && colStart <= 10 && (colStart + numCols - 1) >= 10) {
        const now = new Date();
        const values = sheet.getRange(rowStart, 10, numRows, 1).getValues();
        for (let r = 0; r < values.length; r++) {
            const v = String(values[r][0] || "").trim().toLowerCase();
            if (v === 'completed' || v === 'done' || v === 'rejected') {
                sheet.getRange(rowStart + r, 18).setValue(now); 
            }
        }
      }
    }
  } catch (error) {}
}

// ==========================================
// MANUAL SYNC: MONTHLY TO MASTER
// ==========================================
function syncMonthlyToMasterUI() {
  portalAssertEditor_();
    let ui = SpreadsheetApp.getUi();
    let response = ui.alert("Sync Confirm", "Push progress from 'Monthly Master' to 'Master' sheet?", ui.ButtonSet.YES_NO);
    if (response !== ui.Button.YES) return;
    syncMonthlyToMaster(true);
}

function syncMonthlyToMaster(fromUI) {
  let lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch(e) { return; }

  try {
    let ss = SpreadsheetApp.openById(ROUTINE_SHEET_ID);
    let monthlySheet = ss.getSheetByName("Monthly Master");
    let masterSheet = ss.getSheetByName("Master");
    if (!monthlySheet || !masterSheet) return;

    let monthlyData = monthlySheet.getDataRange().getValues();
    let masterData = masterSheet.getDataRange().getValues();
    
    let monthMap = new Map();
    for (let i = 1; i < monthlyData.length; i++) {
        let tId = String(monthlyData[i][3]).trim();
        if (tId) monthMap.set(tId, monthlyData[i]);
    }

    for (let j = 1; j < masterData.length; j++) {
        let tId = String(masterData[j][3]).trim();
        if (tId && monthMap.has(tId)) {
            let mRow = monthMap.get(tId);
            let status = String(mRow[8]).trim();
            let remark = String(mRow[11]).trim();
            if (status !== "" || remark !== "") {
                masterData[j][7] = mRow[7];  
                masterData[j][8] = status;   
                masterData[j][11] = remark;  
                masterData[j][12] = mRow[12];
            }
        }
    }
    
    masterSheet.getRange(1, 1, masterData.length, masterData[0].length).setValues(masterData);
    SpreadsheetApp.flush();

    let currentMonth = new Date().getMonth();
    let currentYear = new Date().getFullYear();
    let newMonthlyData = [masterData[0]]; 

    for (let i = 1; i < masterData.length; i++) {
        let plannedDate = parseServerDate(masterData[i][6]); 
        if (plannedDate && plannedDate.getMonth() === currentMonth && plannedDate.getFullYear() === currentYear) {
            newMonthlyData.push([...masterData[i]]);
        }
    }

    monthlySheet.getRange(2, 1, Math.max(monthlySheet.getLastRow(), 2), newMonthlyData[0].length).clearContent();
    if (newMonthlyData.length > 1) {
        monthlySheet.getRange(1, 1, newMonthlyData.length, newMonthlyData[0].length).setValues(newMonthlyData);
    }
    
    SpreadsheetApp.flush();
    _invalidate('routine');
    
    if (fromUI) SpreadsheetApp.getUi().alert("Success ✅", "Monthly Master perfectly synced to Master Sheet without data loss.", SpreadsheetApp.getUi().ButtonSet.OK);

  } catch (e) {
      if (fromUI) SpreadsheetApp.getUi().alert("Error ❌", e.toString(), SpreadsheetApp.getUi().ButtonSet.OK);
  } finally { lock.releaseLock(); }
}

// ==========================================
// SMART LOGIN (Role Detection)
// ==========================================
function checkLogin(mobile, password) {
  // Connected to GGM Portal: the portal username/phone + password are tried first (checked by the hub).
  // While Portal-only is OFF the old mobile + password keeps working too. The shared built-in
  // "Main" login stays retired once connected (anyone who knew it got in as admin).
  var portalMsg = '';
  if (portalEnabled_()) {
    try {
      var b = portalRemoteLogin_(mobile, password);
      return { success: true, name: b.name, fullName: b.fullName, role: b.role, mobile: b.mobile, dept: b.dept, token: b.token };
    } catch (e) {
      if (portalOnly_()) return { success: false, message: e.message || String(e) };
      portalMsg = e.message || String(e);
    }
  }
  var old = mobileLogin_(mobile, password);
  if (!old.success && portalMsg && /wrong|Invalid|not found/i.test(String(old.message))) old.message = 'Mobile / username or password is wrong.';
  return old;
}

/** The app's own login: mobile + password from the Tonk Doer List / Delegated Users tab. */
function mobileLogin_(mobile, password) {
  try {
    if (!portalEnabled_() && String(mobile).trim() === "Main" && String(password).trim() === "123456") return { success: true, name: "Admin (Sir)", fullName: "Admin (Sir)", role: 'staff', mobile: "Main", dept: "Admin",
      token: portalNewSession_({ u: 'Main', n: 'Admin (Sir)', d: 'Admin (Sir)', p: 'Main', r: 'STAFF' }, 'legacy') };

    const inMob = String(mobile || "").trim();
    const inPass = String(password || "").trim();
    let matchedName = "", exactFullName = "", dept = "", found = false;

    try {
      let ss1 = SpreadsheetApp.openById(ROUTINE_SHEET_ID);
      let sheet1 = ss1.getSheetByName("Doer List");
      if (sheet1) {
        let lr = sheet1.getLastRow();
        if (lr > 1) {
            let data1 = sheet1.getRange(2, 1, lr - 1, 5).getValues();
            for (let i = 0; i < data1.length; i++) {
              if (String(data1[i][3]).trim() === inMob && String(data1[i][4]).trim() === inPass) {
                matchedName = String(data1[i][0]).trim();
                exactFullName = matchedName;
                dept = String(data1[i][1]).trim(); 
                found = true;
                break;
              }
            }
        }
      }
    } catch(e) {}

    let delegatedFound = false, delegatedName = "";
    try {
      const ss2 = SpreadsheetApp.openById(DELEGATED_SHEET_ID);
      const uSheet = ss2.getSheetByName('Users');
      if (uSheet) {
        let uData = _readBlock(uSheet, 2, 1, 4);
        for (let i = 0; i < uData.length; i++) {
          if (String(uData[i][0]).trim() === inMob && String(uData[i][1]).trim() === inPass) {
            delegatedName = uData[i][2] ? String(uData[i][2]).trim() : "";
            delegatedFound = true; 
            break;
          }
        }
      }
      if (!delegatedFound) {
        const dSheet = ss2.getSheetByName('Doer List');
        if (dSheet) {
          let dData = _readBlock(dSheet, 2, 1, 4);
          for (let j = 0; j < dData.length; j++) {
            if (String(dData[j][1]).trim() === inMob) {
              delegatedName = dData[j][3] ? String(dData[j][3]).trim() : String(dData[j][0]).trim();
              delegatedFound = true;
              if (dData[j][2] && dept === "") dept = String(dData[j][2]).trim(); 
              break;
            }
          }
        }
      }
    } catch(e) {}

    if (!found && !delegatedFound) return { success: false, message: "Invalid ID or Password!" };

    if (delegatedFound && delegatedName) {
        exactFullName = delegatedName;
        if (!matchedName) matchedName = delegatedName;
    }

    let role = 'staff';
    let deptUpper = String(dept).toUpperCase();
    if (deptUpper.includes('DRIVER') || deptUpper.includes('OPERATOR') || deptUpper.includes('DUMPER')) {
      role = 'driver';
    }

    var token = portalNewSession_({ u: inMob, n: matchedName, d: exactFullName, p: inMob, r: role === 'driver' ? 'DRIVER' : 'STAFF' }, 'legacy');
    return { success: true, name: matchedName, fullName: exactFullName, role: role, mobile: inMob, dept: dept, token: token };
  } catch (error) { 
    return { success: false, message: "Server error. Try again." }; 
  }
}

// ==========================================
// UI-1: DRIVER FUNCTIONS
// ==========================================
/** Page → the signed-in driver's tasks. Name and mobile come from the session, not the browser. */
function drv_getAllTasksForUser(token, userNameIgnored, userMobileIgnored, forceFresh) {
  var sess = tkSessionOrNull_(token);
  if (!sess) return { sessionExpired: true };
  return drv_getAllTasksForUser_(sess.name, sess.mobile, forceFresh);
}

function drv_getAllTasksForUser_(userName, userMobile, forceFresh) {
  if (forceFresh) _invalidate('routine');
  const searchName = String(userName || "").trim().toLowerCase();
  const searchNameClean = searchName.replace(/[^a-z0-9\u0900-\u097F]+/g, ''); 
  const mobClean = String(userMobile || "").replace(/\D/g, '');
  
  let result = { todayTasks: [], delegatedTasks: [], stats: { todayTotal: 0, delegatedTotal: 0 }, error: "" };
  const todayStr = Utilities.formatDate(new Date(), "Asia/Kolkata", "dd/MM/yyyy");

  const isNameMatch = (dbName) => {
    if (!dbName) return false;
    const d = String(dbName).trim().toLowerCase();
    if (mobClean !== "" && mobClean.length >= 10 && d.includes(mobClean)) return true;
    if (d === searchName) return true;
    const dClean = d.replace(/[^a-z0-9\u0900-\u097F]+/g, '');
    if (dClean === searchNameClean && searchNameClean !== "") return true;
    if (searchNameClean.length > 3 && dClean.includes(searchNameClean)) return true;
    if (dClean.length > 3 && searchNameClean.includes(dClean)) return true;
    return false;
  };

  try {
    let allData = _loadRoutine().master;
    let seenSignatures = new Set();
    for (let i = 0; i < allData.length; i++) {
      let tId = allData[i][3];
      if (!tId) continue; 
      if (isNameMatch(allData[i][0])) {
         let title = allData[i][5] || "Untitled Task";
         let freq = String(allData[i][4] || "NA").toUpperCase().trim();
         let dateObj = parseServerDate(allData[i][6]);
         let dateStr = dateObj ? Utilities.formatDate(dateObj, "Asia/Kolkata", "dd/MM/yyyy") : "No Date";
         let status = String(allData[i][8]).trim(); 
         let isDone = (status.toLowerCase() === "yes" || status.toLowerCase() === "no" || status.toLowerCase() === "done" || status.toLowerCase() === "completed"); 
         let staffRemark = allData[i][11] ? String(allData[i][11]) : "";

         if (!isDone && (dateStr === todayStr)) {
             let sig = title + "|" + dateStr;
             if(!seenSignatures.has(sig)){
               seenSignatures.add(sig);
               result.todayTasks.push({ taskId: tId, title: title, freq: freq, dueDate: dateStr, status: status, isToday: true, staffRemark: staffRemark });
               result.stats.todayTotal++;
             }
         }
      }
    }
  } catch(e) {}

  try {
      const delData = _loadDelegated().master || [];
      for (let j = 0; j < delData.length; j++) {
        if (isNameMatch(delData[j][2]) || isNameMatch(delData[j][18])) {
            let statusRaw = String(delData[j][9] || "pending").toLowerCase().trim(); 
            if (statusRaw !== "done" && statusRaw !== "completed" && statusRaw !== "rejected" && statusRaw !== "review") {
                result.delegatedTasks.push({ taskId: delData[j][1], title: delData[j][3] || "Untitled" });
            }
        }
      }
  } catch(e) {}

  return result;
}

// Optimized write function (No SpreadsheetApp.flush() ensures lightning fast locking)
function drv_updateTaskStatusInSheet(token, taskId, status, remarkText) {
  var sess = tkSessionOrNull_(token);
  if (!sess) return { success: false, expired: true, message: 'Your sign-in has ended. Please log in again.' };
  let lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch(e) {}
  try {
    let ss = SpreadsheetApp.openById(ROUTINE_SHEET_ID);
    let dateStr = Utilities.formatDate(new Date(), "Asia/Kolkata", "dd/MM/yyyy HH:mm:ss");
    
    let sheet = ss.getSheetByName("Monthly Master");
    if (!sheet) return { success: false, message: "Monthly Master not found" };
    
    let tf = sheet.getRange("D:D").createTextFinder(String(taskId).trim()).matchEntireCell(true).findNext();
    if (tf) {
        let rowNum = tf.getRow();
        let existingDate = sheet.getRange(rowNum, 8).getValue();
        if (!existingDate || String(existingDate).trim() === "") { sheet.getRange(rowNum, 8).setValue(dateStr); }
        sheet.getRange(rowNum, 9).setValue(status); 
        if (remarkText) sheet.getRange(rowNum, 12).setValue(remarkText);
        
        _invalidate('routine'); return { success: true };
    }
    
    return { success: false, message: "Task ID not found" };
  } catch(e) { return { success: false, message: e.message }; } finally { lock.releaseLock(); }
}

function drv_addRemarkToTask(token, taskId, remarkText) {
  var sess = tkSessionOrNull_(token);
  if (!sess) return { success: false, expired: true, message: 'Your sign-in has ended. Please log in again.' };
  let lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch(e) {}
  try {
    let ss = SpreadsheetApp.openById(ROUTINE_SHEET_ID);
    let sheet = ss.getSheetByName("Monthly Master");
    if (!sheet) return { success: false, message: "Monthly Master not found" };

    let tf = sheet.getRange("D:D").createTextFinder(String(taskId).trim()).matchEntireCell(true).findNext();
    if (tf) {
        let rowNum = tf.getRow();
        sheet.getRange(rowNum, 12).setValue(remarkText);
        _invalidate('routine'); return { success: true };
    }
    
    return { success: false, message: "Task ID not found" };
  } catch(e) { return { success: false, message: e.toString() }; } finally { lock.releaseLock(); }
}

// ==========================================
// TASK GENERATOR (High-Speed Pre-Computed)
// ==========================================
function drv_submitButtonClicked() {
  portalAssertEditor_();
  try {
    drv_createChecklist();
    SpreadsheetApp.getUi().alert("Success ✅", "Tasks generated correctly into the Master sheet.", SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (error) {
    SpreadsheetApp.getUi().alert("Error ❌", "An error occurred while syncing: " + error.message, SpreadsheetApp.getUi().ButtonSet.OK);
  }
}

function drv_createChecklist() {
  let lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw new Error("System is compiling. Please wait 15 seconds."); 
  
  try {
    let ss = SpreadsheetApp.openById(ROUTINE_SHEET_ID);
    let taskSheet = ss.getSheetByName("Task List");
    let masterSheet = ss.getSheetByName("Master");
    if (!taskSheet || !masterSheet) return;

    let taskData = taskSheet.getDataRange().getValues();
    let validTaskKeys = new Set(), rebuildTaskKeys = new Set(), tasksToGenerate = []; 

    for (let i = 1; i < taskData.length; i++) {
      let tTask = String(taskData[i][0]).trim(), tDoer = String(taskData[i][1]).trim(), tDept = String(taskData[i][2]).trim();
      let tFreq = String(taskData[i][3]).trim(), tDate = taskData[i][4], tStatus = String(taskData[i][5]).trim().toLowerCase();
      
      if (tTask !== "" && tDoer !== "") {
        let uKey = tTask.toLowerCase() + "|" + tDoer.toLowerCase() + "|" + tDept.toLowerCase() + "|" + tFreq.toLowerCase();
        validTaskKeys.add(uKey); 
        if (tStatus !== "sent") {
          rebuildTaskKeys.add(uKey); 
          tasksToGenerate.push({ rowIdx: i + 1, task: tTask, doer: tDoer, dept: tDept, freq: tFreq, date: tDate, key: uKey });
        }
      }
    }

    if (tasksToGenerate.length === 0 && rebuildTaskKeys.size === 0) return; 

    if (tasksToGenerate.length > 0) { ss.toast("Processing schedule for " + tasksToGenerate.length + " task(s)...", "Syncing", 4); }

    let colCount = 15;
    let masterData = masterSheet.getDataRange().getValues();
    let newData = [];
    let uniqueMap = new Map();
    let orphanedCount = 0;

    if (masterData.length > 0) {
      let headerRow = masterData[0].slice(0, colCount);
      while(headerRow.length < colCount) headerRow.push("");
      newData.push(headerRow); 

      for (let j = 1; j < masterData.length; j++) {
        let row = masterData[j];
        while(row.length < colCount) row.push("");

        let mDoer = String(row[0]).trim();
        let mDept = String(row[2]).trim();
        let mTask = String(row[5]).trim();
        let mFreq = String(row[4]).trim();
        let mStatus = String(row[8]).trim(); 
        if (mTask === "") { orphanedCount++; continue; }

        let mKey = mTask.toLowerCase() + "|" + mDoer.toLowerCase() + "|" + mDept.toLowerCase() + "|" + mFreq.toLowerCase();
        let keepRow = false;

        let isDone = (mStatus.toLowerCase() === "done" || mStatus.toLowerCase() === "completed" || mStatus.toLowerCase() === "yes" || mStatus.toLowerCase() === "no");

        if (isDone) { keepRow = true; } 
        else { if (validTaskKeys.has(mKey) && !rebuildTaskKeys.has(mKey)) keepRow = true; }

        if (keepRow) {
          let dObj = parseServerDate(row[6]);
          let dStr = dObj ? Utilities.formatDate(dObj, "Asia/Kolkata", "dd/MM/yyyy") : "nodate";
          let sig = mKey + "|" + dStr;
          
          if (!uniqueMap.has(sig)) { uniqueMap.set(sig, row.slice(0, colCount)); newData.push(row.slice(0, colCount)); } 
          else {
            let existing = uniqueMap.get(sig);
            if ((String(row[8]) !== "" || String(row[11]) !== "") && (String(existing[8]) === "" && String(existing[11]) === "")) { uniqueMap.set(sig, row.slice(0, colCount)); }
            orphanedCount++; 
          }
        } else { orphanedCount++; }
      }
    }

    let lastMasterTaskID = 0;
    for (let i = 1; i < newData.length; i++) { if (newData[i][3] && !isNaN(newData[i][3])) lastMasterTaskID = Math.max(lastMasterTaskID, Number(newData[i][3])); }

    let calendarSheet = ss.getSheetByName("Working Day Calender");
    let calLastRow = calendarSheet ? Math.max(calendarSheet.getLastRow(), 2) : 2;
    let calendarDates = calendarSheet ? calendarSheet.getRange(2, 1, calLastRow - 1, 1).getValues() : [];
    
    let workingTsSet = new Set();
    calendarDates.forEach(row => { let d = parseServerDate(row[0]); if (d) { d.setHours(0,0,0,0); workingTsSet.add(d.getTime()); } });

    let calendarFirstDate = new Date(); calendarFirstDate.setHours(0,0,0,0);
    let setupSheet = ss.getSheetByName("Setup Sheet");
    let skipSundays = setupSheet ? (setupSheet.getRange("B32").getValue() || "Yes") : "Yes";

    let daysToGenerate = 365; 
    let limitDateObj = new Date();
    limitDateObj.setHours(0,0,0,0);
    limitDateObj.setDate(limitDateObj.getDate() + daysToGenerate);
    
    let todayTime = new Date(); todayTime.setHours(0,0,0,0);

    let fastWorkMap = new Map();
    let cursor = new Date(calendarFirstDate);
    let lastValidTs = cursor.getTime();

    for(let i=0; i<800; i++) {
        let currentTs = cursor.getTime();
        if (workingTsSet.has(currentTs)) lastValidTs = currentTs;
        fastWorkMap.set(currentTs, lastValidTs);
        cursor.setDate(cursor.getDate() + 1);
    }

    function getFastWorkingDate(d) {
        d.setHours(0,0,0,0);
        let ts = d.getTime();
        if (fastWorkMap.has(ts)) return new Date(fastWorkMap.get(ts));
        return d;
    }

    function applyFastSundayLogic(theDate, skipSundays, theDepartment) {
        let d = new Date(theDate.getTime());
        if (skipSundays === "Yes" && d.getDay() === 0) {
            if (String(theDepartment).trim().toUpperCase() === "ACCOUNTS") { if (d.getDate() > 7) d.setDate(d.getDate() - 1); } 
            else { d.setDate(d.getDate() - 1); }
        }
        return d;
    }

    let appendedRows = []; 

    tasksToGenerate.forEach(t => {
      let theTask = t.task, theDoer = t.doer, theDepartment = t.dept, theFreq = t.freq;
      let theDate = parseServerDate(t.date); 
      if (!theDate) { theDate = new Date(); }
      theDate.setHours(0,0,0,0);

      let theEmail = getEmail(theDoer, theDepartment);
      let freqUpper = String(theFreq).trim().toUpperCase();

      let pushNewRow = (workingDateToPush) => {
        let wdTime = workingDateToPush.getTime();
        if (wdTime < todayTime.getTime() || wdTime > limitDateObj.getTime()) return; 

        let rowData = [
          theDoer, theEmail !== "FAILED" ? theEmail : "", theDepartment, ++lastMasterTaskID, 
          theFreq, theTask, new Date(workingDateToPush), "", "", "", "", "", "", "", ""
        ];
        
        let dStr = Utilities.formatDate(new Date(workingDateToPush), "Asia/Kolkata", "dd/MM/yyyy");
        let sig = t.key + "|" + dStr;
        
        if (!uniqueMap.has(sig)) { uniqueMap.set(sig, rowData); newData.push(rowData); appendedRows.push(rowData); }
      };
      
      if (freqUpper === "W" || freqUpper === "WEEKLY") {
        while (limitDateObj.getTime() >= theDate.getTime()) { pushNewRow(getFastWorkingDate(new Date(theDate.getTime()))); theDate.setDate(theDate.getDate() + 7); }
      } else if (freqUpper === "M" || freqUpper === "MONTHLY") {
        while (limitDateObj.getTime() >= theDate.getTime()) { let wd = getFastWorkingDate(new Date(theDate.getTime())); pushNewRow(applyFastSundayLogic(wd, skipSundays, theDepartment)); theDate = addMonthsSafe(theDate, 1); }
      } else if (freqUpper === "Y" || freqUpper === "YEARLY" || freqUpper === "YERLY" || freqUpper === "YEAR") {
        while (limitDateObj.getTime() >= theDate.getTime()) { let wd = getFastWorkingDate(new Date(theDate.getTime())); pushNewRow(applyFastSundayLogic(wd, skipSundays, theDepartment)); theDate = addMonthsSafe(theDate, 12); }
      } else if (freqUpper === "D" || freqUpper === "DAILY") {
        while (limitDateObj.getTime() >= theDate.getTime()) {
          let isValidDay = false;
          if (workingTsSet.has(theDate.getTime())) {
            if (skipSundays === "Yes" && theDate.getDay() === 0) { if (String(theDepartment).trim().toUpperCase() === "ACCOUNTS" && theDate.getDate() <= 7) isValidDay = true; } 
            else isValidDay = true;
          }
          if (isValidDay || workingTsSet.size === 0) pushNewRow(new Date(theDate.getTime()));
          theDate.setDate(theDate.getDate() + 1);
        }
      } else if (freqUpper === "Q" || freqUpper === "QUARTERLY" || freqUpper === "QUATERLY") {
        while (limitDateObj.getTime() >= theDate.getTime()) { let wd = getFastWorkingDate(new Date(theDate.getTime())); pushNewRow(applyFastSundayLogic(wd, skipSundays, theDepartment)); theDate = addMonthsSafe(theDate, 3); }
      } else if (freqUpper === "H" || freqUpper === "HY" || freqUpper === "HALF YEARLY" || freqUpper === "HALFYEARLY") {
        while (limitDateObj.getTime() >= theDate.getTime()) { let wd = getFastWorkingDate(new Date(theDate.getTime())); pushNewRow(applyFastSundayLogic(wd, skipSundays, theDepartment)); theDate = addMonthsSafe(theDate, 6); }
      } else if (freqUpper === "F" || freqUpper === "FORTNIGHTLY") {
        while (limitDateObj.getTime() >= theDate.getTime()) { pushNewRow(getFastWorkingDate(new Date(theDate.getTime()))); theDate.setDate(theDate.getDate() + 14); }
      } else { pushNewRow(theDate); }
      
      taskSheet.getRange(t.rowIdx, 6).setValue("Sent");
    });

    if (orphanedCount === 0 && appendedRows.length > 0 && masterData.length > 0) {
      let lastR = masterSheet.getLastRow(); masterSheet.getRange(lastR + 1, 1, appendedRows.length, colCount).setValues(appendedRows);
    } else if (newData.length > 0) {
      let numRowsData = newData.length; masterSheet.getRange(1, 1, numRowsData, colCount).setValues(newData);
      let lastR = masterSheet.getLastRow(); if (lastR > numRowsData) { masterSheet.getRange(numRowsData + 1, 1, lastR - numRowsData, colCount).clearContent(); }
    }
    
    _bumpVersion(); SpreadsheetApp.flush();
    syncMonthlyToMaster(false); 
    
  } finally { lock.releaseLock(); }
}

function cleanMasterSheets() {
  portalAssertEditor_();
  let ui = SpreadsheetApp.getUi();
  let response = ui.alert("Confirm Cleanup", "This will permanently remove pending tasks in Master that are no longer in the Task List, and remove any exact duplicates. Proceed?", ui.ButtonSet.YES_NO);
  if (response !== ui.Button.YES) return;

  try {
    let ss = SpreadsheetApp.getActiveSpreadsheet();
    let taskSheet = ss.getSheetByName("Task List");
    let masterSheet = ss.getSheetByName("Master");
    if (!taskSheet || !masterSheet) return;

    let taskData = taskSheet.getDataRange().getValues();
    let validKeys = new Set();
    for (let i = 1; i < taskData.length; i++) {
      let tTask = String(taskData[i][0]).trim(); let tDoer = String(taskData[i][1]).trim(); let tDept = String(taskData[i][2]).trim();
      if (tTask !== "" && tDoer !== "") validKeys.add(tTask + "|" + tDoer + "|" + tDept);
    }

    let masterData = masterSheet.getDataRange().getValues();
    if (masterData.length < 2) return;

    let colCount = masterData[0].length;
    let cleanData = [masterData[0]];
    let uniqueRowTracker = new Set();
    let removedCount = 0;

    for (let i = 1; i < masterData.length; i++) {
      let mDoer = String(masterData[i][0]).trim(), mDept = String(masterData[i][2]).trim(), mTask = String(masterData[i][5]).trim();
      let mPlannedStr = (masterData[i][6] instanceof Date) ? masterData[i][6].getTime() : String(masterData[i][6]).trim();
      let mStatus = String(masterData[i][8]).trim();
      
      let mKey = mTask + "|" + mDoer + "|" + mDept;
      let rowFingerprint = mKey + "|" + mPlannedStr; 

      let isDone = (mStatus.toLowerCase() === "done" || mStatus.toLowerCase() === "completed" || mStatus.toLowerCase() === "yes" || mStatus.toLowerCase() === "no");

      if (isDone) { cleanData.push(masterData[i]); } 
      else {
        if (validKeys.has(mKey)) {
          if (!uniqueRowTracker.has(rowFingerprint)) { uniqueRowTracker.add(rowFingerprint); cleanData.push(masterData[i]); } 
          else { removedCount++; }
        } else { removedCount++; }
      }
    }

    masterSheet.getRange(1, 1, masterSheet.getMaxRows(), colCount).clearContent();
    masterSheet.getRange(1, 1, cleanData.length, colCount).setValues(cleanData);
    
    syncMonthlyToMaster(false);
    ui.alert("Cleanup Complete 🧹", "Successfully removed " + removedCount + " invalid/duplicate rows.", ui.ButtonSet.OK);

  } catch (error) { ui.alert("Error ❌", error.message, ui.ButtonSet.OK); }
}

// ==========================================
// UI-2: ADVANCED STAFF FUNCTIONS
// ==========================================
function _loadDelegated() {
  const hit = _cacheGet(K_DEL);
  if (hit) return hit;
  const out = { master: [], staff: [], doers: [] };
  try {
    const ss = SpreadsheetApp.openById(DELEGATED_SHEET_ID);
    const m = ss.getSheetByName('Master');
    if (m) out.master = _readBlock(m, 2, 1, 20); 
    const u = ss.getSheetByName('Users');
    if (u) out.staff = _readBlock(u, 2, 3, 1).map(r => r[0] ? String(r[0]).trim() : '');
    const d = ss.getSheetByName('Doer List');
    if (d) out.doers = _readBlock(d, 2, 4, 1).map(r => r[0] ? String(r[0]).trim() : '');
  } catch (e) { return out; }
  _cachePut(K_DEL, out, SHEET_CACHE_TTL);
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

function _invalidate(which) {
  if (which === 'routine'   || which === 'all') _cacheDrop(K_ROU);
  if (which === 'delegated' || which === 'all') _cacheDrop(K_DEL);
  _bumpVersion(); 
}

function _uploadFiles(fileDataArray) {
  let urls = [];
  if (!fileDataArray || !fileDataArray.length) return "";
  let folder;
  try { folder = DriveApp.getFolderById(DRIVE_FOLDER_ID); } catch(e) { return "ERR: Drive Folder not found."; }

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
      try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch(shareErr) {}
      urls.push(file.getUrl());
    } catch (e) { return "ERR: File error: " + e.message; }
  }
  return urls.join(', ');
}

// ------------------------------------------
// MAGIC MATCHING (By Mobile Number & Text)
// ------------------------------------------
/** Page → the signed-in staff member's tasks. Name and mobile come from the session, not the browser. */
function stf_getAllTasksForUser(token, userNameIgnored, userMobileIgnored, forceFresh) {
  var sess = tkSessionOrNull_(token);
  if (!sess) return { sessionExpired: true };
  return stf_getAllTasksForUser_(sess.name, sess.mobile, forceFresh);
}

function stf_getAllTasksForUser_(userName, userMobile, forceFresh) {
  const searchName = String(userName || "").trim().toLowerCase();
  const searchNameClean = searchName.replace(/[^a-z0-9\u0900-\u097F]+/g, ''); 
  const mobClean = String(userMobile || "").replace(/\D/g, '');
  
  if (forceFresh === true) { _invalidate('all'); }

  const uKey = 'GGM_UR|' + searchNameClean + '|' + mobClean + '|' + _getVersion();
  if (forceFresh !== true) {
    const cachedRes = _cacheGet(uKey);
    if (cachedRes) return cachedRes;
  }

  let result = { routineTasks: [], delegatedTasks: [], staffList: [], stats: { routineWeeklyTotal: 0, routineWeeklyDone: 0, routineMonthlyTotal: 0, routineMonthlyDone: 0, delegatedWeeklyTotal: 0, delegatedWeeklyDone: 0, delegatedMonthlyTotal: 0, delegatedMonthlyDone: 0, dailyScore: "0%", monthlyScore: "0" }, exactFullName: userName, error: "" };
  
  const today = new Date(), todayStr = getFastDateStr(today), currentMonth = today.getMonth(), currentYear = today.getFullYear();
  let currentWeekStart = new Date(today), day = currentWeekStart.getDay(); 
  currentWeekStart.setDate(currentWeekStart.getDate() - day + (day == 0 ? -6:1)); 
  currentWeekStart.setHours(0,0,0,0);
  const weekStartMs = currentWeekStart.getTime();
  
  let currentWeekEnd = new Date(currentWeekStart); 
  currentWeekEnd.setDate(currentWeekStart.getDate() + 6); 
  currentWeekEnd.setHours(23,59,59,999);
  const weekEndMs = currentWeekEnd.getTime();

  const isNameMatch = (dbName) => {
    if (!dbName) return false;
    const d = String(dbName).trim().toLowerCase();
    
    if (mobClean !== "" && mobClean.length >= 10 && d.includes(mobClean)) return true;
    if (d === searchName) return true;
    
    const dClean = d.replace(/[^a-z0-9\u0900-\u097F]+/g, '');
    if (dClean === searchNameClean && searchNameClean !== "") return true;
    if (searchNameClean.length > 3 && dClean.includes(searchNameClean)) return true;
    if (dClean.length > 3 && searchNameClean.includes(dClean)) return true;
    
    return false;
  };

  try {
      const rouData = _loadRoutine();
      const data = rouData.master;
      for (let i = 0; i < data.length; i++) {
        if (!data[i][0] || !isNameMatch(data[i][0])) continue; 
        
        let tId = data[i][3] ? String(data[i][3]).trim() : ("ROW_" + (i + 2)); 
        let staffRemark = data[i][11] ? String(data[i][11]).trim() : (data[i][14] ? String(data[i][14]).trim() : ""); 
        let staffFileUrl = data[i][12] ? String(data[i][12]).trim() : "";
        let rawStatus = data[i][8] ? String(data[i][8]).trim().toLowerCase() : "";
        
        let mappedStatus = 'pending';
        if (rawStatus === 'done' || rawStatus === 'completed' || rawStatus === 'yes' || rawStatus === 'no') mappedStatus = 'completed';
        else if (rawStatus === 'review') mappedStatus = 'review';
        else if (String(data[i][7]).trim() !== "") mappedStatus = 'completed'; 
        
        let dateObj = parseServerDate(data[i][6]), isDone = (mappedStatus === 'completed');
        let taskTimeMs = dateObj ? dateObj.getTime() : 0, taskMonth = dateObj ? dateObj.getMonth() : -1, taskYear = dateObj ? dateObj.getFullYear() : -1;
        
        let dateStr = dateObj ? getFastDateStr(dateObj) : "No Date";
        let actualDateRaw = data[i][7], actualDateObj = _asDate(actualDateRaw);
        let actualDateStr = actualDateObj ? getFastDateTimeStr(actualDateObj) : (actualDateRaw ? String(actualDateRaw) : "");
        let isToday = (dateStr === todayStr), freqClean = String(data[i][4] || "NA").toUpperCase().trim(), isDaily = (freqClean === "D" || freqClean === "DAILY");

        if (taskMonth === currentMonth && taskYear === currentYear) {
            result.stats.routineMonthlyTotal++; 
            if(isDone) result.stats.routineMonthlyDone++;
            if(taskTimeMs >= weekStartMs && taskTimeMs <= weekEndMs) { result.stats.routineWeeklyTotal++; if(isDone) result.stats.routineWeeklyDone++; }
        }
        
        let shouldSendToClient = false;
        if (!dateObj) { shouldSendToClient = !isDone; } 
        else if (isDone) { if ((taskMonth === currentMonth && taskYear === currentYear) || isToday) shouldSendToClient = true; } 
        else { shouldSendToClient = true; }

        if (shouldSendToClient || mappedStatus === 'review') {
            result.routineTasks.push({ taskId: tId, title: data[i][5] || "Untitled task", freq: freqClean, isDaily: isDaily, dueDate: dateStr, actualDate: actualDateStr, status: mappedStatus, isToday: isToday, staffRemark: staffRemark, staffFileUrl: staffFileUrl, type: 'routine' });
        }
      }

      // SUMMARY SCORES
      const sumData = rouData.summary;
      if (sumData && sumData.length > 1) {
          const headers = sumData[1];
          const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
          const currentMonthStr = monthNames[currentMonth] + " " + currentYear;

          let monthColIndex = -1;
          for (let c = 4; c < headers.length; c++) {
              let hStr = String(headers[c]).trim();
              if (hStr.includes(currentMonthStr) || hStr.includes(monthNames[currentMonth])) {
                  monthColIndex = c;
                  break;
              }
          }

          for (let r = 2; r < sumData.length; r++) {
              if (!sumData[r][2]) continue;
              if (isNameMatch(sumData[r][2])) {
                  let rawDaily = sumData[r][3];
                  if (rawDaily !== "" && rawDaily != null) {
                      if (typeof rawDaily === 'number') {
                          if(rawDaily <= 1 && rawDaily >= -1) { result.stats.dailyScore = Math.round(rawDaily * 100) + "%"; } 
                          else { result.stats.dailyScore = rawDaily + "%"; }
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
  } catch(e) {}

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
        let transferToName = data[i][18] ? String(data[i][18]).trim() : ""; 
        let isOwner = isNameMatch(ownerName);
        let isTransferTarget = isNameMatch(transferToName);

        if (!isOwner && !isTransferTarget) continue; 
        
        let tId = data[i][1] ? String(data[i][1]).trim() : ("ROW_" + (i + 2)); 
        let title = data[i][3] ? data[i][3].toString().trim() : "No title"; 
        
        let statusRaw = data[i][9] ? data[i][9].toString().trim().toLowerCase() : "pending"; 
        let givenBy = data[i][10] ? data[i][10].toString().trim() : ""; 
        let photoLink = data[i][11] ? data[i][11].toString().trim() : ""; 
        let remark = data[i][13] ? data[i][13].toString().trim() : ""; 
        let staffRemark = data[i][14] ? String(data[i][14]).trim() : ""; 
        let staffFileUrl = data[i][15] ? data[i][15].toString().trim() : ""; 
        let extraNote = data[i][16] ? data[i][16].toString().trim() : ""; 
        
        let rawDate = data[i][4], dateObj = parseServerDate(rawDate), dueDate = dateObj ? getFastDateStr(dateObj) : "No Date"; 
        let actualDateRaw = data[i][7], actualDateObj = _asDate(actualDateRaw), actualDateStr = actualDateObj ? getFastDateTimeStr(actualDateObj) : (actualDateRaw ? String(actualDateRaw) : ""); 
        let approvalDateRaw = data[i][17], approvalDateObj = _asDate(approvalDateRaw), approvalDateStr = approvalDateObj ? getFastDateTimeStr(approvalDateObj) : (approvalDateRaw ? String(approvalDateRaw) : "");

        let isToday = (dueDate === todayStr), mappedStatus = 'pending';
        if(statusRaw === 'review') mappedStatus = 'review'; 
        else if(statusRaw === 'rejected') mappedStatus = 'rejected'; 
        else if(statusRaw === 'done' || statusRaw === 'completed') mappedStatus = 'completed';

        let tStatus = 'none';
        if (transferToName && (mappedStatus === 'pending' || mappedStatus === 'rejected')) {
            if (isOwner && !isTransferTarget) tStatus = 'outgoing';
            if (!isOwner && isTransferTarget) tStatus = 'incoming';
        }

        if (isOwner && dateObj) {
            let taskTimeMs = dateObj.getTime(), taskMonth = dateObj.getMonth(), taskYear = dateObj.getFullYear();
            if (taskMonth === currentMonth && taskYear === currentYear) {
                  result.stats.delegatedMonthlyTotal++; if(mappedStatus === 'completed') result.stats.delegatedMonthlyDone++;
                  if(taskTimeMs >= weekStartMs && taskTimeMs <= weekEndMs) { result.stats.delegatedWeeklyTotal++; if(mappedStatus === 'completed') result.stats.delegatedWeeklyDone++; }
            }
        }

        result.delegatedTasks.push({ 
            taskId: tId, title: title, dueDate: dueDate, actualDate: actualDateStr, approvalDate: approvalDateStr, status: mappedStatus, 
            givenBy: givenBy, remark: remark, staffRemark: staffRemark, extraNote: extraNote, photoLink: photoLink, staffFileUrl: staffFileUrl,
            isToday: isToday, type: 'delegated', transferStatus: tStatus, transferTo: transferToName, originalOwner: ownerName
        });
      }
  } catch(e) {}

  _cachePut(uKey, result, USER_CACHE_TTL);
  return result;
}

// Highly optimized write (No SpreadsheetApp.flush() for lightning speed concurrency)
function stf_addRemarkToTask(token, taskId, remarkText, type, fileDataArray, isJustNote, isSelf) {
  var sess = tkSessionOrNull_(token);
  if (!sess) return { success: false, expired: true, message: 'Your sign-in has ended. Please log in again.' };
  let lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch(e) {}
  try {
    let exactTime = new Date(), searchId = String(taskId).trim().toUpperCase();
    let finalFileStr = _uploadFiles(fileDataArray);
    if (finalFileStr.startsWith("ERR:")) return { success: false, message: finalFileStr };

    let dateStr = Utilities.formatDate(exactTime, "Asia/Kolkata", "dd/MM/yyyy HH:mm:ss");

    if (type === 'delegated') {
        const sheet = SpreadsheetApp.openById(DELEGATED_SHEET_ID).getSheetByName('Master');
        let tf = sheet.getRange("B:B").createTextFinder(searchId).matchEntireCell(true).findNext();
        if (tf) {
            let row = tf.getRow();
            if (!isJustNote) {
                let existingTs = sheet.getRange(row, 8).getValue(); 
                if(!existingTs || String(existingTs).trim() === "") sheet.getRange(row, 8).setValue(dateStr); 
                
                let targetStatus = (isSelf === true) ? "Completed" : "Review";
                sheet.getRange(row, 10).setValue(targetStatus); 
            }
            if (remarkText !== undefined && remarkText !== "") sheet.getRange(row, 15).setValue(remarkText); 
            if (finalFileStr) sheet.getRange(row, 16).setValue(finalFileStr); 
            _invalidate('delegated'); 
            return { success: true, fileUrl: finalFileStr };
        }
    } else if (type === 'routine') {
        const ss = SpreadsheetApp.openById(ROUTINE_SHEET_ID);
        const mmSheet = ss.getSheetByName('Monthly Master');
        if (mmSheet) {
            let tf = mmSheet.getRange("D:D").createTextFinder(searchId).matchEntireCell(true).findNext();
            if (tf) {
                let row = tf.getRow();
                if (!isJustNote) {
                    let existingTs = mmSheet.getRange(row, 8).getValue(); 
                    if(!existingTs || String(existingTs).trim() === "") mmSheet.getRange(row, 8).setValue(dateStr); 
                    mmSheet.getRange(row, 9).setValue("Done"); 
                }
                if (remarkText !== undefined && remarkText !== "") mmSheet.getRange(row, 12).setValue(remarkText); 
                if (finalFileStr) mmSheet.getRange(row, 13).setValue(finalFileStr); 
                
                _invalidate('routine'); return { success: true, fileUrl: finalFileStr };
            }
        }
        
        const mSheet = ss.getSheetByName('Master');
        if (mSheet) {
            let tf = mSheet.getRange("D:D").createTextFinder(searchId).matchEntireCell(true).findNext();
            if (tf) {
                let row = tf.getRow();
                if (!isJustNote) {
                    let existingTs = mSheet.getRange(row, 8).getValue();
                    if(!existingTs || String(existingTs).trim() === "") mSheet.getRange(row, 8).setValue(dateStr); 
                    mSheet.getRange(row, 9).setValue("Done"); 
                }
                if (remarkText !== undefined && remarkText !== "") mSheet.getRange(row, 12).setValue(remarkText); 
                if (finalFileStr) mSheet.getRange(row, 13).setValue(finalFileStr);
                
                _invalidate('routine'); return { success: true, fileUrl: finalFileStr };
            }
        }
    }
    return { success: false, message: "Task ID not found." };
  } catch(e) { return { success: false, message: e.toString() }; } finally { lock.releaseLock(); }
}

function requestTransfer(token, taskId, targetNameExact) {
  var sess = tkSessionOrNull_(token);
  if (!sess) return { success: false, expired: true, message: 'Your sign-in has ended. Please log in again.' };
  let lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch(e) {}
  try {
    const sheet = SpreadsheetApp.openById(DELEGATED_SHEET_ID).getSheetByName('Master');
    let searchId = String(taskId).trim().toUpperCase();
    let tf = sheet.getRange("B:B").createTextFinder(searchId).matchEntireCell(true).findNext();
    if (tf) {
        sheet.getRange(tf.getRow(), 19).setValue(targetNameExact); 
        _invalidate('delegated'); return { success: true };
    }
    return { success: false, message: "Task ID not found." };
  } catch (e) { return { success: false, message: e.toString() }; } finally { lock.releaseLock(); }
}

function processTransferResponse(token, taskId, action, currentUserNameExact) {
  var sess = tkSessionOrNull_(token);
  if (!sess) return { success: false, expired: true, message: 'Your sign-in has ended. Please log in again.' };
  currentUserNameExact = sess.full;          // always the signed-in person
  let lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch(e) {}
  try {
    const sheet = SpreadsheetApp.openById(DELEGATED_SHEET_ID).getSheetByName('Master');
    let searchId = String(taskId).trim().toUpperCase();
    let tf = sheet.getRange("B:B").createTextFinder(searchId).matchEntireCell(true).findNext();
    if (tf) {
        let row = tf.getRow();
        if (action === 'accept') {
            sheet.getRange(row, 3).setValue(currentUserNameExact); 
            sheet.getRange(row, 19).setValue(""); 
        } else if (action === 'reject' || action === 'cancel') {
            sheet.getRange(row, 19).setValue(""); 
        }
        _invalidate('delegated'); return { success: true };
    }
    return { success: false, message: "Task not found." };
  } catch (e) { return { success: false, message: e.toString() }; } finally { lock.releaseLock(); }
}

function createSelfTask(token, userNameExact, taskTitle, dueDateStr) {
  var sess = tkSessionOrNull_(token);
  if (!sess) return { success: false, expired: true, message: 'Your sign-in has ended. Please log in again.' };
  userNameExact = sess.full;                 // always the signed-in person
  let lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch(e) {}
  try {
    const ss = SpreadsheetApp.openById(DELEGATED_SHEET_ID);
    const sheet = ss.getSheetByName('Master');
    if (!sheet) return { success: false, message: "Master sheet not found." };

    const now = new Date();
    let nextNumber = 1; 
    
    const lr = sheet.getLastRow();
    if (lr > 1) {
        const ids = sheet.getRange(2, 2, lr - 1, 1).getValues();
        let maxNum = 0;
        for (let i = 0; i < ids.length; i++) {
            const val = String(ids[i][0] || "").trim();
            const match = val.match(/^TK-(\d+)$/i); 
            if (match && match[1]) {
                const num = parseInt(match[1], 10);
                if (num > maxNum) maxNum = num;
            }
        }
        if (maxNum > 0) nextNumber = maxNum + 1;
    }
    
    const paddedNumber = nextNumber.toString().padStart(3, '0');
    const newId = "TK-" + paddedNumber;

    let targetDate = now; 
    if (dueDateStr) {
        let parts = dueDateStr.split('-');
        if (parts.length === 3) targetDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), now.getHours(), now.getMinutes());
    }

    const newRow = [
      now,            // A 
      newId,          // B 
      userNameExact,  // C 
      taskTitle,      // D 
      targetDate,     // E 
      "", "", "", "", // F, G, H, I
      "Pending",      // J
      "Self",         // K 
      "", "", "", "", "", "", "", "", "" // L to T
    ];

    sheet.appendRow(newRow);
    _invalidate('delegated');
    return { success: true, taskId: newId };

  } catch (error) { return { success: false, message: error.toString() }; } finally { lock.releaseLock(); }
}

// ==========================================
// 🛠️ ADDITIONAL SHEET UTILITY FUNCTIONS
// ==========================================
function getEmail(theName, theDepartment) {
  try { 
    let ss = SpreadsheetApp.openById(ROUTINE_SHEET_ID);
    let sheet = ss.getSheetByName("Doer List");
    if(!sheet) return "";
    let data = sheet.getDataRange().getValues();
    let n = String(theName).trim().toLowerCase();
    let d = String(theDepartment).trim().toLowerCase();
    for(let i=1; i<data.length; i++) {
       if(String(data[i][0]).trim().toLowerCase() === n && String(data[i][1]).trim().toLowerCase() === d) return String(data[i][2]).trim();
    }
    for(let i=1; i<data.length; i++) {
       if(String(data[i][0]).trim().toLowerCase() === n) return String(data[i][2]).trim();
    }
    return "";
  } catch (e) { return ""; }
}

function addMonthsSafe(dateObj, monthsToAdd) {
  let d = new Date(dateObj.getTime());
  let expectedMonth = (d.getMonth() + monthsToAdd) % 12;
  if (expectedMonth < 0) expectedMonth += 12;
  d.setMonth(d.getMonth() + monthsToAdd);
  if (d.getMonth() !== expectedMonth) d.setDate(0); 
  return d;
}

function getDayInfo(arg){ return ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][arg]; }

function showAssignBuddyDialog() {
  portalAssertEditor_();
  var html = HtmlService.createHtmlOutputFromFile('AssignBuddyDialog').setWidth(460).setHeight(380);
  SpreadsheetApp.getUi().showModalDialog(html, 'Assign Buddy');
}

function setTrigger() {
  portalAssertEditor_();
  removeTrigger();
  var time = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Setup Sheet").getRange("C15").getValue();
  createTrigger(time);
}

function createTrigger(time) {
  portalAssertEditor_();
  if (!time) time = 10;
  ScriptApp.newTrigger('sendReminder').timeBased().everyDays(1).atHour(time).create();
}

function removeTrigger() {
  portalAssertEditor_();
  var allTriggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < allTriggers.length; i++) {
    if (allTriggers[i].getHandlerFunction() === 'sendReminder') ScriptApp.deleteTrigger(allTriggers[i]); 
  }
}

function getLastRowSpecial(range) {
  var rowNum = 0, blank = false;
  for (var row = 0; row < range.length; row++) {
    if (range[row][0] === "" && !blank) { rowNum = row; blank = true; } else if (range[row][0] !== "") blank = false;
  }
  return rowNum;
}

function sendReminder() {
  var forBsh = SpreadsheetApp.getActive().getSheetByName("Doer List");
  var dataB = forBsh.getRange(1, 3, forBsh.getLastRow(), 1).getValues();
  var tomorrow = new Date((new Date().setHours(0, 0, 0, 0)).valueOf() + 1000 * 3600 * 24);
  var sheet = SpreadsheetApp.getActive().getSheetByName("Master");
  var data = sheet.getRange(2, 1, getLastRowSpecial(sheet.getRange("B:B").getValues()) - 1, 8).getValues();
  dataB.filter(function(r){
    let reminderTasks = [];
    data.filter(function(pending){
      let doeremail = pending[1], lastDate = parseServerDate(pending[6]), actual = pending[7], name = pending[0], task = pending[5];
      if (lastDate && r[0] === doeremail && lastDate.valueOf() === tomorrow.valueOf() && !actual) reminderTasks.push([name,task]);
    })
    if (reminderTasks.length > 0){
      let joinedTasks = reminderTasks.map(function(tasks){ return "Task : "+tasks[1] }).join("\n")
      let dataToSend = "Hello "+reminderTasks[0][0]+",\n\nYou have planned tasks pending for tomorrow.\n\n"+joinedTasks+"\n\nPlease ignore this message if you have already completed the tasks."
      GmailApp.sendEmail(r[0], "You have Pending Tasks for tomorrow", dataToSend);
    }
  })
}

function updateChecklistNotes() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(); var chkSheet = ss.getSheetByName("Checklist"); var masterSheet = ss.getSheetByName("Master");
  if (!chkSheet || !masterSheet) return;
  var lastRow = chkSheet.getLastRow(); if (lastRow < 5) return; 
  var topRows = chkSheet.getRange(1, 1, 2, 34).getValues(); var yearVal = "", monthVal = "", empVal = "";
  for (var c = 0; c < 34; c++) {
    var header = String(topRows[0][c]).toUpperCase().trim();
    if (header === "YEAR") yearVal = topRows[1][c]; if (header === "MONTH") monthVal = topRows[1][c]; if (header === "EMPLOYEE") empVal = topRows[1][c];
  }
  if (!yearVal || !monthVal || !empVal) return;
  var yNum = parseInt(yearVal); if (typeof yearVal === 'object' && yearVal.getFullYear) yNum = yearVal.getFullYear();
  var monthIndex = -1;
  if (typeof monthVal === 'object' && monthVal.getMonth) monthIndex = monthVal.getMonth();
  else {
    var monthStr = String(monthVal).trim().toLowerCase(); var months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    for (var m = 0; m < 12; m++) if (monthStr.indexOf(months[m]) === 0) { monthIndex = m; break; }
    if (monthIndex === -1) { var mNum = parseInt(monthStr); if (!isNaN(mNum) && mNum >= 1 && mNum <= 12) monthIndex = mNum - 1; }
  }
  if (isNaN(yNum) || monthIndex === -1) return;
  var gridRange = chkSheet.getRange(5, 4, lastRow - 4, 31); var gridValues = gridRange.getValues(); var tasks = chkSheet.getRange(5, 2, lastRow - 4, 1).getValues(); var masterData = masterSheet.getDataRange().getValues();
  var completedTasksByDay = {};
  function cleanStr(str) { return String(str).toLowerCase().replace(/[^a-z0-9]/g, ''); }
  var empValClean = cleanStr(empVal);
  for (var i = 1; i < masterData.length; i++) {
    var status = String(masterData[i][8]).trim().toLowerCase(); if (status !== "done" && status !== "completed" && status !== "yes" && status !== "no") continue; 
    var doer = cleanStr(masterData[i][0]); if (doer !== empValClean) continue; 
    var plannedDateObj = parseServerDate(masterData[i][6]); var actualDateObj = parseServerDate(masterData[i][7]); 
    if (!plannedDateObj) continue;
    var pYear = parseInt(Utilities.formatDate(plannedDateObj, "Asia/Kolkata", "yyyy")); var pMonth = parseInt(Utilities.formatDate(plannedDateObj, "Asia/Kolkata", "MM")) - 1;
    if (pYear === yNum && pMonth === monthIndex) {
      var taskName = cleanStr(masterData[i][5]); if (!taskName) continue;
      var formattedTime = ""; var pDay = parseInt(Utilities.formatDate(plannedDateObj, "Asia/Kolkata", "d"));
      if (actualDateObj) formattedTime = Utilities.formatDate(actualDateObj, "Asia/Kolkata", "dd-MM-yyyy hh:mm:ss a"); else formattedTime = Utilities.formatDate(plannedDateObj, "Asia/Kolkata", "dd-MM-yyyy") + " (Exact time not recorded)";
      if (!completedTasksByDay[pDay]) completedTasksByDay[pDay] = []; completedTasksByDay[pDay].push({ task: taskName, time: formattedTime });
      if (actualDateObj) {
        var aDay = parseInt(Utilities.formatDate(actualDateObj, "Asia/Kolkata", "d")); var aMonth = parseInt(Utilities.formatDate(actualDateObj, "Asia/Kolkata", "MM")) - 1; var aYear = parseInt(Utilities.formatDate(actualDateObj, "Asia/Kolkata", "yyyy"));
        if (aYear === yNum && aMonth === monthIndex && aDay !== pDay) { if (!completedTasksByDay[aDay]) completedTasksByDay[aDay] = []; completedTasksByDay[aDay].push({ task: taskName, time: formattedTime }); }
      }
    }
  }
  var notesArray = [];
  for (var r = 0; r < tasks.length; r++) {
    var rowNotes = []; var tName = cleanStr(tasks[r][0]);
    for (var d = 1; d <= 31; d++) {
      var cellVal = String(gridValues[r][d - 1]).trim().toLowerCase();
      var isTick = (cellVal.indexOf("✅") !== -1 || cellVal.indexOf("true") !== -1 || cellVal.indexOf("✓") !== -1 || cellVal.indexOf("✔") !== -1 || cellVal.indexOf("☑️") !== -1);
      if (isTick) {
        var dayTasks = completedTasksByDay[d] || []; var matchedTime = null;
        for (var dt = 0; dt < dayTasks.length; dt++) { if (dayTasks[dt].task.indexOf(tName) !== -1 || tName.indexOf(dayTasks[dt].task) !== -1) { matchedTime = dayTasks[dt].time; break; } }
        if (matchedTime) rowNotes.push("Task Done On:\n" + matchedTime); else rowNotes.push("Task Done\n(Time missing in Master sheet)");
      } else rowNotes.push(null); 
    }
    notesArray.push(rowNotes);
  }
  gridRange.setNotes(notesArray);
}