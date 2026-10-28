/**
 * JPR FLEET DASHBOARD — BACKEND (Code.gs)
 * Version: 4.0  (Login + auto rollover + shift + live task states)
 *
 * See Config.js  — shared constants, date & checklist helpers
 *     Auth.js    — login / sessions / OTP password reset
 *     Tasks.js   — rollover, completion, shift, trigger install
 */

function doGet(e) {
  var gate = portalGate_(e);          // GGM Portal: launch pass / Portal-only (Portal.js)
  if (gate.block) return gate.block;
  return portalInject_(HtmlService.createHtmlOutputFromFile('Index'), gate)
    .setTitle('JPR Fleet Dashboard')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');
}


// ─── HELPER: SAVE SINGLE IMAGE TO DRIVE ───
function saveFileToDrive_(base64Data, filename, folderId) {
  if (!base64Data) return '';
  try {
    var splitBase = base64Data.split(',');
    var type = splitBase[0].split(';')[0].replace('data:', '');
    var byteCharacters = Utilities.base64Decode(splitBase[1]);
    var blob = Utilities.newBlob(byteCharacters, type, filename);

    var folder = DriveApp.getFolderById(folderId);
    var file = folder.createFile(blob);

    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (sharingError) {
      Logger.log('Sharing blocked: ' + sharingError);
    }

    return file.getUrl();
  } catch (e) {
    throw new Error(e.message || e.toString());
  }
}

// ─── HELPER: SAVE MULTIPLE IMAGES TO DRIVE ───
function saveMultipleFilesToDrive_(base64Array, prefix, folderId) {
  if (!base64Array || base64Array.length === 0) return '';
  var urls = [];
  for (var i = 0; i < base64Array.length; i++) {
    var filename = prefix + '_' + new Date().getTime() + '_Part' + (i + 1) + '.jpg';
    urls.push(saveFileToDrive_(base64Array[i], filename, folderId));
  }
  return urls.join(' , \n');
}


// ─── API: SUBMIT FUEL FORM ────────────────────────────────────
function submitFuelForm(formData) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('FUEL DETAIL DRIVERS');
    if (!sheet) return { success: false, message: "Sheet 'FUEL DETAIL DRIVERS' not found!" };

    // Prefer the logged-in identity; fall back to the Google account.
    var userEmail = '', filledBy = '';
    try {
      var s = validateSession_(formData && formData.token);
      if (s) { userEmail = s.email; filledBy = s.username; }
    } catch (ignore) {}
    if (!filledBy && portalEnabled_()) return { success: false, message: 'Your sign-in has ended. Open the app again.' };
    if (!userEmail) userEmail = Session.getActiveUser().getEmail() || 'Not Logged In';
    // "Who filled" is the signed-in user, never a name picked in the form.
    var driver = filledBy || formData.driver;

    var fuelFolderId = '1bjLeMzjSwlp71-2CoJnSfk5U1d2B3SCu';
    var photoUrls = '';

    try {
      if (formData.photosBase64 && formData.photosBase64.length > 0) {
        photoUrls = saveMultipleFilesToDrive_(formData.photosBase64, 'Fuel_' + formData.vehicle, fuelFolderId);
      }
    } catch (err) {
      photoUrls = 'Upload Failed: ' + err.toString();
    }

    var timestamp = Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm:ss');

    var rowData = [
      timestamp,               // A
      driver,                  // B  signed-in user
      formData.vehicle,        // C
      formData.fuelType,       // D
      formData.qty,            // E
      formData.amount,         // F
      formData.odo,            // G
      photoUrls,               // H
      userEmail,               // I
      formData.paymentMode,    // J
      formData.pumpName,       // K
      formData.remark || ''    // L
    ];

    var nextRow = getRealLastRow(sheet) + 1;
    sheet.getRange(nextRow, 1, 1, rowData.length).setValues([rowData]);
    SpreadsheetApp.flush();

    return { success: true };
  } catch (e) {
    return { success: false, message: 'Error: ' + e.toString() };
  } finally {
    lock.releaseLock();
  }
}


