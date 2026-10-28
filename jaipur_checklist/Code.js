/**
 * =========================================================================
 * GGM WORKSPACE - COMPLETE BULLETPROOF SYSTEM V16.4 
 * (Updated: Manual Monthly Master Refresh, 7 PM Daily Sync, No Deletion)
 * =========================================================================
 */

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('GGM Checklist')
    .addItem('🚀 Sync & Submit Updates', 'submitButtonClicked')
    .addItem('🔄 Force Sync Missing Tasks', 'forceSyncMissingTasks')
    .addItem('🧹 Clean Duplicates & Orphans', 'cleanMasterSheets')
    .addItem('🔄 Refresh Monthly Master', 'updateMonthlyMaster') // Manual Refresh Button
    .addItem('👥 Assign Buddy', 'showAssignBuddyDialog')
    .addItem('⚙️ Setup Setup Time (Reminders)', 'setTrigger')
    .addItem('⚙️ Setup 7 PM Daily Sync', 'setupEveningSyncTrigger') // 7 PM Trigger Setup
    .addToUi();
}

function forceSyncMissingTasks() { portalAssertEditor_();
  let ui = SpreadsheetApp.getUi();
  let ss = SpreadsheetApp.getActiveSpreadsheet();
  let taskSheet = ss.getSheetByName("Task List");
  let masterSheet = ss.getSheetByName("Master");
  
  if (!taskSheet || !masterSheet) {
    ui.alert("Error", "Required sheets are missing.", ui.ButtonSet.OK);
    return;
  }

  let taskData = taskSheet.getDataRange().getValues();
  let masterData = masterSheet.getDataRange().getValues();

  let existingTaskKeys = new Set();

  for (let i = 1; i < masterData.length; i++) {
    let mDoer = String(masterData[i][0]).trim();
    let mDept = String(masterData[i][2]).trim();
    let mTask = String(masterData[i][5]).trim();
    if (mTask && mDoer) existingTaskKeys.add(mTask + "|" + mDoer + "|" + mDept);
  }

  let rowsToSync = [];

  for (let i = 1; i < taskData.length; i++) {
    let tName = String(taskData[i][0]).trim();
    let tDoer = String(taskData[i][1]).trim();
    let tDept = String(taskData[i][2]).trim();
    let tFreq = String(taskData[i][3]).trim();
    let tDate = String(taskData[i][4]).trim();
    
    let tKey = tName + "|" + tDoer + "|" + tDept;

    if (tName !== "" && tDoer !== "" && tDept !== "" && tFreq !== "" && tDate !== "") {
      if (!existingTaskKeys.has(tKey)) {
        rowsToSync.push(i + 1);
      }
    }
  }

  if (rowsToSync.length === 0) {
    ui.alert("Scan Complete ℹ️", "No missing tasks found.", ui.ButtonSet.OK);
    return;
  }

  if (rowsToSync.length > 0) {
    let rangesToClear = rowsToSync.map(r => 'F' + r);
    taskSheet.getRangeList(rangesToClear).clearContent();
  }

  let count = createChecklist();
  if(count > 0) ui.alert("Force Sync Success ✅", count + " missing tasks synced.", ui.ButtonSet.OK);
}

function submitButtonClicked() { portalAssertEditor_();
  try {
    let count = createChecklist();
    if(count > 0) {
        SpreadsheetApp.getUi().alert("Success ✅", count + " Tasks synced successfully!", SpreadsheetApp.getUi().ButtonSet.OK);
    }
  } catch (error) {
    SpreadsheetApp.getUi().alert("Error ❌", error.message, SpreadsheetApp.getUi().ButtonSet.OK);
  }
}

