/**
 * ============================================================================
 *  G G MINERALS  —  DOCUMENT RENEWAL & TASK DELEGATION SYSTEM
 *  Google Apps Script bound to the "Renewal Record" sheet.
 *  Shared renewal logic (Feed Inputs, applying a renewal) is in RenewalCore.js.
 * ============================================================================
 */

// ---------------------------------------------------------------- constants
var FEED       = 'Task Feed';

var FEED_FIRST_ROW = 5;
var FEED_LAST_ROW  = 154;   // 150 display rows
var F_ID = 2, F_TITLE = 5, F_ASSIGNEE = 7, F_RENEWED = 14, F_NEWDATE = 15, F_COST = 16, F_DONE = 17;
var F_DOCLINK = 20, F_STATUS = 21, F_REMARK = 22, F_ACTION_AT = 24;

// Task Feed column → Feed Inputs field. These cells hold formulas that show the Feed Inputs row of
// the document in column B; whatever is typed into them is moved to Feed Inputs (onEdit).
var FEED_INPUT_COLS = { 14: 'renewedOn', 15: 'newValid', 16: 'cost', 17: 'done', 20: 'link', 21: 'status', 22: 'remark', 23: 'actionBy', 24: 'actionAt' };


// ---------------------------------------------------------------- menu
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Renewals')
    .addItem('✅  Complete ticked renewals', 'completeTickedRenewals')
    .addSeparator()
    .addItem('📋  How many tasks are open?', 'showTaskCount')
    .addItem('📧  E-mail today\'s task list to me', 'emailTaskList')
    .addSeparator()
    .addItem('🔧  Repair Task Feed (typed cells)', 'repairFeed')
    .addItem('⚙️  Re-run setup (checkboxes + menu)', 'setup')
    .addToUi();
  try { repairFeed_(); } catch (e) {}   // viewers cannot write; editors get any stray typed cells saved
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


// ---------------------------------------------------------------- Task Feed input cells
/** The formula a Task Feed input cell holds: the value from Feed Inputs for the document in column B. */
function feedFormulaR1C1_(col) {
  var k = RC_FIELDS.indexOf(FEED_INPUT_COLS[col]) + 2;
  var look = "INDEX('" + RC_INPUTS + "'!C" + k + ",MATCH(R[0]C2,'" + RC_INPUTS + "'!C1,0))";
  if (col === F_DONE) return '=IF(R[0]C2="",FALSE,IFERROR(' + look + '=TRUE,FALSE))';
  return '=IF(R[0]C2="","",IFERROR(IF(LEN(' + look + ')=0,"",' + look + '),""))';
}

/** Moves anything typed into the Task Feed input cells of rows r0.. / columns c0.. to Feed Inputs
 *  (under the Doc ID in column B of that row) and puts the formulas back. Returns cells saved. */
function captureFeedEdits_(feed, r0, nr, c0, nc) {
  var rStart = Math.max(r0, FEED_FIRST_ROW), rEnd = Math.min(r0 + nr - 1, FEED_LAST_ROW);
  if (rStart > rEnd) return 0;
  var cols = Object.keys(FEED_INPUT_COLS).map(Number).filter(function (c) { return c >= c0 && c < c0 + nc; });
  if (!cols.length) return 0;
  var n = rEnd - rStart + 1, ss = feed.getParent();
  var ids = feed.getRange(rStart, F_ID, n, 1).getValues();
  var changes = {}, saved = 0;
  cols.forEach(function (c) {
    var rng = feed.getRange(rStart, c, n, 1), f = rng.getFormulasR1C1(), v = rng.getValues(), stray = false;
    for (var i = 0; i < n; i++) {
      if (f[i][0]) continue;
      stray = true;
      var id = String(ids[i][0] || '').trim();
      if (!id) continue;
      var val = v[i][0];
      if (c === F_DONE) val = (val === true || String(val).trim().toUpperCase() === 'TRUE' || String(val).trim().toUpperCase() === 'DONE');
      (changes[id] = changes[id] || {})[FEED_INPUT_COLS[c]] = val;
      saved++;
    }
    if (stray) rng.setFormulaR1C1(feedFormulaR1C1_(c));
  });
  if (!saved) return 0;
  var inputs = rcReadInputs_(ss);
  Object.keys(changes).forEach(function (id) {
    var ch = changes[id], cur = inputs[id] || {};
    // an unticked box or emptied cell for a document with nothing saved yet: nothing to keep
    if (!inputs[id] && Object.keys(ch).every(function (f) { return ch[f] === '' || ch[f] === false; })) return;
    // Ticking DONE fills RENEWED ON with today when it is still empty
    if (ch.done === true && !(ch.renewedOn instanceof Date) && !(cur.renewedOn instanceof Date)) {
      var t = new Date(); ch.renewedOn = new Date(t.getFullYear(), t.getMonth(), t.getDate());
    }
    rcSetInputs_(ss, id, ch);
  });
  return saved;
}