// ─── API: SUBMIT SERVICE FORM ─────────────────────────────────
function submitServiceForm(formData) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('SERVICE COST');
    if (!sheet) return { success: false, message: "Sheet 'SERVICE COST' not found!" };

    var userEmail = '', filledBy = '';
    try {
      var s = validateSession_(formData && formData.token);
      if (s) { userEmail = s.email; filledBy = s.username; }
    } catch (ignore) {}
    if (!filledBy && portalEnabled_()) return { success: false, message: 'Your sign-in has ended. Open the app again.' };
    if (!userEmail) userEmail = Session.getActiveUser().getEmail() || 'Not Logged In';
    // "Who filled" is the signed-in user, never a name picked in the form.
    var driver = filledBy || formData.driver;

    var serviceFolderId = '1FYFPRq6dfjiYtgbqqAlrBZ7zysohN6H3';
    var photoUrls = '';

    try {
      if (formData.photosBase64 && formData.photosBase64.length > 0) {
        photoUrls = saveMultipleFilesToDrive_(formData.photosBase64, 'Service_' + formData.vehicle, serviceFolderId);
      }
    } catch (err) {
      photoUrls = 'Upload Failed: ' + err.toString();
    }

    var timestamp = Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm:ss');

    var rowData = [
      timestamp,           // A
      driver,              // B  signed-in user
      formData.vehicle,    // C
      formData.odo,        // D
      formData.issue,      // E
      formData.amount,     // F
      photoUrls,           // G
      userEmail            // H
    ];

    var nextRow = getRealLastRow(sheet) + 1;
    sheet.getRange(nextRow, 1, 1, rowData.length).setValues([rowData]);
    SpreadsheetApp.flush();

    return { success: true };
  } catch (e) {
    return { success: false, message: 'Error: ' + e.toString() };
  } finally {
    lock.releaseLock();
  }
}


/** The dashboard still loads if the Checklist cannot be read. */
function safeHistory_() {
  try { return monthHistory_(); } catch (e) { Logger.log('taskHistory_: ' + e); return []; }
}

// ─── API: GET DASHBOARD DATA ─────────────────
/**
 * @param {string} token  session token — tasks are only returned when valid.
 */
