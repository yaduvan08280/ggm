const SPREADSHEET_ID = '1tEUckPww1GiD-PgP7yxMxt70W1Q-ueoUGXdI8_-Aq8A';
const SHEET_NAME = 'Master';

// Routine Checklist Sheet IDs
const ROUTINE_JPR_ID = '15KTN4Ptp_K1iRPt3fmssGjC39ttKJx-MFMWOj-SjADg';
const ROUTINE_NEWAI_ID = '1s51ECvMoG-H3wgUsQhGOEmhFjlH_N4ZH4N8-iH1QoJU';
const ROUTINE_TONK_ID = '1FT2ZCdzMIpqw2LQjs5l5zbCX6d1ir5mpm6Bux3dlA3Q';

// Renewal Sheet ID
const RENEWAL_SHEET_ID = '11yqI7704f2OGxQwbK-qo4Ko5G5e0M32LRW73JrzOIIs';

// New Folder ID for Attachments
const DRIVE_FOLDER_ID = '1xrCDCUbliwMSUwDxBO5FTBip9W7KB-sr';

// ==========================================
// PERFORMANCE / RELIABILITY CONFIG
// ==========================================
const MASTER_MAX_COL = 20;   
const ROUTINE_MAX_COL = 12;  

const CACHE_TTL_SECONDS = 20;
const CACHE_KEY_MASTER = 'ggm_master_data_v1';
const CACHE_KEY_JPR = 'ggm_jpr_data_v1';
const CACHE_KEY_NEWAI = 'ggm_newai_data_v1';
const CACHE_KEY_TONK = 'ggm_tonk_data_v1';
const CACHE_KEY_SCORES = 'ggm_scores_data_v1';
const CACHE_KEY_LEAVE = 'ggm_leave_data_v1';
const CACHE_KEY_REN = 'ggm_ren_data_v1';

function _getCache() {
  try { return CacheService.getScriptCache(); } catch (e) { return null; }
}

function _getCached(key) {
  const cache = _getCache();
  if (!cache) return null;
  try {
    const val = cache.get(key);
    return val ? JSON.parse(val) : null;
  } catch (e) { return null; }
}

function _setCached(key, obj) {
  const cache = _getCache();
  if (!cache) return;
  try { cache.put(key, JSON.stringify(obj), CACHE_TTL_SECONDS); } catch (e) {}
}

function _clearCached(key) {
  const cache = _getCache();
  if (!cache) return;
  try { cache.remove(key); } catch (e) { /* ignore */ }
}

function authorizeApp() {
  portalAssertEditor_();
  SpreadsheetApp.openById(SPREADSHEET_ID);
  SpreadsheetApp.openById(ROUTINE_JPR_ID);
  SpreadsheetApp.openById(ROUTINE_NEWAI_ID);
  SpreadsheetApp.openById(ROUTINE_TONK_ID);
  SpreadsheetApp.openById(RENEWAL_SHEET_ID);
  const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  const dummyFile = folder.createFile("dummy_auth_file.txt", "This is just to get permission.");
  dummyFile.setTrashed(true);
  GmailApp.getAliases();
  return "Authorization successful! Full Create/Write permissions granted.";
}

function doGet(e) {
  var gate = portalGate_(e);          // GGM Portal: launch pass / Portal-only (Portal.js)
  if (gate.block) return gate.block;
  return portalInject_(bigUploadPage_(HtmlService.createHtmlOutputFromFile('Index')), gate)   // + 50 MB attachments (BigUpload.js)
    .setTitle('GGM Tasks Dashboard')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// -----------------------------------------------------
// NEW SYSTEM: SINGLE BATCH FETCH
// -----------------------------------------------------
function getDashboardData(token) {
  if (!maSessionOrNull_(token)) return { sessionExpired: true };
  return {
    master: getSheetData_(),
    leaves: getLeaveData_(),
    renewals: getRenewalData_(),
    routineJPR: getRoutineJPRData_(),
    routineNewai: getRoutineNewaiData_(),
    routineTonk: getRoutineTonkData_(),
    scores: getScoresData_()
  };
}

// -----------------------------------------------------
// SYSTEM: RENEWAL MANAGEMENT 
// -----------------------------------------------------
function getRenewalData_() {
  try {
    const cached = _getCached(CACHE_KEY_REN);
    if (cached) return cached;

    const ss = SpreadsheetApp.openById(RENEWAL_SHEET_ID);
    const sheet = ss.getSheetByName('Task Feed');
    if (!sheet) return { error: "Sheet 'Task Feed' not found." };

    const lastRow = sheet.getLastRow();
    if (lastRow < 5) return { rows: [] }; 

    const data = sheet.getRange(5, 1, lastRow - 4, 22).getDisplayValues();

    const rows = data.map((row, index) => {
      return {
        rowNum: index + 5,
        id: row[1] || '',
        category: row[3] || '',
        title: row[4] || '',
        assignee: row[6] || '',
        triggerDate: row[8] || '',
        dueDate: row[9] || '',
        daysLeft: row[10] || '',
        priority: row[11] || '',
        sysExpired: row[12] || '',
        renewedOn: row[13] || '',
        newValid: row[14] || '',
        cost: row[15] || '',
        isDone: row[16] || '',
        docLink: row[19] || '',
        status: row[20] || '',
        remark: row[21] || ''
      };
    }).filter(r => r.id !== ''); 

    const result = { rows: rows }; 
    _setCached(CACHE_KEY_REN, result);
    return result;
  } catch (error) { return { error: error.toString() }; }
}

function actionRenewalTask(token, taskId, action, remarkText) {
  var sess = maSessionOrNull_(token);
  if (!sess) return { success: false, error: 'SESSION_EXPIRED' };
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const ss = SpreadsheetApp.openById(RENEWAL_SHEET_ID);
    const sheet = ss.getSheetByName('Task Feed');
    const idRange = sheet.getRange("B:B"); 
    const finder = idRange.createTextFinder(taskId.toString().trim()).matchEntireCell(true);
    const match = finder.findNext();

    if (!match) return { success: false, error: "Renewal ID not found." };
    const row = match.getRow();

    if (action === 'Approve') {
        sheet.getRange(row, 21).setValue('Completed');
        sheet.getRange(row, 17).setValue(true);
        sheet.getRange(row, 22).setValue('');
    } else if (action === 'Reject') {
        sheet.getRange(row, 21).setValue('Rejected');
        sheet.getRange(row, 17).setValue(false);
        if (remarkText) sheet.getRange(row, 22).setValue(remarkText);
    }
    maStamp_(sheet, row, 4, MA_COLS.RENEWAL_BY, ['Action By', 'Action At'], [sess.u, maNow_()], sess);

    _clearCached(CACHE_KEY_REN);
    return { success: true, message: `Renewal marked as ${action}` };
  } catch (error) { return { success: false, error: error.toString() };
  } finally { lock.releaseLock(); }
}