function createChecklist() {
  let ss = SpreadsheetApp.getActiveSpreadsheet();
  let taskSheet = ss.getSheetByName("Task List");
  let masterSheet = ss.getSheetByName("Master");
  if (!taskSheet || !masterSheet) return 0;

  let taskData = taskSheet.getDataRange().getValues();
  let tasksToProcess = []; 

  for (let i = 1; i < taskData.length; i++) {
    let tName = String(taskData[i][0]).trim();
    let tDoer = String(taskData[i][1]).trim();
    let tDept = String(taskData[i][2]).trim();
    let tFreq = String(taskData[i][3]).trim();
    let tDate = taskData[i][4];
    let tStatus = String(taskData[i][5]).trim().toLowerCase(); 
    
    if (tStatus === "sent") continue; 

    if (tName !== "" && tDoer !== "") {
      let uniqueKey = tName + "|" + tDoer + "|" + tDept;
      tasksToProcess.push({ rowIdx: i + 1, task: tName, doer: tDoer, dept: tDept, freq: tFreq, date: tDate, key: uniqueKey });
    }
  }

  if (tasksToProcess.length === 0) {
      SpreadsheetApp.getUi().alert("Info ℹ️", "No new or updated tasks to sync.", SpreadsheetApp.getUi().ButtonSet.OK);
      return 0;
  }

  let colCount = 12; 
  let masterData = masterSheet.getDataRange().getValues();
  let processedMasterData = [];
  
  if (masterData.length > 0) {
      let header = masterData[0].slice(0, colCount);
      while(header.length < colCount) header.push("");
      processedMasterData.push(header);
  } else {
      processedMasterData.push(["Name", "Email", "Department", "Task ID", "Freq", "Task", "Planned", "DATE", "Status", "E-mail", "Buddy Email", "Remark"]);
  }

  let lastMasterTaskID = 0;
  for (let j = 1; j < masterData.length; j++) {
      let mIDVal = parseInt(masterData[j][3]);
      if (!isNaN(mIDVal) && mIDVal > lastMasterTaskID) lastMasterTaskID = mIDVal;
  }

  let calendarSheet = ss.getSheetByName("Working Day Calender");
  let calLastRow = calendarSheet ? Math.max(calendarSheet.getLastRow(), 2) : 2;
  let calendarDates = calendarSheet ? calendarSheet.getRange(2, 1, calLastRow - 1, 1).getValues() : [];
  
  let workingDatesStr = [];
  let validDates = [];
  calendarDates.forEach(row => {
    let d = parseServerDate(row[0]);
    if (d) { validDates.push(d); workingDatesStr.push(Utilities.formatDate(d, "Asia/Kolkata", "yyyy-MM-dd")); }
  });

  let calendarFirstDate = validDates.length > 0 ? validDates[0] : new Date();
  let calendarLastDate = validDates.length > 0 ? validDates[validDates.length - 1] : new Date(new Date().setFullYear(new Date().getFullYear() + 2));
  let skipSundays = ss.getSheetByName("Setup Sheet") ? (ss.getSheetByName("Setup Sheet").getRange("B32").getValue() || "Yes") : "Yes";

  let doerEmailsMap = {};
  let doerSheet = ss.getSheetByName("Doer List");
  if (doerSheet) {
    let doerData = doerSheet.getDataRange().getValues();
    for (let d = 1; d < doerData.length; d++) {
      let dName = String(doerData[d][0]).trim().toLowerCase(); 
      let dDept = String(doerData[d][1]).trim().toLowerCase();
      let dEmail = String(doerData[d][2]).trim();
      if (dName && dDept) doerEmailsMap[dName + "|" + dDept] = dEmail;
    }
  }

  let tasksMap = {};
  tasksToProcess.forEach(t => {
      let theDate = parseServerDate(t.date); 
      if (theDate) {
          tasksMap[t.key] = {
              taskDef: t,
              schedule: generateScheduleDates(theDate, t.freq, calendarFirstDate, calendarLastDate, workingDatesStr, skipSundays, t.dept),
              keptDatesStr: new Set(),
              doneDatesStr: new Set()
          };
      }
  });

  for (let i = 1; i < masterData.length; i++) {
      let row = masterData[i].slice(0, colCount);
      let mDoer = String(row[0]).trim();
      let mTask = String(row[5]).trim();
      
      if (mDoer === "" && mTask === "") continue; 

      while(row.length < colCount) row.push("");
      let mDept = String(row[2]).trim();
      let mStatus = String(row[8]).trim().toLowerCase();
      let mDateObj = parseServerDate(row[6]);
      let mDateStr = mDateObj ? Utilities.formatDate(mDateObj, "Asia/Kolkata", "yyyy-MM-dd") : "";
      let mKey = mTask + "|" + mDoer + "|" + mDept;

      let tData = tasksMap[mKey];
      if (!tData) {
          processedMasterData.push(row);
      } else {
          if (mStatus === "done" || mStatus === "completed" || String(row[7]).trim() !== "") {
              tData.doneDatesStr.add(mDateStr);
              tData.keptDatesStr.add(mDateStr);
              processedMasterData.push(row);
          } else {
              if (tData.schedule.includes(mDateStr) && !tData.keptDatesStr.has(mDateStr)) {
                  row[4] = tData.taskDef.freq;
                  tData.keptDatesStr.add(mDateStr);
                  processedMasterData.push(row);
              }
          }
      }
  }

  let successRows = [];

  for (let key in tasksMap) {
      let tData = tasksMap[key];
      let tDef = tData.taskDef;
      
      let tKeyMap = (tDef.doer.toLowerCase() + "|" + tDef.dept.toLowerCase());
      
      let theEmail = doerEmailsMap[tKeyMap] || "";

      tData.schedule.forEach(schDateStr => {
          if (!tData.keptDatesStr.has(schDateStr)) {
              let schDateObj = parseServerDate(schDateStr);
              let newRow = [
                  tDef.doer, theEmail, tDef.dept, ++lastMasterTaskID, tDef.freq, 
                  tDef.task, schDateObj, "", "", "", "", ""
              ];
              processedMasterData.push(newRow);
          }
      });
      successRows.push(tDef.rowIdx);
  }

  if (processedMasterData.length > 0) {
      masterSheet.getRange(1, 1, processedMasterData.length, colCount).setValues(processedMasterData);
      let oldRows = masterSheet.getLastRow();
      if (oldRows > processedMasterData.length) {
         masterSheet.getRange(processedMasterData.length + 1, 1, oldRows - processedMasterData.length, colCount).clearContent();
      }
  }
  
  if (successRows.length > 0) {
      let rangesToUpdate = successRows.map(r => 'F' + r);
      taskSheet.getRangeList(rangesToUpdate).setValue("Sent");
  }

  SpreadsheetApp.flush(); 
  return successRows.length;
}

