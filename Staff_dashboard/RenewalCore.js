// =========================================================================
//  RENEWAL CORE - the same file in renewal_system (the Renewal Record sheet's
//  own script), Staff_dashboard and main_admin_dashboard. Edit all three
//  together (portal_connector/checks/renewals.js fails if they differ).
//
//  Task Feed rows are "the Nth most urgent document" (formulas from Engine),
//  so anything typed on a feed row used to slide onto another document as soon
//  as the order changed. Typed renewal details now live in the hidden
//  'Feed Inputs' tab, one row per Doc ID; the Task Feed only displays them.
// =========================================================================

var RC_INPUTS = 'Feed Inputs';
// Feed Inputs columns B..J, in this order (A = Doc ID, K = Updated At)
var RC_FIELDS = ['renewedOn', 'newValid', 'cost', 'done', 'link', 'status', 'remark', 'actionBy', 'actionAt'];
var RC_HEAD = ['Doc ID', 'Renewed On', 'New Valid Until', 'Total Cost', 'Done', 'Document Link', 'Status', 'Remark', 'Action By', 'Action At', 'Updated At'];
var RC_ENTRY_TABS = ['Vehicle Documents', 'Personal Policies', 'Mining Documents'];
var RC_ENTRY_FIRST = 5, RC_E_VALID = 7, RC_E_LINK = 20;
var RC_LOG = 'Renewal Log', RC_LOG_FIRST = 5;

function rcInputsSheet_(ss) {
  var sh = ss.getSheetByName(RC_INPUTS);
  if (!sh) {
    sh = ss.insertSheet(RC_INPUTS);
    sh.getRange(1, 1, 1, RC_HEAD.length).setValues([RC_HEAD]);
    sh.hideSheet();
  }
  return sh;
}

/** { docId: { row, id, renewedOn, newValid, … } } - the first row wins if a Doc ID appears twice. */
function rcReadInputs_(ss) {
  var sh = rcInputsSheet_(ss), n = sh.getLastRow() - 1, out = {};
  if (n < 1) return out;
  sh.getRange(2, 1, n, RC_HEAD.length).getValues().forEach(function (r, i) {
    var id = String(r[0] || '').trim();
    if (!id || out[id]) return;
    var o = { row: i + 2, id: id };
    RC_FIELDS.forEach(function (f, k) { o[f] = r[k + 1]; });
    out[id] = o;
  });
  return out;
}

/** Saves the given fields for one document; fields not given keep their value. */
function rcSetInputs_(ss, docId, fields) {
  var sh = rcInputsSheet_(ss), cur = rcReadInputs_(ss)[docId];
  var row = cur ? cur.row : Math.max(sh.getLastRow(), 1) + 1;
  var vals = RC_FIELDS.map(function (f) {
    if (f in fields) return fields[f];
    return cur ? cur[f] : (f === 'done' ? false : '');
  });
  sh.getRange(row, 1, 1, RC_HEAD.length).setValues([[docId].concat(vals, [new Date()])]);
}

function rcClearInputs_(ss, docId) {
  var sh = rcInputsSheet_(ss), n = sh.getLastRow() - 1;
  if (n < 1) return;
  var ids = sh.getRange(2, 1, n, 1).getValues();
  for (var i = n - 1; i >= 0; i--) if (String(ids[i][0] || '').trim() === docId) sh.deleteRow(i + 2);
}

/** Where a document lives: { sheet, row } on its entry tab, or null. */
function rcFindDoc_(ss, docId) {
  for (var t = 0; t < RC_ENTRY_TABS.length; t++) {
    var sh = ss.getSheetByName(RC_ENTRY_TABS[t]);
    if (!sh || sh.getLastRow() < RC_ENTRY_FIRST) continue;
    var ids = sh.getRange(RC_ENTRY_FIRST, 1, sh.getLastRow() - RC_ENTRY_FIRST + 1, 1).getValues();
    for (var k = 0; k < ids.length; k++) if (String(ids[k][0] || '').trim() === docId) return { sheet: sh, row: RC_ENTRY_FIRST + k };
  }
  return null;
}

