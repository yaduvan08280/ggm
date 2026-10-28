/** 
 * NEWAI TASKS BACKEND - FULL & COMPLETE (ENTERPRISE GRADE)
 * Fixes Applied:
 * 1. Targeted Cell Updates: Solves the infinite loading bug on large sheets (26k+ rows).
 * 2. Rapid Batch Processing Engine implemented.
 * 3. Fallback logic rewritten for lightning-fast matching.
 * 4. MM Sheet Integration (Reads & Writes exclusively to 'MM' for extreme speed).
 * 5. EXACT MATCHING everywhere (Display + Fallback Save) to completely prevent cross-staff data overwrites.
 * 6. Nightly Auto-Sync to Master & Monthly Rollover added.
 * 7. Force Sync Missing Tasks added with exact formatting and matching.
 */

const DELEGATED_SHEET_ID = '1tEUckPww1GiD-PgP7yxMxt70W1Q-ueoUGXdI8_-Aq8A'; 
const DRIVE_FOLDER_ID    = '1E0_XYKcJjjRa1eBB_ju6H4qip58w9wIS';

const SHEET_CACHE_TTL = 30;   
const USER_CACHE_TTL  = 15;   
const CHUNK_SIZE      = 90000;
const K_DEL = 'NEWAI_DEL_V5';
const K_ROU = 'NEWAI_ROU_V5';

function _cache() { return CacheService.getScriptCache(); }

function _getVersion() {
  try {
    const c = _cache();
    let v = c.get('NEWAI_DV');
    if (!v) { v = String(Date.now()); c.put('NEWAI_DV', v, 21600); }
    return v;
  } catch (e) { return '0'; }
}

function _bumpVersion() { 
  try { _cache().put('NEWAI_DV', String(Date.now()), 21600); } catch (e) {} 
}

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
  const out = { master: [] };
  try {
    const ss = SpreadsheetApp.openById(DELEGATED_SHEET_ID);
    const m = ss.getSheetByName('Master');
    if (m && m.getLastRow() > 1) {
       out.master = _readBlock(m, 2, 1, 20);
    }
  } catch (e) {}
  _cachePut(K_DEL, out, SHEET_CACHE_TTL);
  return out;
}

function _loadRoutine() {
  const hit = _cacheGet(K_ROU);
  if (hit) return hit;
  const out = { master: [], summary: [] };
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let m = ss.getSheetByName('MM'); // FETCH FROM FAST MM SHEET NOW
    if (m && m.getLastRow() > 1) {
       out.master = _readBlock(m, 2, 1, 12);
    } else {
       let ms = ss.getSheetByName('Master');
       if (ms && ms.getLastRow() > 1) {
           out.master = _readBlock(ms, 2, 1, 12);
       }
    }
    let s = ss.getSheetByName('SUMMARY');
    if (s && s.getLastRow() > 1) {
       out.summary = _readBlock(s, 1, 1, 30);
    }
  } catch (e) {}
  _cachePut(K_ROU, out, SHEET_CACHE_TTL);
  return out;
}

function _invalidate(which) {
  if (which === 'routine'   || which === 'all') _cacheDrop(K_ROU);
  if (which === 'delegated' || which === 'all') _cacheDrop(K_DEL);
  _bumpVersion(); 
}

function _findTargetRow(sheet, type, searchId, qTitle, qDoer, qDate, tz) {
  let lr = sheet.getLastRow();
  if (lr < 2) return -1;
  let idCol = type === 'delegated' ? 2 : 4;
  
  if (!searchId.startsWith("ROW_")) {
    const ids = sheet.getRange(2, idCol, lr - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (ids[i][0] && String(ids[i][0]).trim().toUpperCase() === searchId) return i + 2;
    }
  }
  
  let maxCols = type === 'delegated' ? 10 : 9;
  let data = sheet.getRange(2, 1, lr - 1, maxCols).getValues();
  
  function _cln(str) { return String(str).toUpperCase().replace(/^NEWAI\s*-\s*/, '').replace(/\(.*?\)/g, '').trim(); }
  let cleanQDoer = qDoer ? _cln(qDoer) : "";

  for (let r = 0; r < data.length; r++) {
    let cellStatus = String(type === 'delegated' ? data[r][9] : data[r][8]).trim().toLowerCase();
    if (cellStatus === "review" || cellStatus === "done" || cellStatus === "completed") continue;
    
    let cellTitle = String(type === 'delegated' ? data[r][3] : data[r][5]).trim().toUpperCase();
    if (cellTitle !== qTitle) continue;
    
    let cellDoer = String(type === 'delegated' ? data[r][2] : data[r][0]);
    let cleanCellDoer = _cln(cellDoer);
    
    if (cleanQDoer && cleanCellDoer !== cleanQDoer) continue;
    
    let rawD = type === 'delegated' ? data[r][4] : data[r][6];
    let pD = parseServerDate(rawD);
    let cellDateStr = pD ? Utilities.formatDate(pD, tz, "dd/MM/yyyy") : (rawD ? String(rawD).trim() : "No Date");
    
    if (qDate && cellDateStr !== qDate) continue;
    return r + 2;
  }
  return -1;
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
    } catch (e) {
      return "ERR: File creation error: " + e.message;
    }
  }
  return urls.join(', ');
}

function parseServerDate(val) {
  if (!val) return null;
  if (val instanceof Date) {
    if (!isNaN(val.getTime())) return val;
    return null;
  }
  if (typeof val === 'string') {
    let dStr = val.trim();
    let parts = dStr.split(/[-/]/);
    if (parts.length === 3) {
      if (parts[2].length === 4) {
        let m = parseInt(parts[1], 10);
        let d = parseInt(parts[0], 10);
        if (m > 12) return new Date(parts[2], d - 1, m);
        return new Date(parts[2], m - 1, d);
      } else if (parts[0].length === 4) {
        return new Date(parts[0], parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
      }
    }
  }
  let parsed = new Date(val);
  if (!isNaN(parsed.getTime())) return parsed;
  return null;
}

function _isNameMatch(dbName, searchName, aliasList, searchMobile) {
  if (!dbName) return false;
  function clean(str) { return String(str).toUpperCase().replace(/^NEWAI\s*-\s*/, '').replace(/\(.*?\)/g, '').trim(); }
  var dClean = clean(dbName);
  var sClean = clean(searchName);
  var m = String(searchMobile).trim();
  
  if (dClean === sClean) return true;
  
  if (m !== "" && String(dbName).indexOf(m) > -1) return true;
  
  if (aliasList && aliasList.length > 0) {
    for (var i = 0; i < aliasList.length; i++) {
       var aClean = clean(aliasList[i]);
       if (dClean === aClean) return true; 
    }
  }
  return false; 
}

function _cleanTaskName(taskName) {
  if (!taskName) return "";
  return String(taskName).toUpperCase().replace(/[\s\.\,\-\_\(\)\[\]\:\;]/g, '');
}

// ==========================================
// 2. AUTOMATION FUNCTIONS & MENU
// ==========================================

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('Ultimate Checklist')
    .addItem('Setup Sheet', 'onOpen')
    .addItem('Assign Buddy', 'showAssignBuddyDialog')
    .addItem('Generate Monthly Master (Manual)', 'updateMonthlyMaster')
    .addItem('Enable Auto-Update (Daily)', 'setMonthlyAutoTrigger')
    .addItem('Remove Duplicates ⚡', 'removeDuplicatesFromMaster') 
    .addItem('Force Sync Missing Tasks 🔄', 'forceSyncMissingTasks') // ADDED FORCE SYNC
    .addToUi();
}

/**
 * NEW FUNCTION: Force Sync Missing Tasks
 * Scans Task List for valid tasks that say "Sent" but are completely missing from the Master sheet.
 */