function generateScheduleDates(theDate, freq, calendarFirstDate, calendarLastDate, workingDatesStr, skipSundays, dept) {
    let freqUpper = String(freq).trim().toUpperCase();
    let limitDateObj = new Date();
    limitDateObj.setDate(limitDateObj.getDate() + 365); 
    let loopEndObj = new Date(Math.min(calendarLastDate.getTime(), limitDateObj.getTime()));
    
    let newSchedule = []; 
    let d = new Date(theDate.getTime());

    if (freqUpper === "W" || freqUpper === "WEEKLY") {
      while (loopEndObj.getTime() >= d.getTime()) {
        newSchedule.push(getWorkingDateOnOrBefore(new Date(d.getTime()), workingDatesStr, calendarFirstDate));
        d.setDate(d.getDate() + 7);
      }
    } else if (freqUpper === "M" || freqUpper === "MONTHLY") {
      while (loopEndObj.getTime() >= d.getTime()) {
        let workingDate = getWorkingDateOnOrBefore(new Date(d.getTime()), workingDatesStr, calendarFirstDate);
        newSchedule.push(applySundayLogic(workingDate, skipSundays, dept));
        d = addMonthsSafe(d, 1);
      }
    } else if (freqUpper === "Y" || freqUpper === "YEARLY" || freqUpper === "YERLY" || freqUpper === "YEAR") {
      while (loopEndObj.getTime() >= d.getTime()) {
         let workingDate = getWorkingDateOnOrBefore(new Date(d.getTime()), workingDatesStr, calendarFirstDate);
         newSchedule.push(applySundayLogic(workingDate, skipSundays, dept));
         d = addMonthsSafe(d, 12);
      }
    } else if (freqUpper === "D" || freqUpper === "DAILY") {
      while (loopEndObj.getTime() >= d.getTime()) {
        let endDateStr = Utilities.formatDate(d, "Asia/Kolkata", "yyyy-MM-dd");
        let isValidDay = true;
        if (workingDatesStr.length > 0 && workingDatesStr.includes(endDateStr)) {
          if (skipSundays === "Yes" && d.getDay() === 0) {
            if (String(dept).trim().toUpperCase() === "ACCOUNTS" && d.getDate() <= 7) isValidDay = true;
            else isValidDay = false;
          } 
        }
        if (isValidDay) newSchedule.push(new Date(d.getTime()));
        d.setDate(d.getDate() + 1);
      }
    } else if (freqUpper === "Q" || freqUpper === "QUARTERLY" || freqUpper === "QUATERLY") {
      while (loopEndObj.getTime() >= d.getTime()) {
        let workingDate = getWorkingDateOnOrBefore(new Date(d.getTime()), workingDatesStr, calendarFirstDate);
        newSchedule.push(applySundayLogic(workingDate, skipSundays, dept));
        d = addMonthsSafe(d, 3);
      }
    } else if (freqUpper === "H" || freqUpper === "HY" || freqUpper === "HALF YEARLY" || freqUpper === "HALFYEARLY") {
      while (loopEndObj.getTime() >= d.getTime()) {
        let workingDate = getWorkingDateOnOrBefore(new Date(d.getTime()), workingDatesStr, calendarFirstDate);
        newSchedule.push(applySundayLogic(workingDate, skipSundays, dept));
        d = addMonthsSafe(d, 6);
      }
    } else if (freqUpper === "F" || freqUpper === "FORTNIGHTLY") {
      while (loopEndObj.getTime() >= d.getTime()) {
        newSchedule.push(getWorkingDateOnOrBefore(new Date(d.getTime()), workingDatesStr, calendarFirstDate));
        d.setDate(d.getDate() + 14);
      }
    } else if (freqUpper.startsWith("E")) {
      while (loopEndObj.getTime() >= d.getTime()) {
        newSchedule.push(getWorkingDateOnOrBefore(new Date(d.getTime()), workingDatesStr, calendarFirstDate));
        let nthDay = (freqUpper === "E1ST") ? 1 : (freqUpper === "E2ND") ? 2 : (freqUpper === "E3RD") ? 3 : (freqUpper === "E4TH") ? 4 : 5;
        let targetDayOfWeek = d.getDay();
        d = getNextMonthNthDay(d, targetDayOfWeek, nthDay);
      }
    }
    return newSchedule.map(x => Utilities.formatDate(x, "Asia/Kolkata", "yyyy-MM-dd"));
}

function getNextMonthNthDay(currentDate, dayOfWeek, n) {
  let year = currentDate.getFullYear();
  let month = currentDate.getMonth() + 1;
  if (month > 11) { month = 0; year++; }
  let d = new Date(year, month, 1);
  let count = 0; let lastValid = null;
  while (d.getMonth() === month) {
    if (d.getDay() === dayOfWeek) { count++; lastValid = new Date(d); if (count === n) return d; }
    d.setDate(d.getDate() + 1);
  }
  return lastValid || new Date(year, month, 1);
}

function cleanMasterSheets() { portalAssertEditor_();
  let ui = SpreadsheetApp.getUi();
  let response = ui.alert("Confirm Cleanup", "Proceed with cleanup?", ui.ButtonSet.YES_NO);
  if (response !== ui.Button.YES) return;
  try {
    let ss = SpreadsheetApp.getActiveSpreadsheet();
    let taskSheet = ss.getSheetByName("Task List");
    let masterSheet = ss.getSheetByName("Master");
    if (!taskSheet || !masterSheet) return;

    let taskData = taskSheet.getDataRange().getValues();
    let validKeys = new Set();
    for (let i = 1; i < taskData.length; i++) {
      let tTask = String(taskData[i][0]).trim(), tDoer = String(taskData[i][1]).trim(), tDept = String(taskData[i][2]).trim();
      if (tTask !== "" && tDoer !== "") validKeys.add(tTask + "|" + tDoer + "|" + tDept);
    }

    let masterData = masterSheet.getDataRange().getValues();
    if (masterData.length < 2) return;

    let colCount = 12;
    let cleanData = [masterData[0].slice(0, colCount)];
    let uniqueRowTracker = new Set();
    let removedCount = 0;

    for (let i = 1; i < masterData.length; i++) {
      let mDoer = String(masterData[i][0]).trim(), mDept = String(masterData[i][2]).trim(), mTask = String(masterData[i][5]).trim();
      if(mDoer === "" && mTask === "") continue; 
      
      let mPlannedStr = (masterData[i][6] instanceof Date) ? Utilities.formatDate(masterData[i][6], "Asia/Kolkata", "yyyy-MM-dd") : String(masterData[i][6]).trim();
      let mStatus = String(masterData[i][8]).trim();
      let mKey = mTask + "|" + mDoer + "|" + mDept;
      let rowFingerprint = mKey + "|" + mPlannedStr; 

      if (mStatus === "Done" || mStatus === "Completed" || String(masterData[i][7]).trim() !== "") {
        cleanData.push(masterData[i]); 
      } else {
        if (validKeys.has(mKey)) {
          if (!uniqueRowTracker.has(rowFingerprint)) { 
             uniqueRowTracker.add(rowFingerprint); 
             cleanData.push(masterData[i]); 
          } 
          else removedCount++; 
        } else removedCount++; 
      }
    }

    let safeCleanData = cleanData.map(row => {
      let r = row.slice(); while(r.length < colCount) r.push(""); return r.slice(0, colCount);
    });

    let oldMaxRows = masterSheet.getLastRow();
    masterSheet.getRange(1, 1, safeCleanData.length, colCount).setValues(safeCleanData);
    
    if (oldMaxRows > safeCleanData.length) {
       let danglingRange = masterSheet.getRange(safeCleanData.length + 1, 1, oldMaxRows - safeCleanData.length, masterSheet.getMaxColumns());
       danglingRange.clearContent(); danglingRange.clearDataValidations();
    }
    if(masterSheet.getMaxColumns() > colCount) {
        masterSheet.getRange(1, colCount + 1, Math.max(oldMaxRows, safeCleanData.length), masterSheet.getMaxColumns() - colCount).clearContent();
    }
    
    ui.alert("Cleanup Complete 🧹", "Successfully removed " + removedCount + " invalid/duplicate rows.", ui.ButtonSet.OK);
  } catch (error) { ui.alert("Error ❌", error.message, ui.ButtonSet.OK); }
}

