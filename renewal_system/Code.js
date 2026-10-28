/**
 * ============================================================================
 *  G G MINERALS  —  DOCUMENT RENEWAL & TASK DELEGATION SYSTEM
 *  Google Apps Script for "Detail Filled Sheet"
 * ============================================================================
 */

// ---------------------------------------------------------------- constants
var FEED       = 'Task Feed';
var LOG        = 'Renewal Log';
var ENTRY_TABS = {
  'VEH': 'Vehicle Documents',
  'POL': 'Personal Policies',
  'MIN': 'Mining Documents'
};

var FEED_FIRST_ROW = 5;
var FEED_LAST_ROW  = 154;   // 150 display rows
var F_ID = 2, F_TITLE = 5, F_ASSIGNEE = 7, F_RENEWED = 14, F_NEWDATE = 15, F_COST = 16, F_DONE = 17;
var F_DOCLINK = 20, F_STATUS = 21, F_REMARK = 22;

var LOG_FIRST_ROW = 5;
var L_LOGGED = 2, L_DOCID = 3, L_PREV = 7, L_NEW = 8, L_RENEWED = 9, L_COST = 10, L_BY = 11, L_NOTE = 12;

var E_FIRST_ROW = 5;
var E_ID = 1, E_VALIDUNTIL = 7;
var E_DOCLINK = 20;


// ---------------------------------------------------------------- menu
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Renewals')
    .addItem('✅  Complete ticked renewals', 'completeTickedRenewals')
    .addSeparator()
    .addItem('📋  How many tasks are open?', 'showTaskCount')
    .addItem('📧  E-mail today\'s task list to me', 'emailTaskList')
    .addSeparator()
    .addItem('⚙️  Re-run setup (checkboxes + menu)', 'setup')
    .addToUi();
}

/** Run this once after pasting the script. */
function setup() {
  var ss = SpreadsheetApp.getActive();
  var feed = ss.getSheetByName(FEED);
  if (!feed) throw new Error('Sheet "' + FEED + '" not found.');

  var rule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  feed.getRange(FEED_FIRST_ROW, F_DONE, FEED_LAST_ROW - FEED_FIRST_ROW + 1, 1)
      .setDataValidation(rule)
      .setHorizontalAlignment('center');

  onOpen();
  SpreadsheetApp.getUi().alert(
    'Setup complete.\n\n' +
    'The DONE column is now tick-boxes and the "Renewals" menu is installed.\n\n' +
    'Reload the spreadsheet if you do not see the menu yet.');
}