function forceSyncMissingTasks() {
  portalAssertEditor_();
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var taskSheet = ss.getSheetByName("Task List");
  var masterSheet = ss.getSheetByName("Master");
  
  if (!taskSheet || !masterSheet) {
    ui.alert("Error", "Required sheets (Task List or Master) are missing.", ui.ButtonSet.OK);
    return;
  }

  var taskLastRow = taskSheet.getLastRow();
  if (taskLastRow < 2) {
     ui.alert("Scan Complete ℹ️", "No tasks found in the Task List.", ui.ButtonSet.OK);
     return;
  }
  
  var taskData = taskSheet.getRange(2, 1, taskLastRow - 1, 6).getValues(); 
  var masterLastRow = masterSheet.getLastRow();
  var existingTaskKeys = new Set();
  
  // Collect all unique tasks currently in Master sheet
  if (masterLastRow > 1) {
    var masterData = masterSheet.getRange(2, 1, masterLastRow - 1, 6).getValues(); 
    for (let i = 0; i < masterData.length; i++) {
      let mDoer = String(masterData[i][0]).trim().toUpperCase();
      let mDept = String(masterData[i][2]).trim().toUpperCase();
      let mTaskRaw = String(masterData[i][5]);
      let mTaskClean = _cleanTaskName(mTaskRaw);
      
      if (mTaskClean && mDoer) {
        existingTaskKeys.add(mDoer + "|" + mTaskClean + "|" + mDept);
      }
    }
  }

  var rowsToReset = [];

  // Compare Task List with Master
  for (let i = 0; i < taskData.length; i++) {
    let tTask = String(taskData[i][0] || "").trim();
    let tDoer = String(taskData[i][1] || "").trim().toUpperCase();
    let tDept = String(taskData[i][2] || "").trim().toUpperCase();
    let tFreq = String(taskData[i][3] || "").trim();
    let tDate = String(taskData[i][4] || "").trim();
    let tStatus = String(taskData[i][5] || "").trim();
    
    let tTaskClean = _cleanTaskName(tTask);
    let tKey = tDoer + "|" + tTaskClean + "|" + tDept;

    // Check if task is valid and marked as "Sent", but is missing in Master
    if (tTask !== "" && tDoer !== "" && tDept !== "" && tFreq !== "" && tDate !== "") {
      if (tStatus === "Sent" && !existingTaskKeys.has(tKey)) {
         rowsToReset.push(i + 2); // +2 because taskData starts from row 2
      }
    }
  }

  if (rowsToReset.length === 0) {
    ui.alert("Scan Complete ℹ️", "No missing tasks found. All valid tasks from the Task List are already present in the Master sheet.", ui.ButtonSet.OK);
    return;
  }

  // Clear the "Sent" status for those missing tasks
  rowsToReset.forEach(function(r) { 
    taskSheet.getRange(r, 6).clearContent(); 
  });
  SpreadsheetApp.flush(); 

  // Run your existing Checklist creator engine
  createChecklist();
  
  ui.alert("Force Sync Success ✅", rowsToReset.length + " missing task(s) were identified and successfully synced to the Master sheet.", ui.ButtonSet.OK);
}

function safelySetValues(sheet, range, values) {
  range.clearDataValidations();
  range.setValues(values);
  try {
    let startRow = range.getRow();
    let numRows = range.getNumRows();
    let statusRange = sheet.getRange(startRow, 9, numRows, 1);
    let rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['Done', 'Pending', 'Review', 'Cancelled'], true)
      .setAllowInvalid(true) 
      .build();
    statusRange.setDataValidation(rule);
  } catch(e) {}
}

function removeDuplicatesFromMaster() {
  portalAssertEditor_();
  var lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch(e) { SpreadsheetApp.getActiveSpreadsheet().toast("System busy. Try again."); return; }
  
  try {
    let ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName("Master");
    let lr = sheet.getLastRow();
    if(lr < 2) return;

    ss.toast("Finding duplicates securely...", "Processing", 3);

    let data = sheet.getRange(2, 1, lr - 1, 12).getValues();
    let seen = new Set();
    let newData = [];
    let duplicateCount = 0;
    let tz = Session.getScriptTimeZone();

    for(let i = 0; i < data.length; i++) {
      let rawDoer = data[i][0];
      let rawTask = data[i][5];
      let rawDate = data[i][6];
      let status = String(data[i][8]).trim().toLowerCase();
      
      if(!rawDoer || !rawTask || !rawDate) {
          newData.push(data[i]);
          continue;
      }

      let doer = String(rawDoer).trim().toUpperCase();
      let taskClean = _cleanTaskName(rawTask); 
      
      let pDate = parseServerDate(rawDate);
      let dateKey = pDate ? Utilities.formatDate(pDate, tz, "yyyy-MM-dd") : String(rawDate).trim();
      let key = doer + "|" + taskClean + "|" + dateKey;

      if(seen.has(key)) {
        if(status !== 'done' && status !== 'completed') {
            duplicateCount++; 
        } else {
            if (status !== 'done') data[i][8] = "";
            newData.push(data[i]); 
        }
      } else {
        seen.add(key);
        if (status !== 'done' && status !== 'completed') data[i][8] = "";
        newData.push(data[i]);
      }
    }

    if(duplicateCount > 0) {
      if (newData.length > 0) {
          safelySetValues(sheet, sheet.getRange(2, 1, newData.length, 12), newData);
      }
      let leftoverRows = data.length - newData.length;
      if (leftoverRows > 0) {
          sheet.getRange(2 + newData.length, 1, leftoverRows, 12).clearContent();
      }
      ss.toast(duplicateCount + " Duplicates removed securely!", "Success", 5);
      SpreadsheetApp.flush();
      updateMonthlyMaster(true);
      _invalidate('routine');
    } else {
      ss.toast("No duplicates found.", "Clean", 3);
    }
  } finally {
      lock.releaseLock();
  }
}

Date.prototype.addTheDays = function (days) {
  var date = new Date(this.valueOf());
  date.setDate(date.getDate() + days);
  return date;
}

