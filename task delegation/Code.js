let spreadsheet = null;
let sss = SpreadsheetApp.getActive();

if (typeof ManagedSpreadsheet === 'undefined') {
  class MockManagedSpreadsheet {
    sheet(name) {
      let ws = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
      return {
        append: function(obj) {
          let headers = ws.getRange(1, 1, 1, ws.getLastColumn()).getValues()[0];
          let row = [];
          headers.forEach(h => row.push(obj[h] || ""));
          ws.appendRow(row);
        },
        find: function(colName, val) {
          let data = ws.getDataRange().getValues();
          let headers = data[0];
          let colIdx = headers.indexOf(colName);
          for(let i=1; i<data.length; i++) {
            if(data[i][colIdx] === val) {
              let res = {};
              headers.forEach((h, idx) => res[h] = data[i][idx]);
              return res;
            }
          }
          return null;
        },
        rowIndex: function(colName, val) {
          let data = ws.getDataRange().getValues();
          let headers = data[0];
          let colIdx = headers.indexOf(colName);
          for(let i=1; i<data.length; i++) {
            if(data[i][colIdx] === val) return i + 1;
          }
          return -1;
        },
        update: function(rowIdx, obj) {
          let headers = ws.getRange(1, 1, 1, ws.getLastColumn()).getValues()[0];
          let row = [];
          headers.forEach(h => row.push(obj[h] || ""));
          ws.getRange(rowIdx, 1, 1, row.length).setValues([row]);
        }
      };
    }
  }
  spreadsheet = new MockManagedSpreadsheet();
}

// doGet and the view loaders live in loadMainForm.js / loadP.js (they always won over the copies that were here).

function getDoerMap_() {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'doerMap';
  const cached = cache.get(cacheKey);
  if (cached != null) return JSON.parse(cached);

  let sheet = sss.getSheetByName("Doer List");
  let lastRow = sheet.getLastRow();
  if (lastRow < 2) return {};

  let data = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  let doerMap = {};
  data.forEach(row => {
    const name = row[0];
    const number = row[1] || '';
    const email = row[2] || '';
    if (name) doerMap[name] = { number: number, email: email };
  });
  cache.put(cacheKey, JSON.stringify(doerMap), 600);
  return doerMap;
}

function safeFormatDate_(val) {
  if (!val) return "";
  if (val instanceof Date) return Utilities.formatDate(val, Session.getScriptTimeZone(), "dd/MM/yyyy");
  try {
    let d = new Date(val);
    if (!isNaN(d.getTime())) return Utilities.formatDate(d, Session.getScriptTimeZone(), "dd/MM/yyyy");
  } catch(e) {}
  return val.toString();
}

function generateNewTaskID_() {
  let sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Master");
  let lastRow = sheet.getLastRow();
  if (lastRow <= 1) return "TK-001";

  let data = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
  let maxNum = 0;
  for (let i = 0; i < data.length; i++) {
    let idStr = data[i][0] ? data[i][0].toString().trim() : "";
    if (idStr.indexOf("TK-") === 0) {
      let numPart = parseInt(idStr.substring(3), 10);
      if (!isNaN(numPart) && numPart > maxNum) maxNum = numPart;
    }
  }
  let nextNum = maxNum + 1;
  let nextNumStr = nextNum.toString();
  while (nextNumStr.length < 3) nextNumStr = "0" + nextNumStr;
  return "TK-" + nextNumStr;
}

