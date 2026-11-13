/**
 * One-time fix (31 Oct 2026), safe to run again. Run from the editor: migrateRenewalFix
 *  1. sheet time zone → India (it was Pacific, so TODAY() and statuses turned over at ~1:30 pm IST)
 *  2. 'Feed Inputs' tab + formulas in the Task Feed input columns (N–Q, T–X). The values typed
 *     on the feed rows were sitting next to the wrong documents, so they are logged and dropped.
 *  3. Renewal Log formulas (and every formula that reads the log) reach row 2000 instead of 302
 *  4. re-applies renewals whose new expiry is in the log but not on the entry tab
 */
/**
 * 1 Nov 2026: before the migration ran, opening the sheet saved the old misplaced typed values
 * (a "Completed" / "Pending" status on the wrong documents, unticked boxes) into Feed Inputs.
 * Removes rows that hold nothing but those; a row with any date, cost, link, remark or tick stays.
 */
function clearCapturedJunk() {
  var ss = SpreadsheetApp.getActive(), sh = rcInputsSheet_(ss), n = sh.getLastRow() - 1, out = [];
  if (n < 1) { Logger.log('Feed Inputs is empty'); return; }
  var rows = sh.getRange(2, 1, n, RC_HEAD.length).getValues();
  for (var i = n - 1; i >= 0; i--) {
    var r = rows[i], f = {};
    RC_FIELDS.forEach(function (k, j) { f[k] = r[j + 1]; });
    var real = f.renewedOn !== '' || f.newValid !== '' || f.cost !== '' || f.done === true || f.link !== '' ||
               f.remark !== '' || f.actionBy !== '' || ['', 'Pending', 'Completed'].indexOf(String(f.status).trim()) === -1;
    if (real) { out.push('kept ' + r[0]); continue; }
    sh.deleteRow(i + 2);
    out.push('removed ' + r[0] + (f.status ? ' (' + f.status + ')' : ''));
  }
  Logger.log(out.reverse().join('\n'));
}

function migrateRenewalFix() {
  var ss = SpreadsheetApp.getActive(), out = [];

  // 1 ---------------------------------------------------------------------------
  if (ss.getSpreadsheetTimeZone() !== 'Asia/Kolkata') {
    out.push('time zone ' + ss.getSpreadsheetTimeZone() + ' → Asia/Kolkata');
    ss.setSpreadsheetTimeZone('Asia/Kolkata');
  }

  // 2 ---------------------------------------------------------------------------
  var inp = rcInputsSheet_(ss);
  inp.getRange('B:C').setNumberFormat('dd-mmm-yyyy');
  inp.getRange('J:K').setNumberFormat('dd-mmm-yyyy hh:mm');
  var feed = ss.getSheetByName(FEED), n = FEED_LAST_ROW - FEED_FIRST_ROW + 1;
  var ids = feed.getRange(FEED_FIRST_ROW, F_ID, n, 1).getValues();
  Object.keys(FEED_INPUT_COLS).map(Number).forEach(function (c) {
    var rng = feed.getRange(FEED_FIRST_ROW, c, n, 1), f = rng.getFormulasR1C1(), v = rng.getValues();
    for (var i = 0; i < n; i++) {
      if (!f[i][0] && v[i][0] !== '' && v[i][0] !== false) out.push('dropped feed row ' + (FEED_FIRST_ROW + i) + ' (' + ids[i][0] + ') col ' + c + ': ' + v[i][0]);
    }
    rng.setFormulaR1C1(feedFormulaR1C1_(c));
  });
  feed.getRange(FEED_FIRST_ROW, F_DONE, n, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());

  // 3 ---------------------------------------------------------------------------
  var log = ss.getSheetByName(RC_LOG);
  if (log.getMaxRows() < 2000) log.insertRowsAfter(log.getMaxRows(), 2000 - log.getMaxRows());
  if (!log.getRange(2000, 13).getFormula()) {
    log.getRange(302, 1, 1, 13).copyTo(log.getRange(303, 1, 2000 - 302, 13));
    out.push('Renewal Log formulas copied to rows 303-2000');
  }
  ss.getSheets().forEach(function (sh) {
    var k = sh.createTextFinder('$302').matchFormulaText(true).replaceAllWith('$2000');
    if (k) out.push(sh.getName() + ': ' + k + ' formula(s) now read the log to row 2000');
  });
  SpreadsheetApp.flush();

  // 4 ---------------------------------------------------------------------------
  var lr = log.getLastRow(), latest = {};
  log.getRange(RC_LOG_FIRST, 1, lr - RC_LOG_FIRST + 1, 12).getValues().forEach(function (r) {
    var id = String(r[2] || '').trim();
    if (id) latest[id] = { prev: r[6], next: r[7] };
  });
  Object.keys(latest).forEach(function (id) {
    var L = latest[id], doc = rcFindDoc_(ss, id);
    if (!doc || !(L.prev instanceof Date) || !(L.next instanceof Date) || rcDay_(L.next) <= rcDay_(L.prev)) return;
    var cell = doc.sheet.getRange(doc.row, RC_E_VALID), cur = cell.getValue();
    if (cur instanceof Date && rcDay_(cur) === rcDay_(L.prev)) {
      cell.setValue(L.next);
      out.push('re-applied ' + id + ' (' + doc.sheet.getName() + ' row ' + doc.row + '): ' + rcShow_(L.prev) + ' → ' + rcShow_(L.next));
    }
  });
  SpreadsheetApp.flush();
  Object.keys(latest).forEach(function (id) {
    var L = latest[id], doc = rcFindDoc_(ss, id);
    if (!doc || !(L.next instanceof Date)) return;
    var cur = doc.sheet.getRange(doc.row, RC_E_VALID).getValue();
    if (!(cur instanceof Date) || rcDay_(cur) !== rcDay_(L.next)) out.push('CHECK ' + id + ': entry tab says ' + (cur instanceof Date ? rcShow_(cur) : cur) + ', last log says ' + rcShow_(L.next));
  });

  Logger.log(out.join('\n') || 'nothing to do');
  return out;
}