// ---------------------------------------------------------------- main action
function completeTickedRenewals() {
  var ss   = SpreadsheetApp.getActive();
  var ui   = SpreadsheetApp.getUi();
  var feed = ss.getSheetByName(FEED);
  var log  = ss.getSheetByName(LOG);
  if (!feed || !log) { ui.alert('Task Feed or Renewal Log sheet is missing.'); return; }

  var nRows = FEED_LAST_ROW - FEED_FIRST_ROW + 1;
  // Fetch up to Column V (Remark) to ensure we capture the Document Link, Status, and Remark data
  var values = feed.getRange(FEED_FIRST_ROW, 1, nRows, F_REMARK).getValues();

  // ---- 1. collect every ticked row into memory FIRST -----------------------
  var jobs = [], problems = [];
  for (var i = 0; i < values.length; i++) {
    var row      = values[i];
    var done     = row[F_DONE - 1];
    var isTicked = (done === true) || (String(done).trim().toUpperCase() === 'DONE');
    if (!isTicked) continue;

    var sheetRow = FEED_FIRST_ROW + i;
    var docId    = String(row[F_ID - 1] || '').trim();
    var title    = String(row[F_TITLE - 1] || '');
    var renewed  = row[F_RENEWED - 1];
    var newDate  = row[F_NEWDATE - 1];
    var cost     = row[F_COST - 1];
    var docLink  = String(row[F_DOCLINK - 1] || '').trim();

    if (!docId)              { problems.push('Row ' + sheetRow + ': ticked but the row is empty.'); continue; }
    if (!(newDate instanceof Date)) {
      problems.push('Row ' + sheetRow + ' (' + docId + '): NEW VALID UNTIL is missing or is not a date.');
      continue;
    }
    if (!(renewed instanceof Date)) renewed = new Date();   // default to today

    jobs.push({ feedRow: sheetRow, docId: docId, title: title,
                renewed: renewed, newDate: newDate,
                cost: (typeof cost === 'number' ? cost : 0),
                docLink: docLink });
  }

  if (problems.length) {
    ui.alert('Please fix these first:\n\n' + problems.join('\n'));
    return;
  }
  if (!jobs.length) {
    ui.alert('Nothing to do.\n\nTick the DONE box on a Task Feed row and fill RENEWED ON, ' +
             'NEW VALID UNTIL and TOTAL COST first.');
    return;
  }

  // ---- 2. cache each entry tab's Doc ID column -----------------------------
  var idIndex = {};
  for (var pfx in ENTRY_TABS) {
    var sh = ss.getSheetByName(ENTRY_TABS[pfx]);
    if (!sh) continue;
    var last = sh.getLastRow();
    if (last < E_FIRST_ROW) continue;
    var ids = sh.getRange(E_FIRST_ROW, E_ID, last - E_FIRST_ROW + 1, 1).getValues();
    for (var k = 0; k < ids.length; k++) {
      var id = String(ids[k][0] || '').trim();
      if (id) idIndex[id] = { sheet: sh, row: E_FIRST_ROW + k };
    }
  }

  // ---- 3. find the first free line in the Renewal Log ----------------------
  var logLast = log.getLastRow();
  var logIds  = logLast >= LOG_FIRST_ROW
      ? log.getRange(LOG_FIRST_ROW, L_DOCID, logLast - LOG_FIRST_ROW + 1, 1).getValues()
      : [];
  var nextLogRow = LOG_FIRST_ROW;
  for (var m = 0; m < logIds.length; m++) {
    if (String(logIds[m][0] || '').trim() !== '') nextLogRow = LOG_FIRST_ROW + m + 1;
  }

  // ---- 4. apply every job and build batch payload for log -------------------
  var who  = Session.getActiveUser().getEmail() || 'unknown';
  var now  = new Date();
  var ok = 0, skipped = [];
  var logDataPayload = [];

  for (var j = 0; j < jobs.length; j++) {
    var job = jobs[j];
    var target = idIndex[job.docId];
    if (!target) { skipped.push(job.docId + ' - not found on any entry tab'); continue; }

    var validCell = target.sheet.getRange(target.row, E_VALIDUNTIL);
    var previous  = validCell.getValue();

    // Write the new expiry date back into the entry tab
    validCell.setValue(job.newDate);
    
    // Write the Document Link back into the entry tab (Column T) if provided
    if (job.docLink) {
      target.sheet.getRange(target.row, E_DOCLINK).setValue(job.docLink);
    }

    // Accumulate the line for the Renewal Log
    // Layout: [Timestamp, DocID, (blank, blank, blank), Prev Date, New Date, Renewed, Cost, By, Note]
    // Since columns 4, 5, 6 are skipped, we just set the specific columns using an array or setValue
    // Due to the gap, it's safer to keep the targeted setValues for the exact columns.
    
    // Asymmetric leap: Combining the log updates into fewer API calls where possible,
    // but preserving exact column placement mapping.
    log.getRange(nextLogRow, L_LOGGED ).setValue(now);
    log.getRange(nextLogRow, L_DOCID  ).setValue(job.docId);
    log.getRange(nextLogRow, L_PREV   ).setValue(previous);
    log.getRange(nextLogRow, L_NEW    ).setValue(job.newDate);
    log.getRange(nextLogRow, L_RENEWED).setValue(job.renewed);
    log.getRange(nextLogRow, L_COST   ).setValue(job.cost);
    log.getRange(nextLogRow, L_BY     ).setValue(who);
    log.getRange(nextLogRow, L_NOTE   ).setValue(job.title);
    
    nextLogRow++;
    ok++;
  }

  // ---- 5. clear the inputs in Task Feed on every row we handled ------------
  for (var c = 0; c < jobs.length; c++) {
    var rowToClear = jobs[c].feedRow;
    
    // Clear RENEWED ON, NEW VALID UNTIL, TOTAL COST (N:P)
    feed.getRange(rowToClear, F_RENEWED, 1, 3).clearContent();
    
    // Properly uncheck the DONE box (Q) without breaking data validation
    feed.getRange(rowToClear, F_DONE).uncheck();
    
    // Clear Documents Link, Status, Remark (T:V)
    feed.getRange(rowToClear, F_DOCLINK, 1, 3).clearContent();
  }

  SpreadsheetApp.flush();

  var msg = ok + ' renewal' + (ok === 1 ? '' : 's') + ' completed and logged.';
  if (skipped.length) msg += '\n\nSkipped:\n' + skipped.join('\n');
  msg += '\n\nThose tasks have left the Task Feed and will return automatically ' +
         'when the next renewal falls due.';
  ui.alert(msg);
}