// -----------------------------------------------------
// SYSTEM: LEAVE MANAGEMENT 
// -----------------------------------------------------
function getLeaveData_() {
  try {
    const cached = _getCached(CACHE_KEY_LEAVE);
    if (cached) return cached;

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName('Leave');
    if (!sheet) return { error: "Sheet 'Leave' not found." };

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { rows: [] };

    const data = sheet.getRange(2, 1, lastRow - 1, 10).getDisplayValues();
    const rows = data.map((row, index) => {
      let statusRaw = row[8] ? row[8].toString().trim() : 'Pending';
      if (statusRaw === '') statusRaw = 'Pending';
      
      return {
        rowNum: index + 2,
        timestamp: row[0] || '',
        employee: row[1] || '',
        reportingTo: row[2] || '',
        leaveType: row[3] || '',
        startDate: row[4] || '',
        endDate: row[5] || '',
        duration: row[6] || '',
        reason: row[7] || '',
        status: statusRaw, 
        remark: row[9] || ''         
      };
    });

    const result = { rows: rows.reverse() }; 
    _setCached(CACHE_KEY_LEAVE, result);
    return result;
  } catch (error) { return { error: error.toString() }; }
}

function updateLeaveStatus(token, rowNum, newStatus, remark) {
  var sess = maSessionOrNull_(token);
  if (!sess) return { success: false, error: 'SESSION_EXPIRED' };
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName('Leave');
    sheet.getRange(rowNum, 9).setValue(newStatus); 
    if (remark !== undefined && remark !== null) {
        sheet.getRange(rowNum, 10).setValue(remark); 
    }
    maStamp_(sheet, rowNum, 1, MA_COLS.LEAVE_BY, ['Decided By', 'Decided At'], [sess.u, maNow_()], sess);
    _clearCached(CACHE_KEY_LEAVE);
    return { success: true, message: `Leave marked as ${newStatus}` };
  } catch (error) { return { success: false, error: error.toString() };
  } finally { lock.releaseLock(); }
}

function getSheetData_() {
  try {
    const cached = _getCached(CACHE_KEY_MASTER);
    if (cached) return cached;
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) return { error: "Sheet 'Master' not found in Main Spreadsheet." };
    const lastRow = sheet.getLastRow();
    const lastCol = Math.min(sheet.getLastColumn(), MASTER_MAX_COL);
    if (lastRow < 1) return { headers: [], rows: [] };

    const data = sheet.getRange(1, 1, lastRow, lastCol).getDisplayValues();
    const result = (data.length === 0) ? { headers: [], rows: [] } : { headers: data[0], rows: data.slice(1) };
    _setCached(CACHE_KEY_MASTER, result);
    return result;
  } catch (error) { return { error: error.toString() }; }
}

function getRoutineJPRData_() {
  try {
    const cached = _getCached(CACHE_KEY_JPR);
    if (cached) return cached;
    const ss = SpreadsheetApp.openById(ROUTINE_JPR_ID);
    const sheet = ss.getSheetByName('Monthly Master');
    if (!sheet) return { error: "JPR 'Monthly Master' sheet not found." };
    const lastRow = sheet.getLastRow();
    const lastCol = Math.min(sheet.getLastColumn(), ROUTINE_MAX_COL);
    if (lastRow < 1) return { headers: [], rows: [] };

    const data = sheet.getRange(1, 1, lastRow, lastCol).getDisplayValues();
    const result = (data.length === 0) ? { headers: [], rows: [] } : { headers: data[0], rows: data.slice(1) };
    _setCached(CACHE_KEY_JPR, result);
    return result;
  } catch (error) { return { error: error.toString() }; }
}

function getRoutineNewaiData_() {
  try {
    const cached = _getCached(CACHE_KEY_NEWAI);
    if (cached) return cached;
    const ss = SpreadsheetApp.openById(ROUTINE_NEWAI_ID);
    const sheet = ss.getSheetByName('Monthly Master');
    if (!sheet) return { error: "Newai 'Monthly Master' sheet not found." };
    const lastRow = sheet.getLastRow();
    const lastCol = Math.min(sheet.getLastColumn(), ROUTINE_MAX_COL);
    if (lastRow < 1) return { headers: [], rows: [] };

    const data = sheet.getRange(1, 1, lastRow, lastCol).getDisplayValues();
    const result = (data.length === 0) ? { headers: [], rows: [] } : { headers: data[0], rows: data.slice(1) };
    _setCached(CACHE_KEY_NEWAI, result);
    return result;
  } catch (error) { return { error: error.toString() }; }
}

function getRoutineTonkData_() {
  try {
    const cached = _getCached(CACHE_KEY_TONK);
    if (cached) return cached;
    const ss = SpreadsheetApp.openById(ROUTINE_TONK_ID);
    const sheet = ss.getSheetByName('Monthly Master');
    if (!sheet) return { error: "Tonk 'Monthly Master' sheet not found." };
    const lastRow = sheet.getLastRow();
    const lastCol = Math.min(sheet.getLastColumn(), ROUTINE_MAX_COL);
    if (lastRow < 1) return { headers: [], rows: [] };

    const data = sheet.getRange(1, 1, lastRow, lastCol).getDisplayValues();
    const result = (data.length === 0) ? { headers: [], rows: [] } : { headers: data[0], rows: data.slice(1) };
    _setCached(CACHE_KEY_TONK, result);
    return result;
  } catch (error) { return { error: error.toString() }; }
}