function getWorkingDateOnOrBefore(date, workingDatesStr, calendarFirstDate) {
  let candidate = new Date(date)
  let firstDate = new Date(calendarFirstDate)
  candidate.setHours(0, 0, 0, 0)
  firstDate.setHours(0, 0, 0, 0)

  let candidateStr = Utilities.formatDate(candidate, Session.getScriptTimeZone(), "yyyy-MM-dd")
  while (!workingDatesStr.includes(candidateStr)) {
    if (candidate.valueOf() <= firstDate.valueOf()) {
      throw new Error("No working date found on or before " + Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd") + " in Working Day Calender.")
    }
    candidate = Date.parse(candidate).addDays(-1)
    candidateStr = Utilities.formatDate(candidate, Session.getScriptTimeZone(), "yyyy-MM-dd")
  }
  return candidate
}

function showAssignBuddyDialog() {
  portalAssertEditor_();
  var html = HtmlService.createHtmlOutputFromFile('AssignBuddyDialog').setWidth(460).setHeight(380);
  SpreadsheetApp.getUi().showModalDialog(html, 'Assign Buddy');
}

function getAssignBuddyOptions() {
  portalAssertEditor_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var doerSheet = ss.getSheetByName("Doer List");
  if (!doerSheet) throw new Error("Doer List sheet was not found.");
  var lastRow = doerSheet.getLastRow();
  if (lastRow < 1) return { doers: [], buddies: [] };
  var data = doerSheet.getRange(1, 1, lastRow, 3).getValues();
  var doers = []; var buddies = []; var seenDoers = {}; var seenEmails = {};
  data.forEach(function(row) {
    var name = String(row[0] || "").trim();
    var department = String(row[1] || "").trim();
    var email = String(row[2] || "").trim();
    if (!name || !department || !email || email.indexOf("@") === -1) return;
    var doerKey = name + "\u0000" + department;
    if (!seenDoers[doerKey]) { seenDoers[doerKey] = true; doers.push({ name: name, department: department, label: name + " - " + department }); }
    if (!seenEmails[email]) { seenEmails[email] = true; buddies.push({ email: email, label: name + " - " + department + " (" + email + ")" }); }
  });
  return { doers: doers, buddies: buddies };
}

function parseDateInput(dateText, fieldName) {
  if (!dateText) throw new Error(fieldName + " is required.");
  var parts = String(dateText).split("-");
  if (parts.length !== 3) throw new Error(fieldName + " must be a valid date.");
  var date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  if (isNaN(date.valueOf())) throw new Error(fieldName + " must be a valid date.");
  date.setHours(0, 0, 0, 0);
  return date;
}

function assignBuddyToTasks(form) {
  portalAssertEditor_();
  var name = String(form.name || "").trim();
  var department = String(form.department || "").trim();
  var buddyEmail = String(form.buddyEmail || "").trim();
  var fromDate = parseDateInput(form.fromDate, "From date");
  var toDate = parseDateInput(form.toDate, "To date");

  if (!name || !department) throw new Error("Choose a name and department.");
  if (!buddyEmail) throw new Error("Choose a buddy email.");
  if (fromDate.valueOf() > toDate.valueOf()) throw new Error("From date cannot be after To date.");

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var masterSheet = ss.getSheetByName("Master");
  if (!masterSheet) throw new Error("Master sheet was not found.");

  var lastRow = masterSheet.getLastRow();
  if (lastRow < 2) return { updated: 0 };

  var data = masterSheet.getRange(2, 1, lastRow - 1, 12).getValues();
  var buddyColumn = data.map(function(row) { return [row[10]]; });
  var updated = 0;

  data.forEach(function(row, index) {
    var taskDoer = String(row[0] || "").trim();
    var taskDepartment = String(row[2] || "").trim();
    var plannedDate = row[6];

    if (!(plannedDate instanceof Date)) return;
    var normalizedPlannedDate = new Date(plannedDate);
    normalizedPlannedDate.setHours(0, 0, 0, 0);

    if (taskDoer === name && taskDepartment === department && normalizedPlannedDate.valueOf() >= fromDate.valueOf() && normalizedPlannedDate.valueOf() <= toDate.valueOf()) {
      buddyColumn[index][0] = buddyEmail;
      updated = updated + 1;
    }
  });

  if (updated > 0) {
    let r = masterSheet.getRange(2, 11, buddyColumn.length, 1);
    try { r.setValues(buddyColumn); } catch(e) { r.clearDataValidations(); r.setValues(buddyColumn); }
    updateMonthlyMaster(true); 
  }
  return { updated: updated };
}

function setTrigger() {
  portalAssertEditor_();
  removeTrigger(); var ss = SpreadsheetApp.getActiveSpreadsheet(); var sheet = ss.getSheetByName("Setup Sheet");
  var time = sheet.getRange("C15").getValue(); createTrigger(time);
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
    if (allTriggers[i].getUniqueId() == allTriggers[i].getUniqueId()) { ScriptApp.deleteTrigger(allTriggers[i]); break; }
  }
}

function sendReminder() {
  var forB = SpreadsheetApp.getActive();
  var forBsh = forB.getSheetByName("Doer List")
  var lastB = forBsh.getLastRow()
  var dataB = forBsh.getRange(1, 3, lastB, 1).getValues()
  var today = new Date();
  var tomorrow = new Date((new Date().setHours(0, 0, 0, 0)).valueOf() + 1000 * 3600 * 24);
  var ss = SpreadsheetApp.getActive()
  var sheet = ss.getSheetByName("Master")
  var columnToCheck = sheet.getRange("B:B").getValues()
  var lastrow = getLastRowSpecial(columnToCheck) - 1
  var data = sheet.getRange(2, 1, lastrow, 8).getValues()
  let emails = dataB.filter(function(r){
    let reminderTasks = []
    let pendingTomorrow = data.filter(function(pending){
      let doeremail = pending[1]
      let lastDate = pending[6]
      let actual = pending[7]
      let name = pending[0]
      let task = pending[5]
      if (r[0] === doeremail && lastDate.valueOf() === tomorrow.valueOf() && !actual){
        reminderTasks.push([name,task])
      }
    })
    if (reminderTasks.length > 0){
    let joinedTasks = reminderTasks.map(function(tasks){ return "Task : "+tasks[1] }).join("\n")
    let dataToSend = "Hello "+reminderTasks[0][0]+",\n\nYou have planned tasks pending for tomorrow.\n\n"+joinedTasks+"\n\nPlease ignore this message if you have already completed the tasks."
    GmailApp.sendEmail(r[0], "You have a Pending Tasks for tomorrow", dataToSend);
    }
  })
}

function archive() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Scores")
  var data = sheet.getRange(4, 1, 6, 4).getValues()
  var name = sheet.getRange("A2").getValue()
  var week = sheet.getRange("D2").getValue()
  var arch = ss.getSheetByName("Archive")
  var archLast = arch.getLastRow() - 1
  var ared = data[3][1]
  var ayellow = data[3][2]
  var pred = data[5][1]
  var pyellow = data[5][2]
  arch.appendRow([name, week, pred, pyellow, "", ared, ayellow, ""])
  var spreadsheet = ss.getSheetByName("Scores")
  spreadsheet.getRange('B9:C9').activate();
  spreadsheet.getActiveRangeList().clear({ contentsOnly: true, skipFilteredRows: true });
}

function sendtodoer() {
  var forB = SpreadsheetApp.getActiveSpreadsheet();
  var forBsh = forB.getSheetByName("Doer List")
  var lastB = forBsh.getLastRow()
  var dataB = forBsh.getRange(1, 1, lastB, 2).getValues()
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Send Tasks To Doer")
  var lastrow = sheet.getLastRow() - 3
  var range = sheet.getRange(4, 1, lastrow, 2)
  var htmlTable = SheetConverter.convertRange2html(range);
  var status = sheet.getRange("D2").getValue()
  var weeknum = sheet.getRange("E2").getValue().toString()
  var name = sheet.getRange("A2").getValue()
  var email = findinB(name, dataB)
  var body = "Here are your " + status + " tasks of Week " + weeknum + ".<br/><br/>" + htmlTable
  GmailApp.sendEmail(email, 'Details of Delegated Tasks', body, { htmlBody: body });
}