/** "Renew: Insurance - RJ14 AB 1234" from the Engine tab (for the log's Remarks). */
function rcTitle_(ss, docId) {
  var e = ss.getSheetByName('Engine');
  if (!e || e.getLastRow() < 2) return '';
  var rows = e.getRange(2, 1, e.getLastRow() - 1, 6).getValues();
  for (var i = 0; i < rows.length; i++) if (String(rows[i][0]).trim() === docId) return String(rows[i][5] || '');
  return '';
}

function rcDay_(d) { return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
function rcShow_(d) { return Utilities.formatDate(d, Session.getScriptTimeZone(), 'dd-MMM-yyyy'); }

/** "2027-09-30" (date picker) → a Date at midnight, or null. */
function rcParseDay_(s) {
  var m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

/** Why this renewal cannot be applied, or '' when it can. d = { renewedOn, newValid }. */
function rcCheckRenewal_(ss, docId, d) {
  var doc = rcFindDoc_(ss, docId);
  if (!doc) return docId + ': not found on Vehicle Documents / Personal Policies / Mining Documents.';
  if (!(d.newValid instanceof Date) || isNaN(d.newValid.getTime())) return docId + ': NEW VALID UNTIL is missing or is not a date.';
  if (!(d.renewedOn instanceof Date) || isNaN(d.renewedOn.getTime())) return docId + ': RENEWED ON is missing or is not a date.';
  if (rcDay_(d.renewedOn) > rcDay_(new Date())) return docId + ': RENEWED ON (' + rcShow_(d.renewedOn) + ') is in the future.';
  var prev = doc.sheet.getRange(doc.row, RC_E_VALID).getValue();
  if (prev instanceof Date && rcDay_(d.newValid) <= rcDay_(prev)) {
    return docId + ': NEW VALID UNTIL (' + rcShow_(d.newValid) + ') must be later than the current expiry (' + rcShow_(prev) + ').';
  }
  return '';
}

/** Applies one renewal: new expiry (+ document link) on the entry tab and one Renewal Log line,
 *  then reads the expiry back. Throws with a readable message if anything is wrong. */
function rcApplyRenewal_(ss, docId, d, who) {
  var problem = rcCheckRenewal_(ss, docId, d);
  if (problem) throw new Error(problem);
  var doc = rcFindDoc_(ss, docId);
  var validCell = doc.sheet.getRange(doc.row, RC_E_VALID), prev = validCell.getValue();
  validCell.setValue(d.newValid);
  if (d.link) doc.sheet.getRange(doc.row, RC_E_LINK).setValue(d.link);

  var log = ss.getSheetByName(RC_LOG);
  var last = log.getLastRow(), next = RC_LOG_FIRST;
  if (last >= RC_LOG_FIRST) {
    log.getRange(RC_LOG_FIRST, 3, last - RC_LOG_FIRST + 1, 1).getValues().forEach(function (r, i) {
      if (String(r[0] || '').trim()) next = RC_LOG_FIRST + i + 1;
    });
  }
  // B Logged On, C Doc ID | D-F are formulas | G Previous, H New, I Renewed On, J Cost, K Done By, L Remarks
  log.getRange(next, 2, 1, 2).setValues([[new Date(), docId]]);
  log.getRange(next, 7, 1, 6).setValues([[prev, d.newValid, d.renewedOn, typeof d.cost === 'number' ? d.cost : 0, who || 'unknown', d.title || rcTitle_(ss, docId)]]);
  SpreadsheetApp.flush();

  var now = validCell.getValue();
  if (!(now instanceof Date) || rcDay_(now) !== rcDay_(d.newValid)) {
    throw new Error(docId + ': the new expiry did not stay saved on ' + doc.sheet.getName() + ' row ' + doc.row + ' (it reads ' + now + ').');
  }
  return { prev: prev, sheet: doc.sheet.getName(), row: doc.row, logRow: next };
}