function getSafeDateString(val) {
  if (!val) return "";
  if (val instanceof Date) return Utilities.formatDate(val, "Asia/Kolkata", "dd/MM/yyyy HH:mm:ss");
  return String(val).trim();
}

function onEdit(e) {
  if (!e || !e.range) return;
  try {
    const sheet = e.range.getSheet();
    const sheetName = sheet.getName();
    const rowStart = e.range.getRow();
    const colStart = e.range.getColumn();
    const numRows = e.range.getNumRows();

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
  } catch (error) {}
}


// --- ADDED: Daily 7 PM Auto Sync Setup ---
function setupEveningSyncTrigger() { portalAssertEditor_();
  var ui = SpreadsheetApp.getUi();
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'updateMonthlyMaster') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  
  ScriptApp.newTrigger('updateMonthlyMaster')
    .timeBased()
    .everyDays(1)
    .atHour(19)
    .create();
    
  ui.alert("Success ✅", "Monthly Master will now automatically sync every day at 7:00 PM without deleting any data.", ui.ButtonSet.OK);
}
// -----------------------------------------


function updateMonthlyMaster() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const masterSheet = ss.getSheetByName("Master");
    if (!masterSheet) return;

    let monthlySheet = ss.getSheetByName("Monthly Master");
    let isNew = false;
    
    if (!monthlySheet) { 
        monthlySheet = ss.insertSheet("Monthly Master"); 
        isNew = true; 
    } 
    
    const finalMasterData = masterSheet.getDataRange().getValues();
    if (finalMasterData.length < 2) {
       SpreadsheetApp.getActiveSpreadsheet().toast("Master sheet is empty.", "Sync Error");
       return;
    }
    
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    let colCount = 12; 
    
    let existingMonthlyData = [];
    if (!isNew && monthlySheet.getLastRow() > 0) {
        existingMonthlyData = monthlySheet.getDataRange().getValues();
    }
    
    let existingTaskMap = {};
    if (existingMonthlyData.length > 1) {
        for (let r = 1; r < existingMonthlyData.length; r++) {
            let tId = String(existingMonthlyData[r][3]).trim();
            if (tId) {
                existingTaskMap[tId] = r; 
            }
        }
    }

    let monthlyDataArr = [];
    if (existingMonthlyData.length === 0 || isNew) {
         monthlyDataArr.push(finalMasterData[0].slice(0, colCount)); 
    }

    let newRowsToAppend = [];
    let rowsToUpdate = [];
    let masterUpdates = []; // Naya array jo Master sheet ko ulta update karega

    // Check Master sheet data
    for (let i = 1; i < finalMasterData.length; i++) {
      if(String(finalMasterData[i][0]).trim() === "" && String(finalMasterData[i][5]).trim() === "") continue; 
      
      let plannedDate = parseServerDate(finalMasterData[i][6]); 
      if (plannedDate && plannedDate.getMonth() === currentMonth && plannedDate.getFullYear() === currentYear) {
        finalMasterData[i][7] = getSafeDateString(finalMasterData[i][7]);
        let rowData = finalMasterData[i].slice(0, colCount);
        
        while(rowData.length < colCount) rowData.push("");
        let taskId = String(rowData[3]).trim();
        
        if (existingTaskMap.hasOwnProperty(taskId)) {
            // NAYA LOGIC: Check karo ki Monthly Master me data "Done" toh nahi hai
            let mmRowIndex = existingTaskMap[taskId];
            let mmRowData = existingMonthlyData[mmRowIndex];
            
            let mmActualDate = mmRowData[7]; // Timestamp (Col H)
            let mmStatus = mmRowData[8];     // Status (Col I)
            let mmRemark = mmRowData[11];    // Remark (Col L)
            
            let isDone = (String(mmStatus).trim().toLowerCase() === "done" || String(mmStatus).trim().toLowerCase() === "completed" || String(mmActualDate).trim() !== "");
            
            if (isDone) {
                // Agar Monthly Master me task Done hai, toh usko overwite mat karo!
                rowData[7] = mmActualDate || rowData[7];
                rowData[8] = mmStatus || "Done";
                rowData[11] = mmRemark || rowData[11];
                
                // Original Master sheet ko update karne ke liye details save kar lo
                masterUpdates.push({
                    row: i + 1,
                    actualDate: rowData[7],
                    status: rowData[8],
                    remark: rowData[11]
                });
            }
            
            rowsToUpdate.push({ rowIndex: mmRowIndex + 1, data: rowData });
        } else {
            // Naya task
            newRowsToAppend.push(rowData);
        }
      }
    }

    // Update existing rows in Monthly Master
    if (rowsToUpdate.length > 0) {
        rowsToUpdate.forEach(item => {
             monthlySheet.getRange(item.rowIndex, 1, 1, colCount).setValues([item.data]);
        });
    }
    
    // Append new rows in Monthly Master
    if (newRowsToAppend.length > 0) {
         let startRow = monthlySheet.getLastRow() + 1;
         monthlySheet.getRange(startRow, 1, newRowsToAppend.length, colCount).setValues(newRowsToAppend);
         
         const rule = SpreadsheetApp.newDataValidation().requireValueInList(['Done'], true).build();
         monthlySheet.getRange(startRow, 9, newRowsToAppend.length, 1).setDataValidation(rule);
    }

    // 🔄 NAYA LOGIC (REVERSE SYNC): 
    // Jo Monthly Master me "Done" hue hain, unhe ab original "Master" sheet me bhi "Done" kar do
    if (masterUpdates.length > 0) {
        masterUpdates.forEach(update => {
            masterSheet.getRange(update.row, 8, 1, 2).setValues([[update.actualDate, update.status]]); // Update Timestamp & Status
            if (update.remark) {
                masterSheet.getRange(update.row, 12).setValue(update.remark); // Update Remark
            }
        });
    }
    
    if (isNew) {
        masterSheet.getRange(1, 1, 1, colCount).copyTo(monthlySheet.getRange(1, 1, 1, colCount), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
        for (let c = 1; c <= colCount; c++) monthlySheet.setColumnWidth(c, masterSheet.getColumnWidth(c));
        monthlySheet.setFrozenRows(1);
    }

    try {
        SpreadsheetApp.getActiveSpreadsheet().toast("Monthly Master synced successfully!", "Success ✅", 3);
    } catch(e) {}

  } catch (error) {
     try { SpreadsheetApp.getActiveSpreadsheet().toast("Error: " + error.message, "Sync Failed ❌"); } catch(e) {}
  }
}