// --- UPDATED: ADD NEW TASK (Bypassing Mock Spreadsheet for reliability) ---
function addNew(token, options) {
  var me = ggmUser_(token);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);                       // two people adding at once must not get the same TK id
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("Master");
    var doerSheet = ss.getSheetByName("Doer List");

    var lastRow = sheet.getLastRow();
    var taskid = "TK-001";
    if (lastRow > 1) {
      var data = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
      var maxNum = 0;
      for (var i = 0; i < data.length; i++) {
        var idStr = data[i][0] ? data[i][0].toString().trim() : "";
        if (idStr.indexOf("TK-") === 0) {
          var numPart = parseInt(idStr.substring(3), 10);
          if (!isNaN(numPart) && numPart > maxNum) maxNum = numPart;
        }
      }
      var nextNumStr = (maxNum + 1).toString();
      while (nextNumStr.length < 3) nextNumStr = "0" + nextNumStr;
      taskid = "TK-" + nextNumStr;
    }

    var todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm:ss");
    var name = options.name;
    var task = options.task;
    var firstDate = options.fdate;

    var nameToStore = name;
    if (doerSheet) {
      var dLast = doerSheet.getLastRow();
      if (dLast > 1) {
        var dData = doerSheet.getRange(2, 1, dLast - 1, 2).getValues();
        var normalizedInput = name.toString().toLowerCase().replace(/[^a-z0-9]/g, "");
        for (var d = 0; d < dData.length; d++) {
          var dName = dData[d][0] ? dData[d][0].toString() : "";
          var dNum = dData[d][1] ? dData[d][1].toString() : "";
          var normalizedKey = dName.toLowerCase().replace(/[^a-z0-9]/g, "");
          if (normalizedKey && (normalizedKey.includes(normalizedInput) || normalizedInput.includes(normalizedKey))) {
            if (dNum) nameToStore = dName + " - " + dNum;
            break;
          }
        }
      }
    }

    var givenBy = me.username;                  // was the Google email (blank for most people)

    sheet.appendRow([
      todayStr, taskid, nameToStore, task, firstDate, "", "", firstDate, 0, "Pending", givenBy
    ]);
    tdStampCreated_(sheet, sheet.getLastRow(), me);
    return "Done";
  } catch(e) {
    throw new Error("Add New Error: " + e.message);
  } finally {
    lock.releaseLock();
  }
}

// --- UPDATED: REVISE TASK (Bypassing Mock Spreadsheet for reliability) ---
function addNext(token, options) {
  var me = ggmUser_(token);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("Master");
    var id = options.id.trim();
    var theDate = options.pl;

    var data = sheet.getDataRange().getValues();
    var rowIndex = -1;
    for (var i = 1; i < data.length; i++) {
      if (data[i][1].toString().trim() === id) {
        rowIndex = i + 1;
        break;
      }
    }

    if (rowIndex === -1) throw new Error("Task ID sheet mein nahi mili!");

    var currentRevs = parseInt(data[rowIndex - 1][8]) || 0;

    if (currentRevs > 1) {
      sheet.getRange(rowIndex, 10).setValue("Week Shifted");
      tdStampAction_(sheet, rowIndex, 'Week Shifted', me);

      var todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm:ss");
      var givenBy = me.username;

      var lastRow = sheet.getLastRow();
      var newId = "TK-001";
      var idData = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
      var maxNum = 0;
      for (var j = 0; j < idData.length; j++) {
        var idStr = idData[j][0] ? idData[j][0].toString().trim() : "";
        if (idStr.indexOf("TK-") === 0) {
          var numPart = parseInt(idStr.substring(3), 10);
          if (!isNaN(numPart) && numPart > maxNum) maxNum = numPart;
        }
      }
      var nextNumStr = (maxNum + 1).toString();
      while (nextNumStr.length < 3) nextNumStr = "0" + nextNumStr;
      newId = "TK-" + nextNumStr;

      sheet.appendRow([
        todayStr, newId, data[rowIndex-1][2], data[rowIndex-1][3], theDate, "", "", theDate, 0, "Pending", givenBy
      ]);
      tdStampCreated_(sheet, sheet.getLastRow(), me);
    } else {
      var newRevs = currentRevs + 1;
      sheet.getRange(rowIndex, 8).setValue(theDate);
      sheet.getRange(rowIndex, 9).setValue(newRevs);

      if (currentRevs === 0) {
        sheet.getRange(rowIndex, 6).setValue(theDate);
      } else if (currentRevs === 1) {
        sheet.getRange(rowIndex, 7).setValue(theDate);
      }
      tdStampAction_(sheet, rowIndex, 'Revised to ' + theDate, me);
    }
    return "Done";
  } catch(e) {
    throw new Error("Revise Error: " + e.message);
  } finally {
    lock.releaseLock();
  }
}

function fetchDue_(){
  var tomorrow = new Date(new Date().getTime() + (24 * 60 * 60 * 1000));
  let onlyDate = new Date(tomorrow.getFullYear(),tomorrow.getMonth(),tomorrow.getDate());
  let ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("Master");
  let lastRow = sheet.getLastRow();
  if(lastRow < 2) return [];

  let data = sheet.getRange(2, 1, lastRow - 1, 11).getValues();
  let pending = data.filter(function(row){
    let task_status = row[9];
    let last_revision = new Date(row[7]);
    if (task_status === "Pending" && last_revision < onlyDate) return row;
  });
  return pending;
}