function getScoresData_() {
  try {
    const cached = _getCached(CACHE_KEY_SCORES);
    if (cached) return cached;

    function fetchSummary(ssId) {
      try {
        const ss = SpreadsheetApp.openById(ssId);
        const sheet = ss.getSheetByName('SUMMARY');
        if (!sheet) return [];
        const lastRow = sheet.getLastRow();
        if (lastRow < 2) return []; 
        return sheet.getRange(2, 3, lastRow - 1, 10).getDisplayValues(); 
      } catch(e) { return []; }
    }
    const result = {
      JPR: fetchSummary(ROUTINE_JPR_ID),
      NEWAI: fetchSummary(ROUTINE_NEWAI_ID),
      TONK: fetchSummary(ROUTINE_TONK_ID)
    };
    _setCached(CACHE_KEY_SCORES, result);
    return result;
  } catch (error) { return { error: error.toString() }; }
}

function markRoutineDone(token, taskId, location) {
  var sess = maSessionOrNull_(token);
  if (!sess) return { success: false, error: 'SESSION_EXPIRED' };
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    let ssId, cacheKey;
    if (location === 'NEWAI') { ssId = ROUTINE_NEWAI_ID; cacheKey = CACHE_KEY_NEWAI; }
    else if (location === 'TONK') { ssId = ROUTINE_TONK_ID; cacheKey = CACHE_KEY_TONK; }
    else { ssId = ROUTINE_JPR_ID; cacheKey = CACHE_KEY_JPR; }

    const ss = SpreadsheetApp.openById(ssId);
    const sheetsToUpdate = ['Master', 'Monthly Master'];
    let updatedCount = 0;
    const today = new Date();
    const formattedDate = Utilities.formatDate(today, "GMT+05:30", "dd/MM/yyyy HH:mm");

    sheetsToUpdate.forEach(sheetName => {
      const sheet = ss.getSheetByName(sheetName);
      if (sheet) {
        const idRange = sheet.getRange("D:D"); 
        const finder = idRange.createTextFinder(taskId.toString().trim()).matchEntireCell(true);
        const match = finder.findNext();
        if (match) {
          const row = match.getRow();
          sheet.getRange(row, 8, 1, 2).setValues([[formattedDate, "Done"]]);
          maStamp_(sheet, row, 1, MA_COLS.ROUTINE_BY, ['Marked By', 'Marked At'], [sess.u, maNow_()], sess);
          updatedCount++;
        } else {
          const data = sheet.getRange(1, 4, sheet.getLastRow(), 1).getValues();
          for (let i = 1; i < data.length; i++) {
            if (data[i][0] !== "" && data[i][0].toString().trim() === taskId.toString().trim()) {
              sheet.getRange(i + 1, 8, 1, 2).setValues([[formattedDate, "Done"]]);
              maStamp_(sheet, i + 1, 1, MA_COLS.ROUTINE_BY, ['Marked By', 'Marked At'], [sess.u, maNow_()], sess);
              updatedCount++;
              break;
            }
          }
        }
      }
    });

    if (updatedCount > 0) {
      _clearCached(cacheKey);
      return { success: true, message: `Task Done in ${location} successfully!` };
    } else {
      return { success: false, error: "Task ID not found in sheet. Please verify ID." };
    }
  } catch (error) { return { success: false, error: error.toString() };
  } finally { lock.releaseLock(); }
}

function generateNextTaskId(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return "TK-101";
  const data = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
  let maxId = 100;
  for (let i = 0; i < data.length; i++) {
    const val = data[i][0].toString().trim();
    const match = val.match(/TK-(\d+)/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxId) maxId = num;
    }
  }
  return "TK-" + (maxId + 1);
}

function addNewTask(token, doerName, taskText, dueDate, givenBy, fileDataArray) {
  var sess = maSessionOrNull_(token);
  if (!sess) return { success: false, error: 'SESSION_EXPIRED' };
  const lock = LockService.getScriptLock();
  if (!sess.legacy) {
    givenBy = sess.u;                                   // who assigns = who is signed in
    if (!maDoerAllowed_(doerName)) return { success: false, error: "'" + doerName + "' is not a GGM Portal user with the Staff Dashboard." };
  }
  try {
    lock.waitLock(20000); 
    let attachmentUrls = [];
    if (fileDataArray && fileDataArray.length > 0) {
       try {
           const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
           for (let i = 0; i < fileDataArray.length; i++) {
               let f = fileDataArray[i];
               if (f && f.fileId) { attachmentUrls.push(bigUploadTake_(f, folder)); continue; }   // over 5 MB: already in Drive (BigUpload.js)
               let safeMimeType = (f.mimeType && f.mimeType.trim() !== "") ? f.mimeType : "application/octet-stream";
               let safeFilename = f.filename || ("Attachment_" + (i + 1));
               let decodedBytes = Utilities.base64Decode(f.base64);
               let blob = Utilities.newBlob(decodedBytes, safeMimeType, safeFilename);
               let file = folder.createFile(blob);
               try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch(shareErr) { }
               attachmentUrls.push(file.getUrl());
           }
       } catch (driveError) {
           let errStr = driveError.toString();
           if (errStr.includes("Access denied") || errStr.includes("permission")) {
               return { success: false, error: "Google Drive Access Denied!\n\n1. Try opening App in Incognito Mode.\n2. Ensure App Deployment is 'Execute as: Me'." };
           }
           return { success: false, error: "Drive Upload Failed: " + errStr };
       }
    }

    let attachmentString = attachmentUrls.join(',');
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);
    const timestamp = Utilities.formatDate(new Date(), "GMT+05:30", "dd/MM/yyyy HH:mm:ss");
    const nextTaskId = generateNextTaskId(sheet);

    const newRow = [
      timestamp, nextTaskId, doerName, taskText, "", "", "", "", "", "Pending",
      givenBy, attachmentString, "", "", "", "", "", ""
    ];
    sheet.appendRow(newRow);

    const newRowNum = sheet.getLastRow();
    sheet.getRange(newRowNum, 5).setNumberFormat('@STRING@').setValue(dueDate);
    maStamp_(sheet, newRowNum, 1, MA_COLS.MASTER_CREATED, ['Created By', 'Last Action', 'Last Action By', 'Last Action At'],
             [sess.u, 'Created', sess.u, maNow_()], sess);

    _clearCached(CACHE_KEY_MASTER);
    return { success: true, message: "Task " + nextTaskId + " created successfully!" };
  } catch (error) { return { success: false, error: error.toString() };
  } finally { lock.releaseLock(); }
}