// ==========================================
// 100% BULLETPROOF IN-PLACE CHECKLIST CREATOR
// ==========================================
function createChecklist() {
  var lock = LockService.getScriptLock();
  try {
      lock.waitLock(30000); 
  } catch (e) {
      return; 
  }

  try {
      let ss = SpreadsheetApp.getActiveSpreadsheet();
      let taskListSheet = ss.getSheetByName("Task List");
      let taskListLastRow = taskListSheet.getLastRow();
      
      if (taskListLastRow < 2) return; 
      
      let taskListData = taskListSheet.getRange(2, 1, taskListLastRow - 1, 7).getValues();

      let masterSheet = ss.getSheetByName("Master");
      let masterLastRow = Math.max(1, masterSheet.getLastRow());
      
      let mData = [];
      let maxSequentialId = 0; 
      let tz = Session.getScriptTimeZone();

      if (masterLastRow > 1) {
        mData = masterSheet.getRange(2, 1, masterLastRow - 1, 12).getValues();
        for(let i=0; i<mData.length; i++) {
           let val = parseInt(mData[i][3], 10);
           if(!isNaN(val) && val > maxSequentialId) maxSequentialId = val;
        }
      }
      
      mData.forEach(row => { while (row.length < 12) row.push(""); });

      let calendarSheet = ss.getSheetByName("Working Day Calender");
      let calendarDates = calendarSheet.getRange("A:A").getValues();
      let calendarLast = calendarDates.filter(r => String(r[0])).length;
      if (calendarLast <= 1) throw new Error("Working Day Calender Date limits required.");
      
      let calendarLastDate = calendarDates[calendarLast - 1][0];
      if (!(calendarLastDate instanceof Date)) calendarLastDate = new Date(calendarLastDate);
      calendarLastDate.setHours(23, 59, 59, 999);

      let statusUpdates = []; 
      let templateUpdates = [];
      let rowsToAppend = [];
      let madeChanges = false;

      let existingMasterTasks = new Set();
      for (let i = 0; i < mData.length; i++) {
          let doer = String(mData[i][0] || "").trim().toUpperCase();
          let taskRaw = String(mData[i][5] || "");
          let taskClean = _cleanTaskName(taskRaw); 
          let rawDate = mData[i][6];
          
          if (!doer || !taskClean || !rawDate) continue;

          let pDate = parseServerDate(rawDate);
          let dateKey = pDate ? Utilities.formatDate(pDate, tz, "yyyy-MM-dd") : String(rawDate).trim();
          let key = doer + "|" + taskClean + "|" + dateKey;
          existingMasterTasks.add(key);
      }

      taskListData.forEach(function (task, index) {
        let theTask = task[0]; let theDoer = task[1]; let theDepartment = task[2];
        let theFreq = task[3]; let theDate = task[4]; let theStatus = task[5]; 
        let templateId = task[6] ? String(task[6]).trim() : ""; 

        let taskStr = String(theTask || "").trim(); let doerStr = String(theDoer || "").trim();
        let deptStr = String(theDepartment || "").trim(); let freqStr = String(theFreq || "").trim();
        let taskClean = _cleanTaskName(taskStr);
        
        if (!taskStr || !doerStr || !deptStr || !freqStr || !theDate || theDate === "") {
          statusUpdates.push([theStatus]); templateUpdates.push([templateId]); return; 
        }

        if (String(theStatus).trim() === "Sent") {
          statusUpdates.push([theStatus]); templateUpdates.push([templateId]); return;
        }

        let theEmail = getEmail(theDoer, theDepartment);
        if (theEmail === "FAILED") {
          statusUpdates.push(["Skipped Due to mismatch"]); templateUpdates.push([templateId]); return;
        }

        if (!templateId) { templateId = "TPL-" + new Date().getTime() + "-" + index; }

        let parsedDate = parseServerDate(theDate);
        if (!parsedDate || isNaN(parsedDate.valueOf())) { statusUpdates.push(["Invalid Date"]); templateUpdates.push([templateId]); return; }
        parsedDate.setHours(0, 0, 0, 0);

        let targetDates = []; let d = new Date(parsedDate.valueOf());

        if (freqStr === "W") {
          while (calendarLastDate.valueOf() >= d.valueOf()) { targetDates.push(new Date(d.valueOf())); d.setDate(d.getDate() + 7); }
        } else if (freqStr === "M") {
          while (calendarLastDate.valueOf() >= d.valueOf()) {
            let norun = 0;
            if (d.getMonth() === 0 && d.getDate() > 28) {
              norun = 1; targetDates.push(new Date(d.valueOf())); let m = d.getMonth(); d.setMonth(m + 2);
              if (d.getMonth() !== (m + 2) % 12) d.setDate(0); 
            }
            if (norun === 0) {
              targetDates.push(new Date(d.valueOf())); let m = d.getMonth(); d.setMonth(m + 1);
              if (d.getMonth() !== (m + 1) % 12) d.setDate(0);
            }
          }
        } else if (freqStr === "Y") {
          while (calendarLastDate.valueOf() >= d.valueOf()) { targetDates.push(new Date(d.valueOf())); d.setFullYear(d.getFullYear() + 1); }
        } else if (freqStr === "D") {
          while (calendarLastDate.valueOf() >= d.valueOf()) { targetDates.push(new Date(d.valueOf())); d.setDate(d.getDate() + 1); }
        } else if (freqStr === "Q") {
          while (calendarLastDate.valueOf() >= d.valueOf()) { targetDates.push(new Date(d.valueOf())); d.setMonth(d.getMonth() + 3); }
        } else if (freqStr === "H" || freqStr === "HY" || freqStr === "Half Yearly") {
          while (calendarLastDate.valueOf() >= d.valueOf()) { targetDates.push(new Date(d.valueOf())); d.setMonth(d.getMonth() + 6); }
        } else if (freqStr === "F") {
          while (calendarLastDate.valueOf() >= d.valueOf()) { targetDates.push(new Date(d.valueOf())); d.setDate(d.getDate() + 14); }
        } else if (["E1st", "E2nd", "E3rd", "E4th", "ELast"].includes(freqStr)) {
          let nMap = { "E1st": 1, "E2nd": 2, "E3rd": 3, "E4th": 4, "ELast": 'last' };
          while (calendarLastDate.valueOf() >= d.valueOf()) { targetDates.push(new Date(d.valueOf())); d = getNextNthWeekday(d, nMap[freqStr]); }
        }

        for (let i = 0; i < targetDates.length; i++) {
            let targetDateKey = Utilities.formatDate(targetDates[i], tz, "yyyy-MM-dd");
            let checkKey = doerStr.toUpperCase() + "|" + taskClean + "|" + targetDateKey;

            if (!existingMasterTasks.has(checkKey)) {
                maxSequentialId++; 
                let newRow = Array(12).fill("");
                newRow[0] = doerStr;
                newRow[1] = theEmail;
                newRow[2] = deptStr;
                newRow[3] = maxSequentialId; 
                newRow[4] = freqStr;
                newRow[5] = taskStr;
                newRow[6] = targetDates[i];
                newRow[8] = ""; 
                rowsToAppend.push(newRow);
                existingMasterTasks.add(checkKey);
                madeChanges = true;
            }
        }

        statusUpdates.push(["Sent"]);
        templateUpdates.push([templateId]);
      });
      
      if (statusUpdates.length > 0) {
        let rngSent = taskListSheet.getRange(2, 6, statusUpdates.length, 1);
        try { rngSent.setValues(statusUpdates); } catch(e) { rngSent.clearDataValidations(); rngSent.setValues(statusUpdates); }
      }
      if (templateUpdates.length > 0) {
        let rngTemp = taskListSheet.getRange(2, 7, templateUpdates.length, 1);
        try { rngTemp.setValues(templateUpdates); } catch(e) { rngTemp.clearDataValidations(); rngTemp.setValues(templateUpdates); }
      }
      
      if (madeChanges && rowsToAppend.length > 0) {
        let r = masterSheet.getRange(masterLastRow + 1, 1, rowsToAppend.length, 12);
        try { r.setValues(rowsToAppend); } catch(e) { r.clearDataValidations(); r.setValues(rowsToAppend); }
        SpreadsheetApp.flush();
        updateMonthlyMaster(true);
      }
  } finally {
      lock.releaseLock();
  }
}

function getNextNthWeekday(currentDate, nValue) {
  let targetDayOfWeek = currentDate.getDay();
  let d = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
  let month = d.getMonth();
  let count = 0;
  let lastFound = null;
  
  while (d.getMonth() === month) {
    if (d.getDay() === targetDayOfWeek) {
      count++;
      lastFound = new Date(d.valueOf());
      if (count === nValue) return lastFound;
    }
    d.setDate(d.getDate() + 1);
  }
  return lastFound; 
}


// ==========================================
// UNBREAKABLE "ONEDIT" ENGINE
// ==========================================