function onEdit(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet();
  if (sh.getName() !== FEED) return;
  captureFeedEdits_(sh, e.range.getRow(), e.range.getNumRows(), e.range.getColumn(), e.range.getNumColumns());
}

function repairFeed_() {
  var feed = SpreadsheetApp.getActive().getSheetByName(FEED);
  return feed ? captureFeedEdits_(feed, FEED_FIRST_ROW, FEED_LAST_ROW - FEED_FIRST_ROW + 1, F_RENEWED, F_ACTION_AT - F_RENEWED + 1) : 0;
}

function repairFeed() {
  var n = repairFeed_();
  SpreadsheetApp.getUi().alert(n ? n + ' typed cell(s) were saved under their document.' : 'The Task Feed is in order.');
}


// ---------------------------------------------------------------- main action
function completeTickedRenewals() {
  var ss   = SpreadsheetApp.getActive();
  var ui   = SpreadsheetApp.getUi();
  if (!ss.getSheetByName(FEED) || !ss.getSheetByName(RC_LOG)) { ui.alert('Task Feed or Renewal Log sheet is missing.'); return; }
  repairFeed_();

  // ---- 1. every ticked document, checked before anything is written ----------
  var inputs = rcReadInputs_(ss), jobs = [], problems = [];
  Object.keys(inputs).forEach(function (id) {
    var x = inputs[id];
    if (x.done !== true) return;
    var t = new Date();
    var d = {
      renewedOn: x.renewedOn instanceof Date ? x.renewedOn : new Date(t.getFullYear(), t.getMonth(), t.getDate()),
      newValid: x.newValid, cost: typeof x.cost === 'number' ? x.cost : 0,
      link: String(x.link || '').trim(), title: rcTitle_(ss, id)
    };
    var p = rcCheckRenewal_(ss, id, d);
    if (p) problems.push(p); else jobs.push({ id: id, d: d });
  });
  if (problems.length) {
    ui.alert('Nothing was changed. Please fix these first:\n\n' + problems.join('\n'));
    return;
  }
  if (!jobs.length) {
    ui.alert('Nothing to do.\n\nTick the DONE box on a Task Feed row and fill RENEWED ON, ' +
             'NEW VALID UNTIL and TOTAL COST first.');
    return;
  }

  // ---- 2. apply each one; the new expiry is read back before it counts as done --
  var who = Session.getActiveUser().getEmail() || 'unknown', done = [], failed = [];
  jobs.forEach(function (j) {
    try {
      rcApplyRenewal_(ss, j.id, j.d, who);
      rcClearInputs_(ss, j.id);
      done.push(j.id + '  →  valid until ' + rcShow_(j.d.newValid));
    } catch (e) { failed.push(e.message); }
  });
  SpreadsheetApp.flush();

  var msg = done.length + ' renewal' + (done.length === 1 ? '' : 's') + ' completed and logged.';
  if (done.length) msg += '\n\n' + done.join('\n') + '\n\nThey leave the Task Feed and return when the next renewal falls due.';
  if (failed.length) msg += '\n\nNOT completed (still ticked):\n' + failed.join('\n');
  ui.alert(msg);
}


// ---------------------------------------------------------------- helpers
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