function fetchAllPendings_(){
  let ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("Master");
  let lastRow = sheet.getLastRow();
  if(lastRow < 2) return [];

  let data = sheet.getRange(2, 1, lastRow - 1, 11).getValues();
  let pending = data.filter(row => row[9] === "Pending");
  pending.sort((a, b) => new Date(a[7]) - new Date(b[7]));
  return pending;
}

function fetchAllPendingData(token){
  ggmUser_(token);
  let data = fetchAllPendings_();
  let doerMap = getDoerMap_();
  let array = [];
  data.forEach(function(r){
    const storedName = r[2];
    let parts = storedName.split(' - ');
    let nameOnly = storedName;
    if (parts.length > 1 && /^\d+$/.test(parts[parts.length - 1].trim())) {
      parts.pop(); nameOnly = parts.join(' - ');
    }
    const doerDetails = doerMap[nameOnly] || { number: '', email: '' };
    array.push([r[1], nameOnly, r[3], safeFormatDate_(r[7]), doerDetails.number, doerDetails.email]);
  });
  return array;
}

function fetchRelevantData(token){
  ggmUser_(token);
  let data = fetchDue_();
  let doerMap = getDoerMap_();
  let array = [];
  data.forEach(function(r){
    const storedName = r[2];
    let parts = storedName.split(' - ');
    let nameOnly = storedName;
    if (parts.length > 1 && /^\d+$/.test(parts[parts.length - 1].trim())) {
      parts.pop(); nameOnly = parts.join(' - ');
    }
    const doerDetails = doerMap[nameOnly] || { number: '', email: '' };
    array.push([r[1], nameOnly, r[3], safeFormatDate_(r[7]), doerDetails.number, doerDetails.email]);
  });
  return array;
}

function getInfoByTaskID_(taskID){
  let worksheet = spreadsheet.sheet("Master");
  let task = worksheet.find('Task ID', taskID);
  const doerMap = getDoerMap_();
  const storedName = task["Name"];
  let parts = storedName.split(' - ');
  let nameOnly = storedName;
  if (parts.length > 1 && /^\d+$/.test(parts[parts.length - 1].trim())) {
    parts.pop(); nameOnly = parts.join(' - ');
  }
  const doerDetails = doerMap[nameOnly] || { number: '', email: '' };
  return {
    name: nameOnly, task: task["Task"], taskid: taskID, fdate: safeFormatDate_(task["First Date"]),
    number: doerDetails.number, email: doerDetails.email
  };
}

function getAllDoers(token){
  ggmUser_(token);
  let sheet = sss.getSheetByName("Doer List");
  let lastRow = sheet.getLastRow();
  if(lastRow < 2) return [];
  let data = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  let cleanData = [];
  data.forEach(row => {
    if (row[0] && String(row[0]).trim() !== '') {
      cleanData.push([row[0].toString().replace(" - ", " | "), row[1], row[2]]);
    }
  });
  return cleanData;
}

function getBuddyList(token) {
  ggmUser_(token);
  let sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Doer List');
  if (!sheet) return [];
  let lastRow = sheet.getLastRow();
  if(lastRow < 2) return [];
  let data = sheet.getRange(2, 4, lastRow - 1, 1).getValues();
  return data.filter(r => r[0] && r[0].toString().trim() !== "").map(r => r[0].toString().trim());
}

function assignBuddyInSheet(token, taskID, newBuddyName) {
  let me = ggmUser_(token);
  let lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    let sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Master");
    let data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][1] === taskID) {
        let newTaskDesc = "[Buddy Assigned by: " + data[i][2] + "]\n" + data[i][3];
        sheet.getRange(i + 1, 3).setValue(newBuddyName);
        sheet.getRange(i + 1, 4).setValue(newTaskDesc);
        tdStampAction_(sheet, i + 1, 'Buddy: ' + newBuddyName, me);
        break;
      }
    }
    return true;
  } finally {
    lock.releaseLock();
  }
}

function taskComplete(token, taskID, doneBy) {
  let me = ggmUser_(token);
  let lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    let sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Master");
    let data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][1] === taskID) {
        sheet.getRange(i + 1, 10).setValue("Completed");
        if (doneBy) sheet.getRange(i + 1, 13).setValue(doneBy);
        tdStampAction_(sheet, i + 1, 'Completed', me);
        break;
      }
    }
  } finally {
    lock.releaseLock();
  }
}