function onEdit(e) {
  if (!e || !e.range) return;
  var range = e.range;
  var sheet = range.getSheet();
  var sheetName = sheet.getName();
  
  if (sheetName === "Task List") {
    var editedCol = range.getColumn();
    var editedRow = range.getRow();
    if (editedRow > 1 && editedCol >= 1 && editedCol <= 5) {
      var cellF = sheet.getRange(editedRow, 6);
      try { cellF.clearContent(); } catch(err) { cellF.clearDataValidations(); cellF.clearContent(); }
    }
    return;
  }

  if (sheetName !== "Master" && sheetName !== "MM" && sheetName !== "Monthly Master") return;

  var startRow = range.getRow();
  var startCol = range.getColumn();
  if (startRow < 2) return; 

  if (startCol === 9) { // Status column
    var statusVal = String(range.getValue()).trim().toLowerCase();
    if (statusVal === "done" || statusVal === "completed") {
       var actualDateCell = sheet.getRange(startRow, 8); 
       if (!actualDateCell.getValue()) {
          var exactTimeStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm:ss");
          try { actualDateCell.setValue(exactTimeStr); } catch(err) { actualDateCell.clearDataValidations(); actualDateCell.setValue(exactTimeStr); }
       }
    }
  }
  
  _invalidate('routine'); // Invalidate cache on manual edit so webapp gets fresh data
}

function runOnceToFixTriggers() {
  portalAssertEditor_();
  var allTriggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < allTriggers.length; i++) {
    var fn = allTriggers[i].getHandlerFunction();
    if (fn === 'onChange' || fn === 'createTriggerOnChange') {
      ScriptApp.deleteTrigger(allTriggers[i]);
    }
  }
}

// ==========================================
// MONTHLY MASTER UPDATER (LEGACY)
// ==========================================
function updateMonthlyMaster(isSilent) {
  var lock = LockService.getScriptLock();
  var showUI = (isSilent !== true && typeof isSilent !== 'object');
  
  if (!lock.tryLock(30000)) {
    if (showUI) SpreadsheetApp.getActiveSpreadsheet().toast("System is busy saving tasks. Please try again in a few seconds.", "Busy", 4);
    return;
  }
  
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var masterSheet = ss.getSheetByName("Master");
    var monthlySheet = ss.getSheetByName("Monthly Master");

    if (!monthlySheet) {
      monthlySheet = ss.insertSheet("Monthly Master");
      var headers = masterSheet.getRange(1, 1, 1, 12).getValues();
      monthlySheet.getRange(1, 1, 1, 12).setValues(headers);
      monthlySheet.getRange(1, 1, 1, 12).setFontWeight("bold");
      monthlySheet.setFrozenRows(1);
    }

    var lastRow = masterSheet.getLastRow();
    if (lastRow < 2) {
      if (showUI) SpreadsheetApp.getUi().alert("No tasks found in the Master sheet.");
      return;
    }
    
    if (showUI) ss.toast("Filtering and generating tasks for the current month...", "Please wait", 3);

    var data = masterSheet.getRange(2, 1, lastRow - 1, 12).getValues();
    var currentDate = new Date();
    var currentMonth = currentDate.getMonth(); 
    var currentYear = currentDate.getFullYear();
    var monthlyData = [];

    data.forEach(function(row) {
      var pDate = parseServerDate(row[6]); 
      var status = String(row[8]).trim().toLowerCase();
      var isPending = (status !== "done" && status !== "completed" && status !== "cancelled");

      if (pDate && !isNaN(pDate.getTime())) {
        var taskMonth = pDate.getMonth();
        var taskYear = pDate.getFullYear();
        
        var isCurrentMonth = (taskMonth === currentMonth && taskYear === currentYear);
        
        if (isCurrentMonth) { 
            monthlyData.push(row); 
        }
      } else if (isPending) { 
        monthlyData.push(row); 
      }
    });

    var monthlyLastRow = monthlySheet.getLastRow();

    if (monthlyData.length > 0) {
      let targetRng = monthlySheet.getRange(2, 1, monthlyData.length, 12);
      try { targetRng.setValues(monthlyData); } catch(e) { targetRng.clearDataValidations(); targetRng.setValues(monthlyData); }
      
      let leftover = monthlyLastRow - 1 - monthlyData.length;
      if (leftover > 0) {
          monthlySheet.getRange(2 + monthlyData.length, 1, leftover, 12).clearContent();
      }
      SpreadsheetApp.flush(); _invalidate('routine');
      if (showUI) ss.toast("Monthly Master successfully updated with current month's tasks!", "Success", 5);
    } else {
      if (monthlyLastRow > 1) {
        monthlySheet.getRange(2, 1, monthlyLastRow - 1, 12).clearContent();
      }
      SpreadsheetApp.flush(); _invalidate('routine');
      if (showUI) SpreadsheetApp.getUi().alert("No tasks found for the current month.");
    }
  } catch (err) {
     if (showUI) SpreadsheetApp.getUi().alert("An error occurred: " + err.message);
  } finally { 
      lock.releaseLock(); 
  }
}

function setMonthlyAutoTrigger() {
  portalAssertEditor_();
  var allTriggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < allTriggers.length; i++) {
    if (allTriggers[i].getHandlerFunction() === 'updateMonthlyMaster') {
      ScriptApp.deleteTrigger(allTriggers[i]);
    }
  }
  
  ScriptApp.newTrigger('updateMonthlyMaster')
    .timeBased()
    .everyDays(1)
    .atHour(2) 
    .create();
    
  SpreadsheetApp.getUi().alert("Automatic Update enabled! It will now automatically update the current month's tasks every day at 2 AM.");
}

function getEmail(doer, department) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Doer List");
  if (!sheet) return "FAILED";
  var lr = sheet.getLastRow();
  if (lr < 2) return "FAILED";
  var data = sheet.getRange(2, 1, lr - 1, 3).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim() === String(doer).trim() && 
        String(data[i][1]).trim() === String(department).trim()) {
      return String(data[i][2]).trim();
    }
  }
  return "FAILED";
}

function getDayInfo(dayIndex) {
  var days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  return days[dayIndex];
}

function getLastRowSpecial(range) {
  var rowNum = 0;
  var blank = false;
  for (var row = 0; row < range.length; row++) {
    if (range[row][0] === "" && !blank) {
      rowNum = row;
      blank = true;
    } else if (range[row][0] !== "") {
      blank = false;
    }
  }
  return rowNum === 0 ? range.length : rowNum;
}

function findinB(name, dataB) {
  for (var i = 0; i < dataB.length; i++) {
    if (dataB[i][0] == name) {
      return dataB[i][1];
    }
  }
  return "";
}

// ==========================================
// 3. WEB APP OPTIMIZED FUNCTIONS
// ==========================================

function doGet(e) {
  var gate = portalGate_(e);          // GGM Portal: launch pass / Portal-only (Portal.js)
  if (gate.block) return gate.block;
  return portalInject_(bigUploadPage_(HtmlService.createHtmlOutputFromFile('index')), gate)   // + 50 MB attachments (BigUpload.js)
      .setTitle('Newai Tasks')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=0, viewport-fit=cover');
}

function checkLogin(mobileInput, passInput) {
  // Connected to GGM Portal: the portal username/phone + password are tried first (checked by the hub).
  // While Portal-only is OFF the old mobile + password (Doer List) keeps working too.
  var portalMsg = '';
  if (portalEnabled_()) {
    try {
      var b = portalRemoteLogin_(mobileInput, passInput);
      return { success: true, name: b.name, fullName: b.fullName, mobile: b.mobile, token: b.token };
    } catch (e) {
      if (portalOnly_()) return { success: false, message: e.message || String(e) };
      portalMsg = e.message || String(e);
    }
  }
  var old = mobileLogin_(mobileInput, passInput);
  if (!old.success && portalMsg && /Invalid/.test(old.message)) old.message = 'Mobile / username or password is wrong.';
  return old;
}