// ==========================================
// SYSTEM: TRANSFER TASK (Leave & Reassignment)
// ==========================================
function transferTask(token, taskId, newDoerName, newDueDate, transferReason) {
  var sess = maSessionOrNull_(token);
  if (!sess) return { success: false, error: 'SESSION_EXPIRED' };
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    if (!newDoerName) return { success: false, error: "Please select a new assignee." };
    if (!sess.legacy && !maDoerAllowed_(newDoerName)) {
      return { success: false, error: "'" + newDoerName + "' is not a Portal user." };
    }

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);
    const idRange = sheet.getRange("B:B");
    const finder = idRange.createTextFinder(taskId.toString().trim()).matchEntireCell(true);
    const match = finder.findNext();
    if (!match) return { success: false, error: "Task ID not found." };

    const row = match.getRow();
    const oldDoerRaw = sheet.getRange(row, 3).getDisplayValue();
    const oldCleanName = getCleanName(oldDoerRaw);
    const newCleanName = getCleanName(newDoerName);

    const timestamp = Utilities.formatDate(new Date(), "GMT+05:30", "dd/MM/yyyy HH:mm");
    const reasonText = transferReason ? " | Reason: " + transferReason.trim() : "";
    const transferLog = "Transferred from " + oldCleanName + " to " + newCleanName + " on " + timestamp + reasonText;

    // Update Assignee
    sheet.getRange(row, 3).setValue(newDoerName);

    // Update Due Date if provided
    if (newDueDate && newDueDate.trim() !== "") {
      sheet.getRange(row, 5).setNumberFormat('@STRING@').setValue(newDueDate.trim());
    }

    // Reset status to Pending for new assignee
    sheet.getRange(row, 10).setValue("Pending");

    // Append Transfer History to Extra Remark
    const existingHistory = sheet.getRange(row, 17).getDisplayValue().trim();
    const updatedHistory = existingHistory ? (existingHistory + "\n" + transferLog) : transferLog;
    sheet.getRange(row, 17).setValue(updatedHistory);

    maStampAction_(sheet, row, "Transferred to " + newCleanName, sess);

    _clearCached(CACHE_KEY_MASTER);
    return {
      success: true,
      message: "Task " + taskId + " successfully transferred to " + newCleanName
    };
  } catch (error) {
    return { success: false, error: error.toString() };
  } finally { lock.releaseLock(); }
}

function editTask(token, taskId, newDoerName, newTaskText, newDueDate) {
  var sess = maSessionOrNull_(token);
  if (!sess) return { success: false, error: 'SESSION_EXPIRED' };
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);
    const idRange = sheet.getRange("B:B");
    const finder = idRange.createTextFinder(taskId.toString().trim()).matchEntireCell(true);
    const match = finder.findNext();
    if (!match) return { success: false, error: "Task ID not found." };
    if (newDoerName && !sess.legacy && !maDoerAllowed_(newDoerName)) return { success: false, error: "'" + newDoerName + "' is not a GGM Portal user with the Staff Dashboard." };
    
    const row = match.getRow();
    maStampAction_(sheet, row, 'Edited', sess);
    if (newDoerName)  sheet.getRange(row, 3).setValue(newDoerName);
    if (newTaskText)  sheet.getRange(row, 4).setValue(newTaskText);
    if (newDueDate)   sheet.getRange(row, 5).setNumberFormat('@STRING@').setValue(newDueDate);

    _clearCached(CACHE_KEY_MASTER);
    return { success: true, message: "Task " + taskId + " updated successfully!" };
  } catch (error) { return { success: false, error: error.toString() };
  } finally { lock.releaseLock(); }
}

function updateTaskStatusById(token, taskId, newStatus) {
  var sess = maSessionOrNull_(token);
  if (!sess) return { success: false, error: 'SESSION_EXPIRED' };
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);
    const idRange = sheet.getRange("B:B");
    const finder = idRange.createTextFinder(taskId.toString().trim()).matchEntireCell(true);
    const match = finder.findNext();
    if (!match) return { success: false, error: "Task ID not found." };

    const row = match.getRow();
    const dateStr = Utilities.formatDate(new Date(), "GMT+05:30", "dd/MM/yyyy HH:mm:ss");

    sheet.getRange(row, 10).setValue(newStatus); 
    sheet.getRange(row, 18).setValue(dateStr);   
    maStampAction_(sheet, row, 'Status: ' + newStatus, sess);
    if (newStatus === "Completed") {
        sheet.getRange(row, 8).setValue(dateStr); 
        sheet.getRange(row, 14).setValue("");     
    }
    _clearCached(CACHE_KEY_MASTER);
    return { success: true, message: "Task " + taskId + " updated to " + newStatus };
  } catch (error) { return { success: false, error: error.toString() };
  } finally { lock.releaseLock(); }
}