function parseServerDate(val) {
  if (!val) return null; if (val instanceof Date && !isNaN(val.getTime())) return val;
  let str = String(val).trim();
  if (str.includes('/')) { 
    let parts = str.split('/'); if (parts.length === 3) { let d = new Date(parts[2], parts[1] - 1, parts[0]); if (!isNaN(d.getTime())) return d; } 
  } else if (str.includes('-')) {
    let parts = str.split('-'); if (parts.length === 3) { let d; if (parts[0].length === 4) d = new Date(parts[0], parts[1] - 1, parts[2]); else d = new Date(parts[2], parts[1] - 1, parts[0]); if (!isNaN(d.getTime())) return d; }
  }
  let fallback = new Date(str); if (!isNaN(fallback.getTime())) return fallback; return null;
}

function addMonthsSafe(dateObj, monthsToAdd) {
  let d = new Date(dateObj.getTime()); let expectedMonth = (d.getMonth() + monthsToAdd) % 12; if (expectedMonth < 0) expectedMonth += 12;
  d.setMonth(d.getMonth() + monthsToAdd); if (d.getMonth() !== expectedMonth) d.setDate(0); return d;
}

function applySundayLogic(theDate, skipSundays, theDepartment) {
  let workingDate = new Date(theDate.getTime());
  if (skipSundays === "Yes" && workingDate.getDay() === 0) { if (String(theDepartment).trim().toUpperCase() === "ACCOUNTS") { if (workingDate.getDate() > 7) { workingDate.setDate(workingDate.getDate() - 1); } } else { workingDate.setDate(workingDate.getDate() - 1); } }
  return workingDate;
}

Date.prototype.addTheDays = function (days) { var date = new Date(this.valueOf()); date.setDate(date.getDate() + days); return date; }

function getWorkingDateOnOrBefore(date, workingDatesStr, calendarFirstDate) {
  if (!workingDatesStr || workingDatesStr.length === 0) return date; 
  let candidate = new Date(date), firstDate = new Date(calendarFirstDate); candidate.setHours(0, 0, 0, 0); firstDate.setHours(0, 0, 0, 0);
  let candidateStr = Utilities.formatDate(candidate, "Asia/Kolkata", "yyyy-MM-dd");
  if (candidate.getTime() < firstDate.getTime()) return candidate;
  
  let loopLimit = 0; 
  while (!workingDatesStr.includes(candidateStr) && loopLimit < 30) { 
    if (candidate.getTime() <= firstDate.getTime()) return firstDate; 
    candidate.setDate(candidate.getDate() - 1); 
    candidateStr = Utilities.formatDate(candidate, "Asia/Kolkata", "yyyy-MM-dd"); 
    loopLimit++;
  }
  return candidate;
}

function showAssignBuddyDialog() { portalAssertEditor_(); var html = HtmlService.createHtmlOutputFromFile('AssignBuddyDialog').setWidth(460).setHeight(380); SpreadsheetApp.getUi().showModalDialog(html, 'Assign Buddy'); }

function getAssignBuddyOptions() { portalAssertEditor_();
  var ss = SpreadsheetApp.getActiveSpreadsheet(), doerSheet = ss.getSheetByName("Doer List"); if (!doerSheet) throw new Error("Doer List sheet was not found.");
  var lastRow = doerSheet.getLastRow(); if (lastRow < 1) return { doers: [], buddies: [] };
  var data = doerSheet.getRange(1, 1, lastRow, 3).getValues(), doers = [], buddies = [], seenDoers = {}, seenEmails = {};
  data.forEach(function(row) {
    var name = String(row[0] || "").trim(), department = String(row[1] || "").trim(), email = String(row[2] || "").trim();
    if (!name || !department || !email || email.indexOf("@") === -1) return;
    var doerKey = name + "\u0000" + department;
    if (!seenDoers[doerKey]) { seenDoers[doerKey] = true; doers.push({ name: name, department: department, label: name + " - " + department }); }
    if (!seenEmails[email]) { seenEmails[email] = true; buddies.push({ email: email, label: name + " - " + department + " (" + email + ")" }); }
  }); return { doers: doers, buddies: buddies };
}