/** The app's own login: mobile + password from the Doer List. */
function mobileLogin_(mobileInput, passInput) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("Doer List");
    if (!sheet) return { success: false, message: "Doer List sheet not found! Please contact admin." };
    
    var data = sheet.getDataRange().getValues();
    var mobileStr = String(mobileInput).trim();
    var passStr = String(passInput).trim();

    for (var i = 1; i < data.length; i++) {
      var name = String(data[i][0] || "").trim();
      var mobile = String(data[i][3] || "").trim();
      var pass = String(data[i][4] || "").trim();
      
      if (mobile === mobileStr && pass === passStr) {
        var token = portalNewSession_({ u: mobileStr, n: name, d: name, p: mobileStr }, 'legacy');
        return { success: true, name: name, fullName: name, mobile: mobileStr, token: token };
      }
    }
    return { success: false, message: "Invalid Mobile Number or Password" };
  } catch (error) { 
    return { success: false, message: "Server busy. Try again." }; 
  }
}

/** Page → the signed-in person's tasks. Name and mobile come from the session, not the browser. */
function getAllTasksForUser(token, userNameIgnored, mobileIgnored, forceFresh) {
  var sess = ckSessionOrNull_(token);
  if (!sess) return { sessionExpired: true };
  return getAllTasksForUser_(sess.name, sess.mobile, forceFresh);
}

function getAllTasksForUser_(userName, mobileNumber, forceFresh) {
  const searchName = String(userName || "").trim().toLowerCase();
  const searchMobile = String(mobileNumber || "").trim();
  
  if (forceFresh === true) { _invalidate('all'); }

  const uKey = 'NEWAI_UR|' + searchName + '|' + _getVersion();
  if (forceFresh !== true) {
    const cachedRes = _cacheGet(uKey);
    if (cachedRes) return cachedRes;
  }

  let result = { routineTasks: [], delegatedTasks: [], staffList: [], stats: { routineWeeklyTotal: 0, routineWeeklyDone: 0, routineMonthlyTotal: 0, routineMonthlyDone: 0, dailyScore: "0%", monthlyScore: "0" }, exactFullName: userName, error: "" };
  
  const tz = Session.getScriptTimeZone();
  const today = new Date();
  const todayStr = Utilities.formatDate(today, tz, "dd/MM/yyyy");
  const currentMonth = today.getMonth();
  const currentYear = today.getFullYear();
  
  let currentWeekStart = new Date(today);
  let day = currentWeekStart.getDay(); 
  currentWeekStart.setDate(currentWeekStart.getDate() - day + (day == 0 ? -6 : 1)); 
  currentWeekStart.setHours(0,0,0,0);
  const weekStartMs = currentWeekStart.getTime();
  
  let currentWeekEnd = new Date(currentWeekStart); 
  currentWeekEnd.setDate(currentWeekStart.getDate() + 6); 
  currentWeekEnd.setHours(23,59,59,999);
  const weekEndMs = currentWeekEnd.getTime();

  let validNamesForMobile = [searchName];
  try {
    var ssForDual = SpreadsheetApp.getActiveSpreadsheet();
    var doerSheet = ssForDual.getSheetByName("Doer List");
    if(doerSheet) {
      var doerData = doerSheet.getDataRange().getValues();
      for(var d = 1; d < doerData.length; d++) {
        let extractedName = String(doerData[d][0] || "").trim();
        if (extractedName) {
            let alreadyExists = result.staffList.find(s => s.value === extractedName);
            if (!alreadyExists) result.staffList.push({ label: extractedName, value: extractedName });
        }
        if(searchMobile !== "" && String(doerData[d][3]).trim() === searchMobile) {
          var matchedName = extractedName.toLowerCase();
          if (validNamesForMobile.indexOf(matchedName) === -1) { validNamesForMobile.push(matchedName); }
          if (!result.exactFullName || result.exactFullName === userName) { result.exactFullName = extractedName; }
        }
      }
    }
  } catch(e) {}

  try {
      const rouData = _loadRoutine();
      if (rouData && rouData.master) {
          const data = rouData.master;
          for (let i = 0; i < data.length; i++) {
            if (!data[i][0] || !_isNameMatch(data[i][0], searchName, validNamesForMobile, searchMobile)) continue; 
            
            let tId = data[i][3] ? String(data[i][3]).trim() : ("ROW_" + (i + 2)); 
            let rawL = data[i][11] ? String(data[i][11]).trim() : ""; 
            let staffRemark = rawL; let staffFileUrl = "";
            
            if (rawL.includes("https://drive.google.com")) {
                let urlRegex = /(https:\/\/drive\.google\.com[^\s]+)/g;
                let match = rawL.match(urlRegex);
                if (match) { staffFileUrl = match.join(","); staffRemark = rawL.replace(urlRegex, "").trim(); }
            }
            
            let rawStatus = data[i][8] ? String(data[i][8]).trim().toLowerCase() : "";
            let mappedStatus = 'pending';
            if (rawStatus === 'done' || rawStatus === 'completed') mappedStatus = 'completed';
            else if (rawStatus === 'review') mappedStatus = 'review';
            else if (rawStatus === 'cancelled') continue; 
            
            let freqClean = String(data[i][4] || "NA").toUpperCase().trim();
            let isDaily = (freqClean === "D" || freqClean === "DAILY");

            let plannedRaw = data[i][6];
            let dateObj = parseServerDate(plannedRaw);
            let dueDateStr = dateObj ? Utilities.formatDate(dateObj, tz, "dd/MM/yyyy") : (plannedRaw ? String(plannedRaw).trim() : "No Date");
            
            let actualRaw = data[i][7];
            let actualDateObj = parseServerDate(actualRaw);
            let actualDateStr = actualDateObj ? Utilities.formatDate(actualDateObj, tz, "dd/MM/yyyy hh:mm a") : (actualRaw ? String(actualRaw).trim() : "");
            
            let isToday = (dueDateStr === todayStr);
            let isDone = (mappedStatus === 'completed');

            let taskTimeMs = dateObj ? dateObj.getTime() : 0;
            let taskMonth = dateObj ? dateObj.getMonth() : -1;
            let taskYear = dateObj ? dateObj.getFullYear() : -1;

            if (taskMonth === currentMonth && taskYear === currentYear) {
                result.stats.routineMonthlyTotal++; 
                if(isDone) result.stats.routineMonthlyDone++;
                if(taskTimeMs >= weekStartMs && taskTimeMs <= weekEndMs) { result.stats.routineWeeklyTotal++; if(isDone) result.stats.routineWeeklyDone++; }
            }
            
            let shouldSendToClient = false;
            if (!isDone) { shouldSendToClient = true; } 
            else { if (isToday) shouldSendToClient = true; else if (dateObj && taskMonth === currentMonth && taskYear === currentYear) shouldSendToClient = true; }

            if (shouldSendToClient || mappedStatus === 'review') {
                result.routineTasks.push({ 
                    taskId: tId, title: data[i][5] || "Untitled task", freq: freqClean, isDaily: isDaily, 
                    dueDate: dueDateStr, actualDate: actualDateStr, status: mappedStatus, isToday: isToday, staffRemark: staffRemark, staffFileUrl: staffFileUrl, type: 'routine' 
                });
            }
          }

          const sumData = rouData.summary;
          if (sumData && sumData.length > 1) {
              const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
              const fullMonthNames = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
              const currentMonthStr = monthNames[currentMonth]; const currentFullMonthStr = fullMonthNames[currentMonth];
              let monthColIndex = -1;

              for (let checkRow of [0, 1]) {
                  if(!sumData[checkRow]) continue;
                  for (let c = 3; c < sumData[checkRow].length; c++) {
                      let hStr = String(sumData[checkRow][c]).trim().toLowerCase();
                      if (hStr.includes(currentMonthStr) || hStr.includes(currentFullMonthStr)) { monthColIndex = c; break; }
                  }
                  if (monthColIndex !== -1) break;
              }

              for (let r = 2; r < sumData.length; r++) {
                  if (!sumData[r][2]) continue;
                  if (_isNameMatch(sumData[r][2], searchName, validNamesForMobile, searchMobile)) {
                      let rawDaily = sumData[r][3];
                      if (rawDaily !== "" && rawDaily != null) {
                          if (typeof rawDaily === 'number') { if(rawDaily <= 1 && rawDaily >= -1) result.stats.dailyScore = Math.round(rawDaily * 100) + "%"; else result.stats.dailyScore = rawDaily + "%"; } 
                          else { let str = String(rawDaily).trim(); if(str !== "" && !str.endsWith('%')) str += "%"; result.stats.dailyScore = str || "0%"; }
                      }
                      if (monthColIndex !== -1 && sumData[r][monthColIndex] != null) { result.stats.monthlyScore = String(sumData[r][monthColIndex]).trim() || "0"; }
                      break;
                  }
              }
          }
      }
  } catch(e) {}

  try {
      const del = _loadDelegated();
      if (del && del.master) {
          const data = del.master;
          for (let i = 0; i < data.length; i++) {
            let ownerName = data[i][2] ? String(data[i][2]).trim() : "";
            let transferToName = data[i][18] ? String(data[i][18]).trim() : ""; 
            
            let isOwner = _isNameMatch(ownerName, searchName, validNamesForMobile, searchMobile);
            let isTransferTarget = _isNameMatch(transferToName, searchName, validNamesForMobile, searchMobile);

            if (!isOwner && !isTransferTarget) continue; 
            
            let tId = data[i][1] ? String(data[i][1]).trim() : ("ROW_" + (i + 2)); 
            let title = data[i][3] ? data[i][3].toString().trim() : "No title";
            let statusRaw = data[i][9] ? data[i][9].toString().trim().toLowerCase() : "pending";
            if (statusRaw === 'cancelled') continue; 

            let givenBy = data[i][10] ? data[i][10].toString().trim() : "N/A";
            let photoLink = data[i][11] ? data[i][11].toString().trim() : "";
            let remark = data[i][13] ? data[i][13].toString().trim() : "";
            let staffRemark = data[i][14] ? String(data[i][14]).trim() : "";
            let staffFileUrl = data[i][15] ? data[i][15].toString().trim() : "";
            let extraNote = data[i][16] ? data[i][16].toString().trim() : "";
            
            let rawDate = data[i][4];
            let dateObj = parseServerDate(rawDate);
            let dueDateStr = dateObj ? Utilities.formatDate(dateObj, tz, "dd/MM/yyyy") : (rawDate ? String(rawDate).trim() : "No Date");
            
            let actualRaw = data[i][7];
            let actualDateObj = parseServerDate(actualRaw);
            let actualDateStr = actualDateObj ? Utilities.formatDate(actualDateObj, tz, "dd/MM/yyyy hh:mm a") : (actualRaw ? String(actualRaw).trim() : "");
            
            let approvalRaw = data[i][17];
            let approvalDateObj = parseServerDate(approvalRaw);
            let approvalDateStr = approvalDateObj ? Utilities.formatDate(approvalDateObj, tz, "dd/MM/yyyy hh:mm a") : (approvalRaw ? String(approvalRaw).trim() : "");

            let isToday = (dueDateStr === todayStr);
            let mappedStatus = 'pending';
            if(statusRaw === 'review') mappedStatus = 'review'; 
            else if(statusRaw === 'rejected') mappedStatus = 'rejected'; 
            else if(statusRaw === 'done' || statusRaw === 'completed') mappedStatus = 'completed';

            let tStatus = 'none';
            if (transferToName && (mappedStatus === 'pending' || mappedStatus === 'rejected')) {
                if (isOwner && !isTransferTarget) tStatus = 'outgoing';
                if (!isOwner && isTransferTarget) tStatus = 'incoming';
            }

            result.delegatedTasks.push({ 
                taskId: tId, title: title, dueDate: dueDateStr, actualDate: actualDateStr, approvalDate: approvalDateStr, status: mappedStatus, 
                givenBy: givenBy, remark: remark, staffRemark: staffRemark, extraNote: extraNote, photoLink: photoLink, staffFileUrl: staffFileUrl,
                isToday: isToday, type: 'delegated', transferStatus: tStatus, transferTo: transferToName, originalOwner: ownerName
            });
          }
      }
  } catch(e) {}

  _cachePut(uKey, result, USER_CACHE_TTL);
  return result;
}