function getLiveFleetData(token) {
  try {
    var session = null;
    try { session = validateSession_(token); } catch (ignore) {}
    // Connected to GGM Portal: no fleet data without a session (the page then shows its login).
    if (!session && portalEnabled_()) return JSON.stringify({ success: true, authed: false });

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let fuelData = [];
    let serviceData = [];
    let tasksData = [];
    let uniqueDrivers = new Set();
    let uniqueVehicles = new Set();

    let formDrivers = [];
    let formVehicles = [];
    let serviceConfig = {};

    // ── Users sheet: dropdown sources (cols A & B, untouched) ──
    try {
      const usersSheet = ss.getSheetByName(SHEET_USERS);
      if (usersSheet) {
        usersSheet.getRange('A2:A').getValues().forEach(r => {
          if (r[0] && String(r[0]).trim() !== '') formDrivers.push(String(r[0]).trim());
        });
        usersSheet.getRange('B2:B').getValues().forEach(r => {
          if (r[0] && String(r[0]).trim() !== '') formVehicles.push(String(r[0]).trim());
        });
      }
    } catch (e) {}

    // ── MASTER: tasks with computed live state ──
    try {
      const masterSheet = ss.getSheetByName(SHEET_MASTER);
      if (masterSheet && session) {
        const cols  = ensureMasterCols_(masterSheet);
        const today = todayStart_();
        const lastRow = masterSheet.getLastRow();
        const notesByTask = allOpenNotes_();   // one read for the whole sheet

        if (lastRow > 1) {
          const width = Math.max(masterSheet.getLastColumn(), cols.LAST_NOTE);
          const mData = masterSheet.getRange(2, 1, lastRow - 1, width).getDisplayValues();

          for (let i = 0; i < mData.length; i++) {
            const r = mData[i];
            if (!String(r[0] || '').trim()) continue;

            const sch = parseSchedule_(r[2]);
            const taskName = String(r[3] || '').trim();
            const car      = String(r[1] || '').trim();

            // A Freq the scheduler cannot read is surfaced, not silently dropped.
            if (sch.kind === 'invalid') {
              tasksData.push({
                rowIdx: i + 2, id: String(r[0]).trim(), car: car, taskName: taskName,
                schedKind: 'invalid', schedLabel: sch.label, schedShort: '?',
                dueStr: String(r[4] || '').trim(), state: 'broken', visible: true,
                status: 'CHECK FREQ', doneBy: '', lastDoneStr: '',
                shiftUsed: 0, shiftLeft: 0, canShift: false,
                overdueDays: 0, daysToGo: 0, missedCount: 0,
                canNote: false, notes: []
              });
              continue;
            }

            const anchor = resolveAnchor_(sch, r[cols.ANCHOR - 1], r[4], today);
            if (!anchor) continue;

            const shiftUsed = parseInt(r[cols.SHIFT_USED - 1], 10) || 0;
            const due       = addDays_(anchor, shiftUsed);
            const lastDoneS = String(r[cols.LAST_DONE - 1] || '').trim();
            const lastDone  = parseDMY_(lastDoneS);

            const st = computeTaskState_(sch, due, lastDone, shiftUsed, today);
            // A daily task shows today's date even before the nightly rollover
            // has rewritten column E, so the card never reads a stale date.
            const shownDue = st.effectiveDue || due;

            tasksData.push({
              rowIdx     : i + 2,
              id         : String(r[0]).trim(),
              car        : car,
              taskName   : taskName,
              schedKind  : sch.kind,
              schedLabel : sch.label,
              schedShort : sch.short,
              anchorStr  : fmtDMY_(anchor),
              dueStr     : fmtDMY_(shownDue),
              status     : String(r[5] || '').trim(),
              doneBy     : String(r[6] || '').trim(),
              lastDoneStr: lastDoneS,
              shiftUsed  : shiftUsed,
              shiftLeft  : st.shiftLeft,
              canShift   : st.canShift,
              state      : st.state,
              visible    : st.visible,
              overdueDays: st.overdueDays,
              daysToGo   : st.daysToGo,
              missedCount: parseInt(r[cols.MISSED_COUNT - 1], 10) || 0,
              canNote    : sch.kind !== 'daily',
              notes      : (notesByTask[String(r[0]).trim()] || []).map(function (n) {
                return { author: n.author, email: n.email, text: n.text, when: n.when };
              })
            });
          }
        }
      }
    } catch (e) {
      Logger.log('MASTER read error: ' + e);
    }

    // ── Service interval config ──
    try {
      const reportSheet = ss.getSheetByName('Vehicle Fuel Report');
      if (reportSheet) {
        const lastRow = reportSheet.getLastRow();
        if (lastRow >= 8) {
          reportSheet.getRange(8, 12, lastRow - 7, 2).getValues().forEach(row => {
            const vName = String(row[0]).trim();
            const vInterval = parseFloat(row[1]);
            if (vName && !isNaN(vInterval) && vInterval > 0) serviceConfig[vName] = vInterval;
          });
        }
      }
    } catch (e) {}

    const parseDateForSort = (dStr) => {
      if (!dStr) return 0;
      let str = String(dStr).trim();
      let parts = str.split(' ');
      let dPart = parts[0];
      let tPart = parts[1] || '00:00:00';
      if (dPart.includes('/')) {
        let dArr = dPart.split('/');
        if (dArr.length === 3) return new Date(`${dArr[2]}-${dArr[1]}-${dArr[0]}T${tPart}`).getTime();
      }
      return new Date(str).getTime() || 0;
    };

    // ── Fuel log + mileage maths ──
    const fuelSheet = ss.getSheetByName('FUEL DETAIL DRIVERS');
    if (fuelSheet) {
      const fuelVals = fuelSheet.getDataRange().getDisplayValues();
      let rawByVehicle = {};

      for (let i = 1; i < fuelVals.length; i++) {
        const row = fuelVals[i];
        if (!row || row.length < 6) continue;

        const dateVal = String(row[0]).trim();
        let driverName = String(row[1]).trim();
        const vehicleNo = String(row[2]).trim();

        if (!dateVal || dateVal.toLowerCase() === 'date' || dateVal.toLowerCase() === 'timestamp') continue;
        if (!driverName || driverName.length < 2) driverName = 'Unknown';
        else uniqueDrivers.add(driverName);
        if (vehicleNo && vehicleNo.length > 2) uniqueVehicles.add(vehicleNo);

        const entry = {
          date: dateVal.split(' ')[0] || dateVal,
          rawDateObj: parseDateForSort(dateVal),
          driver: driverName,
          vehicle: vehicleNo || 'Unknown',
          fuelType: String(row[3]).trim() || 'DIESEL',
          qty: parseFloat(String(row[4]).replace(/[^\d.-]/g, '')) || 0,
          amount: parseFloat(String(row[5]).replace(/[^\d.-]/g, '')) || 0,
          odo: parseFloat(String(row[6]).replace(/[^\d.-]/g, '')) || 0,
          pump: String(row[10] || '').trim()
        };

        if (!rawByVehicle[entry.vehicle]) rawByVehicle[entry.vehicle] = [];
        rawByVehicle[entry.vehicle].push(entry);
      }

      for (const v in rawByVehicle) {
        rawByVehicle[v].sort((a, b) => a.rawDateObj - b.rawDateObj);
        let validPrevOdo = null;

        rawByVehicle[v].forEach((curr) => {
          let range = null;
          if (validPrevOdo !== null && curr.odo > validPrevOdo) {
            range = curr.odo - validPrevOdo;
            if (range > 3000) range = null;
          }
          const mileage = (range !== null && range > 0 && curr.qty > 0) ? +(range / curr.qty).toFixed(2) : null;
          const costKm = (range !== null && range > 0 && curr.amount > 0) ? +(curr.amount / range).toFixed(2) : null;
          if (curr.odo > 0) validPrevOdo = curr.odo;

          fuelData.push({
            id: 'F' + Math.random().toString(36).substr(2, 8),
            type: 'FUEL', date: curr.date, driver: curr.driver, vehicle: curr.vehicle,
            qty: curr.qty, amount: curr.amount, odo: curr.odo, pump: curr.pump,
            range: range, mileage: mileage, costPerKm: costKm
          });
        });
      }
      fuelData.reverse();
    }

    // ── Service log ──
    const serviceSheet = ss.getSheetByName('SERVICE COST');
    if (serviceSheet) {
      const serviceVals = serviceSheet.getDataRange().getDisplayValues();
      for (let i = 1; i < serviceVals.length; i++) {
        const row = serviceVals[i];
        if (!row || row.length < 5) continue;

        const dateVal = String(row[0]).trim();
        let driverName = String(row[1]).trim();
        const vehicleNo = String(row[2]).trim();

        if (!dateVal || dateVal.toLowerCase() === 'date' || dateVal.toLowerCase() === 'timestamp') continue;
        if (!driverName || driverName.length < 2) driverName = 'Unknown';
        else uniqueDrivers.add(driverName);
        if (vehicleNo && vehicleNo.length > 2) uniqueVehicles.add(vehicleNo);

        serviceData.push({
          id: 'S' + Math.random().toString(36).substr(2, 8),
          type: 'SERVICE', date: dateVal.split(' ')[0] || dateVal,
          driver: driverName, vehicle: vehicleNo || 'Unknown',
          odo: String(row[3]).replace(/[^\d.-]/g, '').trim() || '0',
          issue: String(row[4]).trim() || 'Routine Service',
          amount: parseFloat(String(row[5]).replace(/[^\d.-]/g, '')) || 0
        });
      }
      serviceData.reverse();
    }

    return JSON.stringify({
      success: true,
      authed: !!session,
      user: session ? { name: session.name, email: session.email, role: session.role, username: session.username } : null,
      version: APP_VERSION,
      serverTime: fmtClock_(new Date()),
      serverDate: fmtDMY_(todayStart_()),
      drivers: Array.from(uniqueDrivers).sort(),
      vehicles: Array.from(uniqueVehicles).sort(),
      formDrivers: formDrivers,
      formVehicles: formVehicles,
      serviceConfig: serviceConfig,
      fuel: fuelData,
      service: serviceData,
      tasks: tasksData,
      // Driver tiles + history: every completion in the Checklist, and who can sign in.
      taskLog: session ? safeHistory_() : [],   // this month; the full log loads with a driver's history
      people: session ? fleetPeople_(ss) : []
    });

  } catch (err) {
    return JSON.stringify({ success: false, message: err.toString() });
  }
}