function parseDateInput(dateText, fieldName) {
  if (!dateText) throw new Error(fieldName + " is required."); var parts = String(dateText).split("-"); if (parts.length !== 3) throw new Error(fieldName + " must be a valid date.");
  var date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])); if (isNaN(date.valueOf())) throw new Error(fieldName + " must be a valid date.");
  date.setHours(0, 0, 0, 0); return date;
}

function assignBuddyToTasks(form) { portalAssertEditor_();
  var name = String(form.name || "").trim(), department = String(form.department || "").trim(), buddyEmail = String(form.buddyEmail || "").trim();
  var fromDate = parseDateInput(form.fromDate, "From date"), toDate = parseDateInput(form.toDate, "To date");
  if (!name || !department) throw new Error("Choose a name and department."); if (!buddyEmail) throw new Error("Choose a buddy email."); if (fromDate.valueOf() > toDate.valueOf()) throw new Error("From date cannot be after To date.");
  var ss = SpreadsheetApp.getActiveSpreadsheet(), masterSheet = ss.getSheetByName("Master"); if (!masterSheet) throw new Error("Master sheet was not found.");
  var lastRow = masterSheet.getLastRow(); if (lastRow < 2) return { updated: 0 };
  var data = masterSheet.getRange(2, 1, lastRow - 1, 11).getValues(), buddyColumn = data.map(function(row) { return [row[10]]; }), updated = 0;
  data.forEach(function(row, index) {
    var taskDoer = String(row[0] || "").trim(), taskDepartment = String(row[2] || "").trim(), plannedDate = parseServerDate(row[6]); if (!plannedDate) return;
    var normalizedPlannedDate = new Date(plannedDate); normalizedPlannedDate.setHours(0, 0, 0, 0);
    if (taskDoer === name && taskDepartment === department && normalizedPlannedDate.valueOf() >= fromDate.valueOf() && normalizedPlannedDate.valueOf() <= toDate.valueOf()) { buddyColumn[index][0] = buddyEmail; updated++; }
  });
  if (updated > 0) masterSheet.getRange(2, 11, buddyColumn.length, 1).setValues(buddyColumn); return { updated: updated };
}