// ==========================================
// BULLETPROOF TARGETED CELL BATCH UPDATE (WRITES EXCLUSIVELY TO 'MM')
// ==========================================
function batchUpdateTasks(token, tasks) {
  var sess = ckSessionOrNull_(token);
  if (!sess) return { success: false, expired: true, message: 'Your sign-in has ended. Please log in again.' };
  (tasks || []).forEach(function (t) { if (t) t.doerName = sess.name; });   // fallback matching only ever finds the signed-in person's rows
  if (!tasks || tasks.length === 0) return { success: true, count: 0 };

  // 1. Upload files BEFORE locking the system
  for(let i = 0; i < tasks.length; i++) {
      let t = tasks[i];
      if (t.fileDataArray && t.fileDataArray.length > 0) {
          t.finalFileStr = _uploadFiles(t.fileDataArray);
      } else {
          t.finalFileStr = "";
      }
  }

  let lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000); 
  } catch(e) {
    return { success: false, message: "System busy. Please try again." };
  }

  try {
    let exactTimeStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm:ss");
    let tz = Session.getScriptTimeZone();

    let ss = SpreadsheetApp.getActiveSpreadsheet();
    let mmSheet = ss.getSheetByName('MM'); // FAST WRITING DIRECTLY TO MM
    
    let delSheet = null;
    try { delSheet = SpreadsheetApp.openById(DELEGATED_SHEET_ID).getSheetByName('Master'); } catch(e){}

    let updatedCount = 0;

    for(let i = 0; i < tasks.length; i++) {
      let t = tasks[i];
      let searchId = String(t.taskId).trim().toUpperCase();
      let qTitle = String(t.taskTitle || "").trim().toUpperCase();
      let qDoer = String(t.doerName || "").trim().toUpperCase();
      let qDate = t.taskDueDate ? String(t.taskDueDate).trim() : "";
      let isJustNote = t.isJustNote;
      let remarkText = t.remarkText;
      let finalFileStr = t.finalFileStr;

      // DELEGATED UPDATE
      if (t.type === 'delegated' && delSheet) {
         let row = _findTargetRow(delSheet, 'delegated', searchId, qTitle, qDoer, qDate, tz);
         if (row > 0) {
            if (!isJustNote) {
                delSheet.getRange(row, 8).setValue(exactTimeStr);
                delSheet.getRange(row, 10).setValue("Review");
            }
            if (remarkText) delSheet.getRange(row, 15).setValue(remarkText);
            if (finalFileStr) delSheet.getRange(row, 16).setValue(finalFileStr);
            updatedCount++;
         }
      }
      
      // ROUTINE UPDATE (Writes only to MM Sheet)
      else if (t.type === 'routine') {
         let mmRow = mmSheet ? _findTargetRow(mmSheet, 'routine', searchId, qTitle, qDoer, qDate, tz) : -1;
         let updatedAny = false;
         
         if (mmRow > 0 && mmSheet) {
            if (!isJustNote) {
                mmSheet.getRange(mmRow, 8).setValue(exactTimeStr);
                mmSheet.getRange(mmRow, 9).setValue("Done");
            }
            
            // Newai Checklist saves Files & Remarks BOTH in Column L (12)
            let combinedNoteMM = []; 
            if (remarkText) combinedNoteMM.push(remarkText); 
            if (finalFileStr) combinedNoteMM.push(finalFileStr);
            
            if (combinedNoteMM.length > 0) {
                let fRngMM = mmSheet.getRange(mmRow, 12); 
                let existingLMM = String(fRngMM.getValue()).trim();
                fRngMM.setValue(existingLMM ? existingLMM + "\n" + combinedNoteMM.join("\n") : combinedNoteMM.join("\n"));
            }
            updatedAny = true;
         }
         
         if (updatedAny) updatedCount++;
      }
    }

    SpreadsheetApp.flush();
    _invalidate('all');
    return { success: true, count: updatedCount };

  } catch(e) {
    return { success: false, message: e.toString() };
  } finally {
    lock.releaseLock();
  }
}

