/**
 * TASK DELEGATION — GGM PORTAL LOGIN (v2)
 * The shared login is GgmLogin.js (same file in every v2 app).
 *
 * Who can sign in: the tab "Portal Users DELEGATION" in the Delegated sheet,
 * written by GGM Portal when the admin ticks Task Delegation for someone.
 * Every page call carries the token; the server takes the person from it.
 *
 * What changed in the sheet (old rows untouched):
 *   Master K  Given By = portal username (was the Google email, mostly blank)
 *   Master U–X Created By · Last Action · Last Action By · Last Action At
 *              (the same columns Main Admin Dashboard stamps)
 */

var GGM_APP = {
  id: 'DELEGATION',
  name: 'Task Delegation',
  hub: 'https://script.google.com/macros/s/AKfycbyWO02yOI3G9IcE1QjCMEvvJostJZL7_2o8DSYIMEswCtI9Ub8sI9uBTdMp_Zd0WSXvSQ/exec?app=DELEGATION',
  sheetId: '1tEUckPww1GiD-PgP7yxMxt70W1Q-ueoUGXdI8_-Aq8A',   // the Delegated sheet (holds "Portal Users DELEGATION")

  /** Badge: follow-ups due by tomorrow (the same list as the Follow Up tab, same number for everyone). */
  counts: function (list) {
    var n = fetchDue_().length, out = {};
    list.forEach(function (x) { out[x.u] = n; });
    return out;
  }
};

/** Requests from GGM Portal (badges, connection test). */
function doPost(e) {
  return ggmHandlePost_(e) || ContentService.createTextOutput('Not found');
}

/* ---- who did what: Master U–X, same columns and labels as Main Admin Dashboard ---- */

var TD_STAMP_COL = 21;   // U

function tdNow_() { return Utilities.formatDate(new Date(), 'GMT+05:30', 'dd/MM/yyyy HH:mm:ss'); }

function tdStampCreated_(sheet, row, me) {
  tdStamp_(sheet, row, TD_STAMP_COL, ['Created By', 'Last Action', 'Last Action By', 'Last Action At'], [me.username, 'Created', me.username, tdNow_()]);
}

function tdStampAction_(sheet, row, action, me) {
  tdStamp_(sheet, row, TD_STAMP_COL + 1, ['Last Action', 'Last Action By', 'Last Action At'], [action, me.username, tdNow_()]);
}

/** Writes the header if the cells are empty; if a header holds something else, nothing is stamped (never overwrite other data). */
function tdStamp_(sheet, row, startCol, labels, values) {
  try {
    var need = startCol + labels.length - 1;
    if (sheet.getMaxColumns() < need) sheet.insertColumnsAfter(sheet.getMaxColumns(), need - sheet.getMaxColumns());
    var head = sheet.getRange(1, startCol, 1, labels.length).getValues()[0];
    for (var i = 0; i < labels.length; i++) {
      var h = String(head[i] || '').trim();
      if (!h) sheet.getRange(1, startCol + i).setValue(labels[i]).setFontWeight('bold');
      else if (h !== labels[i]) { console.warn('tdStamp_: column ' + (startCol + i) + ' is "' + h + '". Not stamped.'); return; }
    }
    sheet.getRange(row, startCol, 1, values.length).setValues([values]);
  } catch (e) { console.error('tdStamp_: ' + e); }
}