function setTrigger() { portalAssertEditor_(); removeTrigger(); var time = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Setup Sheet").getRange("C15").getValue(); createTrigger(time); }
function createTrigger(time) { portalAssertEditor_(); if (!time) time = 10; ScriptApp.newTrigger('sendReminder').timeBased().everyDays(1).atHour(time).create(); }
function removeTrigger() { portalAssertEditor_(); var allTriggers = ScriptApp.getProjectTriggers(); for (var i = 0; i < allTriggers.length; i++) { if (allTriggers[i].getHandlerFunction() === 'sendReminder') { ScriptApp.deleteTrigger(allTriggers[i]); } } }

function sendReminder() {
  var forBsh = SpreadsheetApp.getActive().getSheetByName("Doer List"), dataB = forBsh.getRange(1, 3, forBsh.getLastRow(), 1).getValues();
  var tomorrow = new Date((new Date().setHours(0, 0, 0, 0)).valueOf() + 1000 * 3600 * 24), sheet = SpreadsheetApp.getActive().getSheetByName("Master"), data = sheet.getRange(2, 1, getLastRowSpecial(sheet.getRange("B:B").getValues()) - 1, 8).getValues();
  dataB.filter(function(r){
    let reminderTasks = [];
    data.filter(function(pending){ let doeremail = pending[1], lastDate = parseServerDate(pending[6]), actual = pending[7], name = pending[0], task = pending[5]; if (lastDate && r[0] === doeremail && lastDate.valueOf() === tomorrow.valueOf() && !actual) reminderTasks.push([name,task]); });
    if (reminderTasks.length > 0){
      let joinedTasks = reminderTasks.map(function(tasks){ return "Task : "+tasks[1] }).join("\n");
      let dataToSend = "Hello "+reminderTasks[0][0]+",\n\nYou have planned tasks pending for tomorrow.\n\n"+joinedTasks+"\n\nPlease ignore this message if you have already completed the tasks.";
      GmailApp.sendEmail(r[0], "You have Pending Tasks for tomorrow", dataToSend);
    }
  });
}

function archive() {
  var ss = SpreadsheetApp.getActive(), sheet = ss.getSheetByName("Scores"), data = sheet.getRange(4, 1, 6, 4).getValues();
  ss.getSheetByName("Archive").appendRow([sheet.getRange("A2").getValue(), sheet.getRange("D2").getValue(), data[5][1], data[5][2], "", data[3][1], data[3][2], ""]);
  sheet.getRange('B9:C9').activate(); sheet.getActiveRangeList().clear({ contentsOnly: true, skipFilteredRows: true });
}

function sendtodoer() {
  var forB = SpreadsheetApp.getActive(), forBsh = forB.getSheetByName("Doer List"), dataB = forBsh.getRange(1, 1, forBsh.getLastRow(), 2).getValues();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Send Tasks To Doer"), htmlTable = SheetConverter.convertRange2html(sheet.getRange(4, 1, sheet.getLastRow() - 3, 2));
  var email = findinB(sheet.getRange("A2").getValue(), dataB), body = "Here are your " + sheet.getRange("D2").getValue() + " tasks of Week " + sheet.getRange("E2").getValue().toString() + ". <br><br>" + htmlTable;
  GmailApp.sendEmail(email, 'Details of Delegated Tasks', body, { htmlBody: body });
}

function groupBy(list, keyGetter) { const map = new Map(); list.forEach((item) => { const key = keyGetter(item); const collection = map.get(key); if (!collection) map.set(key, [item]); else collection.push(item); }); return map; }
function getEmail(theName,theDepartment) { try { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Doer List").getRange(1,1,1000,3).getValues().filter(r => String(r[0]).trim() === String(theName).trim() && String(r[1]).trim() === String(theDepartment).trim())[0][2]; } catch (e) { return "FAILED"; } }
function findinB(name, data) { for (var nn = 0; nn < data.length; ++nn) { if (data[nn][1] == name) break; } return data[nn][0]; }
function getLastRowSpecial(range) { var rowNum = 0, blank = false; for (var row = 0; row < range.length; row++) { if (range[row][0] === "" && !blank) { rowNum = row; blank = true; } else if (range[row][0] !== "") blank = false; } return rowNum; }
function Return_Date(F_Date, num, hr, min) { var dt = new Date(F_Date.getTime() + 24 * 60 * 60 * 1000 * (num + 1)); dt.setHours(hr); dt.setMinutes(min); return dt; }
function getDayInfo(arg){ return ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][arg]; }
function createTriggerOnChange() { } function onChange() { }

function markTaskAsDoneInSheet(token, taskId) {
  var sess = jpSessionOrNull_(token);
  if (!sess) throw new Error('SESSION_EXPIRED');
  try {
    let ss = SpreadsheetApp.getActiveSpreadsheet(), masterSheet = ss.getSheetByName("Master"), dateStr = Utilities.formatDate(new Date(), "Asia/Kolkata", "dd/MM/yyyy HH:mm:ss"), success = false;
    if (masterSheet) {
      let tf = masterSheet.getRange("D:D").createTextFinder(taskId.toString()).matchEntireCell(true).findNext();
      if (tf) {
        let r = tf.getRow();
        // only the person the task belongs to (or an admin) can tick it
        if (!sess.admin && String(masterSheet.getRange(r, 1).getValue()).trim() !== sess.name) throw new Error('Not your task.');
        masterSheet.getRange(r, 9).setValue("Done");
        let currentStamp = masterSheet.getRange(r, 8).getValue(); if (!currentStamp || String(currentStamp).trim() === "") { masterSheet.getRange(r, 8).setValue(dateStr); }
        success = true;
      }
    }
    if (success) { SpreadsheetApp.flush(); updateMonthlyMaster(); } return { success: success };
  } catch(e) { throw new Error("Failed to save."); }
}

function checkLogin(mobile, password) {
  // Connected to GGM Portal: the portal username/phone + password are tried first (checked by the hub).
  // While Portal-only is OFF the old mobile + password (Doer List) keeps working too. The shared
  // built-in "Main" admin login stays retired once connected.
  var portalMsg = '';
  if (portalEnabled_()) {
    try { var b = portalRemoteLogin_(mobile, password); return { success: true, name: b.name, isAdmin: b.isAdmin, token: b.token }; }
    catch (e) {
      if (portalOnly_()) return { success: false, message: e.message || String(e) };
      portalMsg = e.message || String(e);
    }
  }
  var old = mobileLogin_(mobile, password);
  if (!old.success && portalMsg && /Invalid/.test(String(old.message))) old.message = 'Mobile / username or password is wrong.';
  return old;
}

/** The app's own login: mobile + password from the Doer List. */
function mobileLogin_(mobile, password) {
  try {
    if (!portalEnabled_() && String(mobile).trim() === "Main" && String(password).trim() === "123456") return { success: true, name: "Admin (Sir)", isAdmin: true,
      token: portalNewSession_({ u: 'Main', n: 'Admin (Sir)', d: 'Admin (Sir)', r: 'ADMIN' }, 'legacy') };
    let data = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Doer List").getDataRange().getValues();
    for (let i = 1; i < data.length; i++) if (String(data[i][3]).trim() === String(mobile).trim() && String(data[i][4]).trim() === String(password).trim()) return { success: true, name: String(data[i][0]).trim(), isAdmin: false,
      token: portalNewSession_({ u: String(mobile).trim(), n: String(data[i][0]).trim(), d: String(data[i][0]).trim(), r: 'USER', p: String(mobile).trim() }, 'legacy') };
    return { success: false, message: "Invalid ID or Password!" };
  } catch (e) { return { success: false, message: "Server error." }; }
}

function doGet(e) {
  var gate = portalGate_(e);          // GGM Portal: launch pass / Portal-only (Portal.js)
  if (gate.block) return gate.block;
  return portalInject_(HtmlService.createHtmlOutputFromFile('index'), gate).setTitle('GGM Workspace').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL).addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0');
}

/** Page → the signed-in person's tasks (the name comes from the session, not the browser). */
function getTasksForDoer(token, userNameIgnored) {
  var sess = jpSessionOrNull_(token);
  if (!sess) return { sessionExpired: true };
  return getTasksForDoer_(sess.name);
}

function getTasksForDoer_(userName) {
  try {
    let sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Master"), lastRow = sheet.getLastRow(); if(lastRow < 2) return { tasks: [], missedCount: 0 };
    let data = sheet.getRange(2, 1, lastRow - 1, 9).getValues(), today = new Date(), todayStr = Utilities.formatDate(today, "Asia/Kolkata", "dd/MM/yyyy");
    let currentMonth = today.getMonth(), currentYear = today.getFullYear(), todayMidnight = new Date(today).setHours(0,0,0,0), tasks = [], missedCount = 0;
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][0] || "").trim() === userName) {
        let dateObj = parseServerDate(data[i][6]), isDone = (String(data[i][8]).trim() === "Done" || String(data[i][7]).trim() !== "");
        if (dateObj) {
          let taskMonth = dateObj.getMonth(), taskYear = dateObj.getFullYear(), dateStr = Utilities.formatDate(dateObj, "Asia/Kolkata", "dd/MM/yyyy"), dateObjMidnight = new Date(dateObj).setHours(0,0,0,0);
          let isPast = dateObjMidnight < todayMidnight, isToday = (dateStr === todayStr);
          if (taskMonth === currentMonth && taskYear === currentYear) {
            if (!isDone && isPast && !isToday) missedCount++;
            tasks.push({ taskId: data[i][3] || `t_${i}`, title: data[i][5] || "Untitled Task", freq: data[i][4] || "NA", dueDate: dateStr, status: isDone ? 'completed' : 'pending', isToday: isToday, isPastMissed: (!isDone && isPast && !isToday) });
          }
        }
      }
    } return { tasks: tasks, missedCount: missedCount };
  } catch(e) { return { tasks: [], missedCount: 0 }; }
}