function requestTransfer(token, taskId, targetNameExact) {
  var sess = ckSessionOrNull_(token);
  if (!sess) return { success: false, expired: true, message: 'Your sign-in has ended. Please log in again.' };
  let lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch(e) { return { success: false, message: "System busy. Try again." }; }
  try {
    const sheet = SpreadsheetApp.openById(DELEGATED_SHEET_ID).getSheetByName('Master');
    let searchId = String(taskId).trim().toUpperCase();
    let row = _findTargetRow(sheet, 'delegated', searchId, "", "", "", Session.getScriptTimeZone());
    if (row > 0) {
        let r = sheet.getRange(row, 19);
        try { r.setValue(targetNameExact); } catch(e) { r.clearDataValidations(); r.setValue(targetNameExact); }
        SpreadsheetApp.flush(); _invalidate('delegated'); return { success: true };
    }
    return { success: false, message: "Task ID not found." };
  } catch (e) { return { success: false, message: e.toString() }; } finally { lock.releaseLock(); }
}

function processTransferResponse(token, taskId, action, currentUserNameExact) {
  var sess = ckSessionOrNull_(token);
  if (!sess) return { success: false, expired: true, message: 'Your sign-in has ended. Please log in again.' };
  currentUserNameExact = sess.full;          // always the signed-in person
  let lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch(e) { return { success: false, message: "System busy. Try again." }; }
  try {
    const sheet = SpreadsheetApp.openById(DELEGATED_SHEET_ID).getSheetByName('Master');
    let searchId = String(taskId).trim().toUpperCase();
    let row = _findTargetRow(sheet, 'delegated', searchId, "", "", "", Session.getScriptTimeZone());
    if (row > 0) {
        if (action === 'accept') {
            let r1 = sheet.getRange(row, 3); try { r1.setValue(currentUserNameExact); } catch(e) { r1.clearDataValidations(); r1.setValue(currentUserNameExact); }
            let r2 = sheet.getRange(row, 19); try { r2.setValue(""); } catch(e) { r2.clearDataValidations(); r2.setValue(""); }            
        } else if (action === 'reject' || action === 'cancel') {
            let r2 = sheet.getRange(row, 19); try { r2.setValue(""); } catch(e) { r2.clearDataValidations(); r2.setValue(""); }            
        }
        SpreadsheetApp.flush(); _invalidate('delegated'); return { success: true };
    }
    return { success: false, message: "Task not found." };
  } catch (e) { return { success: false, message: e.toString() }; } finally { lock.releaseLock(); }
}

function createSelfTask(token, userNameExact, taskTitle, dueDateStr) {
  var sess = ckSessionOrNull_(token);
  if (!sess) return { success: false, expired: true, message: 'Your sign-in has ended. Please log in again.' };
  userNameExact = sess.full;                 // always the signed-in person
  var lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch(e) { return {success: false, message: "System is busy. Please try again."}; }

  try {
    const ss = SpreadsheetApp.openById(DELEGATED_SHEET_ID);
    const sheet = ss.getSheetByName('Master');
    if (!sheet) return { success: false, message: "Master sheet not found." };

    const now = new Date();
    const lr = sheet.getLastRow();
    let nextNumber = 1; 
    
    if (lr > 1) {
        const numRowsToInspect = Math.min(lr - 1, 50); 
        const startRow = lr - numRowsToInspect + 1;
        const ids = sheet.getRange(startRow, 2, numRowsToInspect, 1).getValues();
        
        let maxNum = 0;
        for (let i = 0; i < ids.length; i++) {
            const val = String(ids[i][0] || "").trim();
            const num = parseInt(val, 10);
            if (!isNaN(num) && num > maxNum) maxNum = num;
        }
        if (maxNum > 0) nextNumber = maxNum + 1;
    }
    const newId = nextNumber;

    let targetDate = now;
    if (dueDateStr) {
        let parts = dueDateStr.split('-');
        if (parts.length === 3) {
            targetDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), now.getHours(), now.getMinutes());
        }
    }

    const newRow = [
      now, newId, userNameExact, taskTitle, targetDate, "", "", "", "", "", "Self"         
    ];

    let r = sheet.getRange(lr + 1, 1, 1, newRow.length);
    try { r.setValues([newRow]); } catch(e) { r.clearDataValidations(); r.setValues([newRow]); }
    SpreadsheetApp.flush(); _invalidate('delegated');
    return { success: true, taskId: newId };

  } catch (error) { return { success: false, message: error.toString() }; }
  finally { lock.releaseLock(); }
}

// =========================================================================
// NEW AUTOMATION SCRIPTS: NIGHTLY MASTER SYNC & MONTHLY ROLLOVER
// =========================================================================

function syncMMtoMaster() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const mmSheet = ss.getSheetByName("MM");
    const masterSheet = ss.getSheetByName("Master");
    if (!mmSheet || !masterSheet) return;

    // Fetch MM Data (Columns D to L -> index 4 to 12)
    const lrMM = mmSheet.getLastRow();
    if (lrMM < 2) return;
    const mmData = mmSheet.getRange(2, 4, lrMM - 1, 9).getValues(); 

    // Fetch Master IDs to create a fast map
    const lrMaster = masterSheet.getLastRow();
    if (lrMaster < 2) return;
    const masterData = masterSheet.getRange(2, 4, lrMaster - 1, 1).getValues(); 
    
    const masterMap = {};
    for (let i = 0; i < masterData.length; i++) {
        if (masterData[i][0]) {
            masterMap[String(masterData[i][0]).trim().toUpperCase()] = i + 2; 
        }
    }

    // Sync loop
    for (let r = 0; r < mmData.length; r++) {
        let taskId = String(mmData[r][0]).trim().toUpperCase();
        let actualTime = mmData[r][4]; // Col H (Actual Date)
        let status = mmData[r][5];     // Col I (Status)
        let remarkWithFile = mmData[r][8]; // Col L (Remarks & File URL combined)

        // If there is an update to sync
        if (status === "Done" || status === "Completed" || remarkWithFile) {
            let mRow = masterMap[taskId];
            if (mRow) {
                if (actualTime && status) masterSheet.getRange(mRow, 8, 1, 2).setValues([[actualTime, status]]); 
                if (remarkWithFile) masterSheet.getRange(mRow, 12).setValue(remarkWithFile); 
            }
        }
    }
  } catch(e) { console.error("Sync Error: " + e); }
}

function monthlyRolloverMM() {
    try {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        const mmSheet = ss.getSheetByName("MM");
        if (!mmSheet) return;

        const date = new Date();
        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        const newMonth = monthNames[date.getMonth()];
        const newYear = date.getFullYear();

        const lr = mmSheet.getLastRow();
        
        // 1. Clear old month's entries (Columns H to L)
        if (lr > 1) {
            mmSheet.getRange(2, 8, lr - 1, 5).clearContent(); 
        }

        // 2. Set new Month & Year in M2 and N2 
        mmSheet.getRange("M2").setValue(newMonth);
        mmSheet.getRange("N2").setValue(newYear);

    } catch(e) { console.error("Rollover Error: " + e); }
}