// ---------------------------------------------------------------- helpers
/** Ticking DONE auto-fills RENEWED ON with today if it is empty. */
function onEdit(e) {
  if (!e || !e.range || !e.value) return; // Added safety check
  var sh = e.range.getSheet();
  if (sh.getName() !== FEED) return;
  if (e.range.getColumn() !== F_DONE) return;
  var row = e.range.getRow();
  if (row < FEED_FIRST_ROW || row > FEED_LAST_ROW) return;

  var ticked = (e.value === 'TRUE' || e.value === true || String(e.value).toUpperCase() === 'DONE');
  if (!ticked) return;
  var renewedCell = sh.getRange(row, F_RENEWED);
  if (renewedCell.getValue() === '') renewedCell.setValue(new Date());
}

function countOpenTasks_() {
  var feed = SpreadsheetApp.getActive().getSheetByName(FEED);
  var ids  = feed.getRange(FEED_FIRST_ROW, F_ID, FEED_LAST_ROW - FEED_FIRST_ROW + 1, 1).getValues();
  var n = 0;
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0] || '').trim() !== '') n++;
  return n;
}

function showTaskCount() {
  SpreadsheetApp.getUi().alert(
    countOpenTasks_() + ' document(s) are currently EXPIRED or at ACTION NOW.\n\n' +
    'They are listed on the Task Feed tab, most urgent first.');
}

function emailTaskList() {
  var feed = SpreadsheetApp.getActive().getSheetByName(FEED);
  var rows = feed.getRange(FEED_FIRST_ROW, 1, FEED_LAST_ROW - FEED_FIRST_ROW + 1, 13).getValues();
  var tz   = SpreadsheetApp.getActive().getSpreadsheetTimeZone();

  var body = '<h3>Document renewals needing action</h3>' +
             '<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:Arial;font-size:13px">' +
             '<tr style="background:#0B1F33;color:#fff">' +
             '<th>#</th><th>Task</th><th>Assignee</th><th>Due</th><th>Days left</th><th>Status</th></tr>';
  var n = 0;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (String(r[F_ID - 1] || '').trim() === '') break;
    n++;
    var due = (r[9] instanceof Date) ? Utilities.formatDate(r[9], tz, 'dd-MMM-yyyy') : r[9];
    var bg  = (String(r[12]) === 'EXPIRED') ? '#FEE2E2' : '#FFEDD5';
    body += '<tr style="background:' + bg + '"><td>' + r[0] + '</td><td>' + r[4] +
            '</td><td>' + r[6] + '</td><td>' + due + '</td><td align="right">' + r[10] +
            '</td><td><b>' + r[12] + '</b></td></tr>';
  }
  body += '</table><p style="font-family:Arial;font-size:12px;color:#666">' +
          n + ' open task(s). Generated automatically from the renewal system.</p>';

  MailApp.sendEmail({
    to: Session.getActiveUser().getEmail(),
    subject: 'Document renewals — ' + n + ' task(s) need action',
    htmlBody: body
  });
}