function rejectTaskByBoss(token, taskId, remark) {
  var sess = maSessionOrNull_(token);
  if (!sess) return { success: false, error: 'SESSION_EXPIRED' };
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);
    const idRange = sheet.getRange("B:B");
    const finder = idRange.createTextFinder(taskId.toString().trim()).matchEntireCell(true);
    const match = finder.findNext();
    if (!match) return { success: false, error: "Task ID not found." };

    const row = match.getRow();
    const dateStr = Utilities.formatDate(new Date(), "GMT+05:30", "dd/MM/yyyy HH:mm:ss");

    sheet.getRange(row, 10).setValue("Rejected");
    sheet.getRange(row, 14).setValue(remark);
    sheet.getRange(row, 18).setValue(dateStr); 
    maStampAction_(sheet, row, 'Rejected', sess);

    _clearCached(CACHE_KEY_MASTER);
    return { success: true, message: "Task " + taskId + " rejected." };
  } catch (error) { return { success: false, error: error.toString() };
  } finally { lock.releaseLock(); }
}

function getDoerList(token) {
  var sess = maSessionOrNull_(token);
  if (!sess) return { error: 'SESSION_EXPIRED' };
  // Connected to GGM Portal: "Assign to" = every active portal user who has the Staff Dashboard.
  if (!sess.legacy) {
    try { return { doers: maPortalDoers_() }; } catch (e) { console.error('maPortalDoers_: ' + e); }
  }
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName('Doer List');
    if (!sheet) return { error: "Sheet 'Doer List' not found." };
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { doers: [] };

    const data = sheet.getRange(2, 4, lastRow - 1, 1).getValues();
    const doersArray = [];
    data.forEach(row => {
      const name = row[0] ? row[0].toString().trim() : "";
      if (name) doersArray.push(name);
    });
    return { doers: [...new Set(doersArray)].sort((a, b) => a.localeCompare(b)) };
  } catch (error) { return { error: error.toString() }; }
}

function getCleanName(rawString) {
  if (!rawString) return 'Unassigned';
  let str = rawString.toString().trim();
  str = str.replace(/^([A-Z]{2,4})\s*-\s*/, '');
  str = str.replace(/\s*-\s*(\d{10,12})$/, '');
  str = str.replace(/\s*\(([^)]+)\)$/, '');
  return str.trim() || rawString;
}

function getLastWeekRange() {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const daysToLastMonday = (dayOfWeek === 0 ? 6 : dayOfWeek - 1) + 7;
  const lastMonday = new Date(today);
  lastMonday.setDate(today.getDate() - daysToLastMonday);
  lastMonday.setHours(0, 0, 0, 0);
  const lastSaturday = new Date(lastMonday);
  lastSaturday.setDate(lastMonday.getDate() + 5);
  lastSaturday.setHours(23, 59, 59, 999);
  return { start: lastMonday, end: lastSaturday };
}

function parseSheetDate(dateStr) {
  if (!dateStr) return null;
  let s = dateStr.toString().trim().split(' ')[0];
  let m = s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) return new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
  let d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  return null;
}