/** Page → the admin panel; admins only. */
function getAdminDashboardData(token) {
  var sess = jpSessionOrNull_(token);
  if (!sess) return { sessionExpired: true, error: 'SESSION_EXPIRED' };
  if (!sess.admin) return { error: 'Admins only.' };
  return getAdminDashboardData_();
}

function getAdminDashboardData_() {
  try {
    let sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Master"), lastRow = sheet.getLastRow(); if(lastRow < 2) return { companyStats: {}, teamData: [], recentActivity: [] };
    let data = sheet.getRange(2, 1, lastRow - 1, 9).getValues(), today = new Date(), todayStr = Utilities.formatDate(today, "Asia/Kolkata", "dd/MM/yyyy");
    let currentMonth = today.getMonth(), currentYear = today.getFullYear(), todayMidnight = new Date(today).setHours(0,0,0,0), teamMap = {}, overall = { total: 0, completed: 0, pending: 0, missed: 0 }, recent = [];
    for (let i = 0; i < data.length; i++) {
      let doer = String(data[i][0] || "").trim(); if(!doer) continue; if(!teamMap[doer]) teamMap[doer] = { name: doer, completed: 0, pending: 0, missed: 0, totalActive: 0 };
      let dateObj = parseServerDate(data[i][6]), isDone = (String(data[i][8]).trim() === "Done" || String(data[i][7]).trim() !== "");
      if (dateObj) {
        let taskMonth = dateObj.getMonth(), taskYear = dateObj.getFullYear(), dateStr = Utilities.formatDate(dateObj, "Asia/Kolkata", "dd/MM/yyyy"), dateObjMidnight = new Date(dateObj).setHours(0,0,0,0);
        let sheetCol = data[i][7] ? Utilities.formatDate(new Date(data[i][7]), "Asia/Kolkata", "dd/MM/yy HH:mm") : dateStr;
        let isPast = dateObjMidnight < todayMidnight, isToday = (dateStr === todayStr);
        if (taskMonth === currentMonth && taskYear === currentYear) {
          overall.total++;
          if (isDone) { overall.completed++; teamMap[doer].completed++; teamMap[doer].totalActive++; recent.push({ doer: doer, task: data[i][5], date: sheetCol, rawDate: (data[i][7] ? new Date(data[i][7]).getTime() : 0) }); } 
          else if (isPast && !isToday) { overall.missed++; teamMap[doer].missed++; teamMap[doer].totalActive++; } 
          else { overall.pending++; teamMap[doer].pending++; teamMap[doer].totalActive++; }
        }
      }
    }
    let teamData = Object.values(teamMap).map(t => { t.score = t.totalActive === 0 ? 100 : Math.round((t.completed / t.totalActive) * 100); return t; });
    teamData.sort((a,b) => b.score - a.score); recent.sort((a,b) => b.rawDate - a.rawDate); recent = recent.slice(0, 20);
    return { companyStats: overall, teamData: teamData, recentActivity: recent };
  } catch(e) { return { error: e.toString() }; }
}

/**
 * Triggered by the Down Arrow button.
 * Selects the NEXT employee name from the dropdown list.
 */
function nextEmployee() {
  changeEmployee(1);
}

/**
 * Triggered by the Up Arrow button.
 * Selects the PREVIOUS employee name from the dropdown list.
 */
function previousEmployee() {
  changeEmployee(-1);
}

/**
 * Core function to cycle through employee names.
 * Reads options directly from the data validation rule on cell N2,
 * with a fallback to the 'Doer List' sheet (column G) if needed.
 */
function changeEmployee(direction) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Checklist");
  if (!sheet) return;

  var targetCell = sheet.getRange("N2");
  var rule = targetCell.getDataValidation();
  var names = [];

  // 1. Attempt to get dropdown list items directly from the cell's validation rule
  if (rule) {
    var criteria = rule.getCriteriaType();
    var args = rule.getCriteriaValues();

    if (criteria === SpreadsheetApp.DataValidationCriteria.VALUE_IN_RANGE) {
      // If validation comes from a range (e.g. 'Doer List'!G2:G)
      var range = args[0];
      names = range.getValues()
        .map(function(row) { return row[0] ? row[0].toString().trim() : ""; })
        .filter(function(name) { return name !== ""; });
    } else if (criteria === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) {
      // If validation comes from a fixed list
      names = args[0].map(function(val) { return val.toString().trim(); });
    }
  }

  // 2. Fallback to 'Doer List' sheet column G if validation wasn't extracted
  if (names.length === 0) {
    var doerSheet = ss.getSheetByName("Doer List");
    if (doerSheet) {
      var lastRow = doerSheet.getLastRow();
      if (lastRow >= 2) {
        names = doerSheet.getRange("G2:G" + lastRow).getValues()
          .map(function(row) { return row[0] ? row[0].toString().trim() : ""; })
          .filter(function(name) { return name !== ""; });
      }
    }
  }

  if (names.length === 0) {
    SpreadsheetApp.getUi().alert("No employee names found in the dropdown source.");
    return;
  }

  // 3. Find current employee and calculate the new index
  var currentValue = targetCell.getValue().toString().trim();
  var currentIndex = names.indexOf(currentValue);
  var newIndex;

  if (currentIndex === -1) {
    newIndex = 0;
  } else {
    newIndex = currentIndex + direction;

    // Loop around if reaching the boundaries
    if (newIndex >= names.length) {
      newIndex = 0; // Wrap around to first name
    } else if (newIndex < 0) {
      newIndex = names.length - 1; // Wrap around to last name
    }
  }

  // 4. Update cell N2 with the new name
  targetCell.setValue(names[newIndex]);
}