// -----------------------------------------------------
// REPORT SYSTEM (FULL HTML + PDF BLOB)
// -----------------------------------------------------
function _buildReportHtml(staffArray, overallTotal, overallOverdue, overallUpcoming, displayStart, displayEnd) {
  const mostOverdue  = [...staffArray].sort((a, b) => b.overdue  - a.overdue ).slice(0, 3);
  const mostUpcoming = [...staffArray].sort((a, b) => b.upcoming - a.upcoming).slice(0, 3);

  const css = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 13px; color: #1a1a2e; background: #ffffff; }
    .page { width: 100%; padding: 36px 44px; page-break-after: always; }
    .page:last-child { page-break-after: avoid; }
    .report-header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #1565C0; padding-bottom: 12px; margin-bottom: 24px; }
    .brand-name { font-size: 22px; font-weight: 800; letter-spacing: 2px; color: #1565C0; text-transform: uppercase; }
    .brand-sub { font-size: 13px; color: #555; margin-top: 3px; letter-spacing: 0.5px; }
    .report-meta { text-align: right; font-size: 12px; color: #777; line-height: 1.6; }
    .report-meta strong { display: block; font-size: 14px; font-weight: 700; color: #1565C0; letter-spacing: 0.3px; }
    .section-title { font-size: 11px; font-weight: 700; letter-spacing: 1.8px; text-transform: uppercase; color: #888; margin-bottom: 10px; }
    .kpi-strip { display: flex; gap: 0; border: 1.5px solid #E0E4EF; border-radius: 6px; overflow: hidden; margin-bottom: 26px; }
    .kpi-cell { flex: 1; padding: 14px 18px; border-right: 1.5px solid #E0E4EF; background: #F7F9FF; }
    .kpi-cell:last-child { border-right: none; }
    .kpi-label { font-size: 10px; letter-spacing: 1.2px; text-transform: uppercase; color: #888; margin-bottom: 6px; }
    .kpi-value { font-size: 26px; font-weight: 800; line-height: 1; }
    .kpi-value.blue   { color: #1565C0; }
    .kpi-value.green  { color: #1B5E20; }
    .kpi-value.red    { color: #B71C1C; }
    .kpi-value.gold   { color: #E65100; }
    .kpi-value.slate  { color: #1a1a2e; }
    .leader-row { display: flex; gap: 14px; margin-bottom: 26px; }
    .leader-card { flex: 1; border-radius: 6px; padding: 14px 16px; }
    .leader-card.top    { background: #E8F5E9; border: 1.5px solid #A5D6A7; }
    .leader-card.bottom { background: #FFF3E0; border: 1.5px solid #FFCC80; }
    .leader-card-title { font-size: 11px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase; margin-bottom: 10px; color: #555; }
    .leader-item { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid rgba(0,0,0,0.07); }
    .leader-item:last-child { border-bottom: none; }
    .leader-rank { font-size: 11px; font-weight: 700; color: #aaa; width: 22px; flex-shrink: 0; }
    .leader-name  { flex: 1; font-size: 13px; font-weight: 600; color: #222; }
    .leader-score { font-size: 15px; font-weight: 800; }
    .leader-score.green { color: #2E7D32; }
    .leader-score.amber { color: #E65100; }
    .overview-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .overview-table th { background: #1565C0; color: #fff; font-size: 10px; letter-spacing: 1px; text-transform: uppercase; padding: 9px 11px; text-align: left; font-weight: 600; }
    .overview-table td { padding: 8px 11px; border-bottom: 1px solid #ECEFF4; vertical-align: middle; }
    .overview-table tr:nth-child(even) td { background: #F7F9FF; }
    .overview-table tr:hover td          { background: #EEF2FF; }
    .staff-header { display: flex; justify-content: space-between; align-items: center; border-left: 4px solid #1565C0; padding: 10px 0 10px 14px; margin-bottom: 18px; }
    .staff-name  { font-size: 20px; font-weight: 800; color: #1a1a2e; text-transform: uppercase; }
    .staff-label { font-size: 11px; letter-spacing: 1px; text-transform: uppercase; color: #888; margin-top: 2px; }
    .staff-score-wrap { display: flex; gap: 24px; align-items: center; text-align: center; }
    .staff-score-num  { font-size: 32px; font-weight: 900; line-height: 1; }
    .staff-score-txt  { font-size: 10px; letter-spacing: 0.8px; text-transform: uppercase; color: #888; margin-top: 4px;}
    .mini-kpi { display: flex; gap: 0; border: 1px solid #E0E4EF; border-radius: 5px; overflow: hidden; margin-bottom: 20px; }
    .mini-kpi-cell { flex: 1; padding: 10px 14px; border-right: 1px solid #E0E4EF; background: #F7F9FF; }
    .mini-kpi-cell:last-child { border-right: none; }
    .mini-kpi-label { font-size: 10px; letter-spacing: 1px; text-transform: uppercase; color: #999; margin-bottom: 4px; }
    .mini-kpi-val   { font-size: 22px; font-weight: 800; }
    .task-section-title { font-size: 11px; font-weight: 700; letter-spacing: 1.4px; text-transform: uppercase; padding: 7px 12px; margin-bottom: 0; }
    .task-section-title.pending { background: #1a1a2e; color: #fff; }
    .task-table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 18px; }
    .task-table th { background: #F0F2FA; padding: 8px 10px; font-size: 10px; letter-spacing: 1px; text-transform: uppercase; color: #555; font-weight: 700; text-align: left; border-bottom: 2px solid #CDD4E8; }
    .task-table td { padding: 8px 10px; border-bottom: 1px solid #ECEFF4; vertical-align: top; color: #333; }
    .task-table tr:nth-child(even) td { background: #FAFBFF; }
    .task-id { font-family: 'Courier New', monospace; font-size: 11px; color: #1565C0; font-weight: 700; white-space: nowrap; }
    .status-pending { color: #B71C1C; font-weight: 700; }
    .no-tasks       { padding: 14px 10px; font-size: 12px; color: #aaa; font-style: italic; }
    .page-footer { margin-top: 24px; padding-top: 10px; border-top: 1px solid #E0E4EF; display: flex; justify-content: space-between; font-size: 10px; color: #bbb; }
  `;

  function scoreColor(s) {
    if (s === '-') return '#888888';
    if (s >= 70) return '#2E7D32'; 
    if (s >= 40) return '#E65100'; 
    return '#B71C1C'; 
  }
  function fmtScore(s) {
    return s === '-' ? 'N/A' : s + '%';
  }
  function footer(label) {
    return `<div class="page-footer"><span>GGM Minerals</span><span>${label}</span><span>Generated: ${new Date().toLocaleString('en-IN')}</span></div>`;
  }

  let html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${css}</style></head><body>`;

  html += `<div class="page">
    <div class="report-header">
      <div><div class="brand-name">GGM Minerals</div><div class="brand-sub">Master Executive Summary Report</div></div>
      <div class="report-meta"><strong>Report Period</strong>${displayStart} &nbsp;→&nbsp; ${displayEnd}</div>
    </div>
    <div class="section-title">Pending &amp; Shifted Tasks Snapshot</div>
    <div class="kpi-strip">
      <div class="kpi-cell"><div class="kpi-label">Staff with Open Tasks</div><div class="kpi-value slate">${staffArray.length}</div></div>
      <div class="kpi-cell"><div class="kpi-label">Total Open Tasks</div><div class="kpi-value blue">${overallTotal}</div></div>
      <div class="kpi-cell"><div class="kpi-label">Overdue</div><div class="kpi-value red">${overallOverdue}</div></div>
      <div class="kpi-cell"><div class="kpi-label">Due This Week</div><div class="kpi-value gold">${overallUpcoming}</div></div>
    </div>
    <div class="leader-row">
      <div class="leader-card bottom">
        <div class="leader-card-title">🚨 &nbsp;Most Overdue Tasks</div>
        ${mostOverdue.map((p, i) => `<div class="leader-item"><span class="leader-rank">#${i + 1}</span><span class="leader-name">${p.name}</span><span class="leader-score amber">${p.overdue} overdue</span></div>`).join('')}
      </div>
      <div class="leader-card top">
        <div class="leader-card-title">📅 &nbsp;Most Due This Week</div>
        ${mostUpcoming.map((p, i) => `<div class="leader-item"><span class="leader-rank">#${i + 1}</span><span class="leader-name">${p.name}</span><span class="leader-score green">${p.upcoming} upcoming</span></div>`).join('')}
      </div>
    </div>
    <div class="section-title">Team Task Summary</div>
    <table class="overview-table">
      <thead><tr><th style="width:4%">#</th><th style="width:20%">Staff Member</th><th style="width:11%; text-align:center">Pending</th><th style="width:11%; text-align:center">Shifted</th><th style="width:11%; text-align:center">Overdue</th><th style="width:13%; text-align:center">Due This Wk</th><th style="width:10%; text-align:center">Open</th><th style="width:10%; text-align:center">W-Score</th><th style="width:10%; text-align:center">M-Score</th></tr></thead>
      <tbody>
        ${[...staffArray].sort((a, b) => b.overdue - a.overdue || b.upcoming - a.upcoming).map((s, i) => {
          const pendingOnly = s.total - (s.overdue || 0) - (s.upcoming || 0);
          const shifted = (s.overdue || 0) + (s.upcoming || 0);
          return `<tr><td style="color:#aaa; font-size:10px; font-weight:700">${i + 1}</td><td style="font-weight:600">${s.name}</td><td style="text-align:center; font-weight:700; color:#1565C0">${pendingOnly}</td><td style="text-align:center; font-weight:700; color:#c62828">${shifted}</td><td style="text-align:center; font-weight:700; color:#B71C1C">${s.overdue || 0}</td><td style="text-align:center; font-weight:700; color:#E65100">${s.upcoming || 0}</td><td style="text-align:center; font-weight:700; color:#333">${s.total}</td><td style="text-align:center; font-weight:800; color:${scoreColor(s.weeklyScore)}">${fmtScore(s.weeklyScore)}</td><td style="text-align:center; font-weight:800; color:${scoreColor(s.monthlyScore)}">${fmtScore(s.monthlyScore)}</td></tr>`;
        }).join('')}
      </tbody>
    </table>
    ${footer('Executive Summary — Page 1')}
  </div>`;

  [...staffArray].sort((a, b) => a.name.localeCompare(b.name)).forEach((staff, pageIdx) => {
    const pendingList  = staff.tasks.filter(t => !t.isOverdue && !t.isUpcoming);
    const shiftedList  = staff.tasks
      .filter(t => (t.isOverdue || t.isUpcoming))
      .sort((a, b) => {
        const da = a.due ? new Date(a.due.split('/').reverse().join('-')) : new Date(9e15);
        const db = b.due ? new Date(b.due.split('/').reverse().join('-')) : new Date(9e15);
        return da - db;
      });

    html += `<div class="page">
      <div class="staff-header" style="border-left: 4px solid #1a1a2e; padding: 5px 0 5px 14px;">
        <div><div class="staff-name">${staff.name}</div><div class="staff-label">PENDING & WEEK-SHIFTED TASK BREAKDOWN</div></div>
        <div class="staff-score-wrap">
          <div><div class="staff-score-num" style="color:${scoreColor(staff.weeklyScore)}">${fmtScore(staff.weeklyScore)}</div><div class="staff-score-txt">WEEKLY SCORE</div></div>
          <div><div class="staff-score-num" style="color:${scoreColor(staff.monthlyScore)}">${fmtScore(staff.monthlyScore)}</div><div class="staff-score-txt">MONTHLY SCORE</div></div>
          <div style="border-left: 2px solid #E0E4EF; padding-left: 20px;"><div class="staff-score-num" style="color:#1a1a2e">${staff.total}</div><div class="staff-score-txt">OPEN TASKS</div></div>
        </div>
      </div>
      <div class="mini-kpi">
        <div class="mini-kpi-cell"><div class="mini-kpi-label">PENDING</div><div class="mini-kpi-val" style="color:#1565C0">${pendingList.length}</div></div>
        <div class="mini-kpi-cell"><div class="mini-kpi-label">WEEK SHIFTED</div><div class="mini-kpi-val" style="color:#B71C1C">${shiftedList.length}</div></div>
        <div class="mini-kpi-cell"><div class="mini-kpi-label">OVERDUE</div><div class="mini-kpi-val" style="color:#c62828">${staff.overdue || 0}</div></div>
        <div class="mini-kpi-cell"><div class="mini-kpi-label">DUE THIS WEEK</div><div class="mini-kpi-val" style="color:#E65100">${staff.upcoming || 0}</div></div>
      </div>

      <div class="task-section-title" style="background:transparent; color:#888; font-size:11px; font-weight:700; letter-spacing:1.4px; text-transform:uppercase; padding:10px 0; border-bottom: 1px solid #E0E4EF; margin-bottom:10px;">⏳ &nbsp;PENDING TASKS &nbsp;(${pendingList.length})</div>
      ${pendingList.length > 0 ? `
        <table class="task-table">
          <thead><tr><th style="width:11%; text-align:center">Creation Dt</th><th style="width:10%">Task ID</th><th style="width:38%">Description</th><th style="width:11%; text-align:center">Due Dt</th><th style="width:15%; text-align:center">Status</th><th style="width:15%">Given By</th></tr></thead>
          <tbody>
            ${pendingList.map(t => `<tr><td style="text-align:center; font-weight:600; color:#555">${t.givenDate || '—'}</td><td class="task-id">${t.id || '—'}</td><td style="white-space:pre-wrap;">${t.desc || '—'}</td><td style="text-align:center; font-weight:600; color:#B71C1C">${t.due || '—'}</td><td style="text-align:center; font-weight:700; color:#333;">${t.status === 'review' ? 'Review' : 'Pending'}</td><td style="font-weight:600; color:#444">${t.givenBy || '—'}</td></tr>`).join('')}
          </tbody>
        </table>` : `<div class="no-tasks">No general pending tasks.</div>`}

      <div class="task-section-title" style="background:transparent; color:#888; font-size:11px; font-weight:700; letter-spacing:1.4px; text-transform:uppercase; padding:10px 0; border-bottom: 1px solid #E0E4EF; margin-bottom:10px; margin-top:20px;">🚨 &nbsp;WEEK SHIFTED (OVERDUE & DUE THIS WEEK) &nbsp;(${shiftedList.length})</div>
      ${shiftedList.length > 0 ? `
        <table class="task-table">
          <thead><tr><th style="width:11%; text-align:center">Creation Dt</th><th style="width:10%">Task ID</th><th style="width:38%">Description</th><th style="width:11%; text-align:center">Due Dt</th><th style="width:15%; text-align:center">Status</th><th style="width:15%">Given By</th></tr></thead>
          <tbody>
            ${shiftedList.map(t => `<tr><td style="text-align:center; font-weight:600; color:#555">${t.givenDate || '—'}</td><td class="task-id">${t.id || '—'}</td><td style="white-space:pre-wrap;">${t.desc || '—'}</td><td style="text-align:center; font-weight:700; color:${t.isOverdue ? '#B71C1C' : '#E65100'}">${t.due || '—'}</td><td style="text-align:center; font-weight:700; color:#333;">${t.status === 'review' ? 'Review' : (t.status === 'rejected' ? 'Rejected' : (t.isOverdue ? 'Overdue' : 'Week Shifted'))}</td><td style="font-weight:600; color:#444">${t.givenBy || '—'}</td></tr>`).join('')}
          </tbody>
        </table>` : `<div class="no-tasks">No week-shifted tasks.</div>`}
      ${footer(`Task Report — ${staff.name}`)}
    </div>`;
  });
  html += `</body></html>`;
  return html;
}

function buildDataForReport_(startDateObj, endDateObj) {
  const rawData = getSheetData_();
  if (rawData.error || !rawData.rows) return { staffArray: [], overallTotal: 0, overallOverdue: 0, overallUpcoming: 0 };
  let staffMap = {}; let overallTotal = 0; let overallOverdue = 0; let overallUpcoming = 0;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const nextWeek = new Date(now); nextWeek.setDate(now.getDate() + 7);

  rawData.rows.forEach(row => {
    const id = row[1] ? row[1].toString().trim() : '';
    const doerRaw = row[2] ? row[2].toString().trim() : '';
    const taskDesc = row[3] ? row[3].toString().trim() : '';
    const givenDate = row[0] ? row[0].toString().split(' ')[0] : '';
    const dueStr = row[4] ? row[4].toString().trim() : '';
    const statusRaw = row[9] ? row[9].toString().toLowerCase() : '';
    const givenBy = row[10] ? row[10].toString().trim() : '';

    if (!doerRaw && !taskDesc) return;
    let isCompleted = statusRaw.includes('done') || statusRaw.includes('complet');
    if (isCompleted) return;

    let cleanName = getCleanName(doerRaw);
    if (!staffMap[cleanName]) {
      staffMap[cleanName] = { name: cleanName, total: 0, overdue: 0, upcoming: 0, weeklyScore: '-', monthlyScore: '-', tasks: [] };
    }

    let dueObj = parseSheetDate(dueStr);
    let isOverdue = false; let isUpcoming = false;
    if (dueObj) {
      if (dueObj < now) isOverdue = true;
      else if (dueObj >= now && dueObj <= nextWeek) isUpcoming = true;
    }

    staffMap[cleanName].tasks.push({
      id: id, givenBy: givenBy, desc: taskDesc, givenDate: givenDate, due: dueStr,
      status: statusRaw, isOverdue: isOverdue, isUpcoming: isUpcoming
    });

    staffMap[cleanName].total++; overallTotal++;
    if (isOverdue) { staffMap[cleanName].overdue++; overallOverdue++; }
    if (isUpcoming) { staffMap[cleanName].upcoming++; overallUpcoming++; }
  });

  let staffArray = Object.values(staffMap).filter(s => s.tasks.length > 0);

  try {
    const scores = getScoresData_();
    staffArray.forEach(staff => {
      ['JPR', 'NEWAI', 'TONK'].forEach(loc => {
        if (scores[loc] && scores[loc].length > 1) {
          for (let i = 1; i < scores[loc].length; i++) {
            if (scores[loc][i][0] && getCleanName(scores[loc][i][0]) === staff.name) {
              staff.weeklyScore = parseInt(scores[loc][i][1]) || '-';
              staff.monthlyScore = parseInt(scores[loc][i][2]) || '-';
            }
          }
        }
      });
    });
  } catch (e) { /* Ignore score fetch errors */ }
  return { staffArray, overallTotal, overallOverdue, overallUpcoming };
}

function generateWeeklyPDFBlob_(startDateStr, endDateStr) {
  let startObj, endObj;
  if (startDateStr && endDateStr) {
    startObj = new Date(startDateStr); endObj = new Date(endDateStr);
  } else {
    const range = getLastWeekRange(); startObj = range.start; endObj = range.end;
  }
  startObj.setHours(0, 0, 0, 0); endObj.setHours(23, 59, 59, 999);

  const displayStart = Utilities.formatDate(startObj, "GMT+05:30", "dd/MM/yyyy");
  const displayEnd = Utilities.formatDate(endObj, "GMT+05:30", "dd/MM/yyyy");

  const reportData = buildDataForReport_(startObj, endObj);
  const htmlContent = _buildReportHtml(reportData.staffArray, reportData.overallTotal, reportData.overallOverdue, reportData.overallUpcoming, displayStart, displayEnd);

  const blob = Utilities.newBlob(htmlContent, 'text/html', 'GGM_Report.html');
  const filename = `GGM_Master_Report_${displayStart.replace(/\//g, '-')}.pdf`;
  return blob.getAs('application/pdf').setName(filename);
}

function manualSendEmail_(targetEmail, startDate, endDate) {
  try {
    const pdfBlob = generateWeeklyPDFBlob_(startDate, endDate);
    GmailApp.sendEmail(targetEmail, "GGM Minerals - Master Executive Summary", "Hello Boss,\n\nPlease find attached the Performance Report.\n\nThis report contains only the active open/overdue tasks for each employee.\n\nRegards,\nGGM Task Dashboard System", { attachments: [pdfBlob] });
    return { success: true, message: `Report sent successfully to ${targetEmail}!` };
  } catch (error) { return { success: false, error: error.toString() }; }
}

function automatedWeeklyEmail() { 
    manualSendEmail_("marketingggm953@gmail.com", null, null); 
}

function manualDownloadPDF_(startDate, endDate) {
  try {
    const pdfBlob = generateWeeklyPDFBlob_(startDate, endDate); 
    const base64Str = Utilities.base64Encode(pdfBlob.getBytes());
    const filename = pdfBlob.getName();
    return { success: true, base64: base64Str, filename: filename };
  } catch (error) { return { success: false, error: error.toString() }; }
}

function setupAutomaticWeeklyEmail() {
  portalAssertEditor_();
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("automatedWeeklyEmail")
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(9)
    .create();
}