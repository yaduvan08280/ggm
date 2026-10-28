/**
 * JPR FLEET DASHBOARD — SHARED CONFIG & HELPERS
 * Version 4.0
 * ------------------------------------------------------------------
 * Loaded by every other file. Apps Script has a flat namespace, so
 * anything declared here is visible in Code.js / Auth.js / Tasks.js.
 */

// ═══════════════════ CONFIG ═══════════════════
var APP_VERSION      = '6.0';   // bump when shipping; shown in the app's Account panel
var TZ               = 'Asia/Kolkata';
var SHEET_MASTER     = 'MASTER';
var SHEET_CHECKLIST  = 'Checklist';
var SHEET_USERS      = 'Users';
var SHEET_AUTH       = '_AUTH';
var SHEET_NOTES      = '_NOTES';

/** Limits on task remarks, so one cell can never become unreadable. */
var NOTE_MAX_LEN       = 300;
var MAX_NOTES_PER_TASK = 10;

/**
 * How many days BEFORE the due date a task becomes visible in the app.
 * Driven by the rule kind — see windowForSchedule_() in Schedule.js.
 *   daily 0 · weekly 2 · monthly 7
 */

/** What gets written into the Checklist calendar. */
var MARK_MISSED    = '\u274C';                 // ❌  scheduled that day, nobody did it
var MARK_SHIFT     = '\u23ED';                 // ⏭   postponed away from that day
var MARK_LATE      = '\u26A0';                 // ⚠   done, but after its due date

/** Max total days a W/M task may be shifted within one cycle. */
var MAX_SHIFT_DAYS   = 2;

/** OTP lifetime in minutes. */
var OTP_TTL_MIN      = 10;

/** Password every new user starts with. */
var DEFAULT_PASSWORD = '1234';

/** Extra columns appended to the Users sheet (after your existing ones). */
var USER_HEADERS   = ['EMAIL', 'NAME', 'PASSWORD', 'ROLE', 'STATUS', 'OTP', 'OTP_EXPIRY', 'LAST_LOGIN', 'USERNAME'];  // USERNAME = GGM Portal username

/** Extra columns appended to the MASTER sheet (after A–G). */
var MASTER_EXTRA   = ['LAST_DONE', 'SHIFT_USED', 'LAST_NOTE', 'ANCHOR', 'MISSED_COUNT'];

var MONTHS_ = {
  'JANUARY':0,'JAN':0, 'FEBRUARY':1,'FEB':1, 'MARCH':2,'MAR':2,
  'APRIL':3,'APR':3,   'MAY':4,                'JUNE':5,'JUN':5,
  'JULY':6,'JUL':6,    'AUGUST':7,'AUG':7,     'SEPTEMBER':8,'SEP':8,'SEPT':8,
  'OCTOBER':9,'OCT':9, 'NOVEMBER':10,'NOV':10, 'DECEMBER':11,'DEC':11
};


// ═══════════════════ DATE HELPERS ═══════════════════

/** Midnight of "today" in the fleet timezone, as a plain Date. */
function todayStart_() {
  var parts = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd').split('-');
  return new Date(+parts[0], +parts[1] - 1, +parts[2]);
}

/** "dd/MM/yyyy" (or "dd/MM/yyyy HH:mm") -> Date at midnight. Null if unparseable. */
function parseDMY_(str) {
  if (str === null || str === undefined) return null;
  var s = String(str).trim();
  if (!s) return null;
  s = s.split(' ')[0];
  var p = s.split(/[\/\-\.]/);
  if (p.length !== 3) return null;
  var d = parseInt(p[0], 10), m = parseInt(p[1], 10), y = parseInt(p[2], 10);
  if (!d || !m || !y) return null;
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  var dt = new Date(y, m - 1, d);
  return isNaN(dt.getTime()) ? null : dt;
}

function fmtDMY_(d)      { return Utilities.formatDate(d, TZ, 'dd/MM/yyyy'); }
function fmtStamp_(d)    { return Utilities.formatDate(d, TZ, 'dd/MM/yyyy HH:mm'); }
function fmtClock_(d)    { return Utilities.formatDate(d, TZ, 'hh:mm a'); }

function addDays_(d, n)  { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }
function addMonths_(d, n){ var x = new Date(d.getTime()); x.setMonth(x.getMonth() + n); return x; }

/** Whole days between two midnight Dates (b - a). */
function dayDiff_(a, b) {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}


// ═══════════════════ SHEET SCHEMA ═══════════════════

/**
 * Makes sure the Users sheet has the auth columns.
 * Never touches your existing columns — new headers are appended to the right.
 * Returns { EMAIL: 3, NAME: 4, ... } as 1-based column numbers.
 */
function ensureUserCols_(sh) {
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var hdr = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  var map = {};
  for (var i = 0; i < hdr.length; i++) {
    var h = String(hdr[i] || '').trim().toUpperCase().replace(/\s+/g, '_');
    if (USER_HEADERS.indexOf(h) >= 0 && !map[h]) map[h] = i + 1;
  }
  var next = lastCol + 1;
  for (var j = 0; j < USER_HEADERS.length; j++) {
    var key = USER_HEADERS[j];
    if (!map[key]) {
      sh.getRange(1, next).setValue(key).setFontWeight('bold');
      map[key] = next;
      next++;
    }
  }
  return map;
}

/**
 * Makes sure MASTER has LAST_DONE / SHIFT_USED / LAST_NOTE columns.
 * A–G stay exactly as they are.
 */
function ensureMasterCols_(sh) {
  var lastCol = Math.max(sh.getLastColumn(), 7);
  var hdr = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  var map = {};
  for (var i = 0; i < hdr.length; i++) {
    var h = String(hdr[i] || '').trim().toUpperCase().replace(/\s+/g, '_');
    if (MASTER_EXTRA.indexOf(h) >= 0 && !map[h]) map[h] = i + 1;
  }
  var next = lastCol + 1;
  for (var j = 0; j < MASTER_EXTRA.length; j++) {
    var key = MASTER_EXTRA[j];
    if (!map[key]) {
      sh.getRange(1, next).setValue(key).setFontWeight('bold');
      map[key] = next;
      next++;
    }
  }
  return map;
}


// ═══════════════════ CHECKLIST GRID MAPPING ═══════════════════

/**
 * The Checklist tab is a calendar grid: one row per (car, task), one column
 * per calendar day, grouped under merged MONTH headers.
 *
 * The old code assumed "September day 1 = column F" and hard-coded 5 + day,
 * which silently writes into the wrong month from October onwards.
 * This reads the real headers instead and builds a month/day -> column map.
 *
 * Returns { dayRow, monthRow, dataStart, map } with 1-based rows/cols,
 * where map key is "<0-based month>-<day>"  e.g. "8-21" = 21 September.
 */
function checklistLayout_(cSheet) {
  if (!cSheet) return null;
  var lastCol = Math.max(cSheet.getLastColumn(), 1);
  var probeRows = Math.min(8, Math.max(cSheet.getLastRow(), 1));
  var probe = cSheet.getRange(1, 1, probeRows, lastCol).getDisplayValues();

  // The "day row" is whichever of the top rows holds the most 1..31 numbers.
  var dayIdx = -1, best = 0;
  for (var r = 0; r < probe.length; r++) {
    var count = 0;
    for (var c = 0; c < lastCol; c++) {
      var v = String(probe[r][c] || '').trim();
      if (/^\d{1,2}$/.test(v)) { var n = +v; if (n >= 1 && n <= 31) count++; }
    }
    if (count > best) { best = count; dayIdx = r; }
  }
  if (dayIdx < 1 || best < 20) return null;   // no recognisable calendar grid

  // The month header may sit on ANY row above the day row, and it is usually a
  // merged cell. getDisplayValues() reports a merged range's value only in its
  // top-left cell, so a header merged down rows 1:2 puts "SEPTEMBER" on row 1
  // and leaves row 2 blank. Looking only at dayIdx-1 therefore finds nothing and
  // silently produces an empty map. Scan every row above the day row instead,
  // and take the lowest month name found in each column.
  var monthCells = [];
  var monthRowUsed = dayIdx;
  for (var c1 = 0; c1 < lastCol; c1++) {
    monthCells[c1] = null;
    for (var r1 = dayIdx - 1; r1 >= 0; r1--) {
      var cand = String(probe[r1][c1] || '').trim().toUpperCase();
      if (cand && MONTHS_[cand] !== undefined) {
        monthCells[c1] = MONTHS_[cand];
        if (r1 < monthRowUsed) monthRowUsed = r1;
        break;
      }
    }
  }

  var map = {};
  var currentMonth = null;

  for (var c2 = 0; c2 < lastCol; c2++) {
    if (monthCells[c2] !== null) currentMonth = monthCells[c2];

    var dv = String(probe[dayIdx][c2] || '').trim();
    if (currentMonth !== null && /^\d{1,2}$/.test(dv)) {
      var day = +dv;
      if (day >= 1 && day <= 31) {
        var key = currentMonth + '-' + day;
        if (!map[key]) map[key] = c2 + 1;
      }
    }
  }

  // An empty map means the headers were not understood. Returning a valid-looking
  // layout here is what let every write be dropped without a word, so fail loudly.
  var mapped = 0;
  for (var k in map) { if (map.hasOwnProperty(k)) mapped++; }
  if (mapped === 0) {
    Logger.log('checklistLayout_: day row found at ' + (dayIdx + 1) +
               ' but no MONTH header above it — calendar unusable.');
    return null;
  }

  return {
    monthRow : monthRowUsed + 1,
    dayRow   : dayIdx + 1,
    dataStart: dayIdx + 2,
    map      : map,
    mapped   : mapped
  };
}

/** Column number for a given Date in the checklist grid, or 0. */
function checklistColFor_(layout, dateObj) {
  if (!layout) return 0;
  return layout.map[dateObj.getMonth() + '-' + dateObj.getDate()] || 0;
}

/** Find the Checklist row for a (car, task) pair. cData = getDisplayValues(). */
function checklistRowIndex_(cData, dataStartIdx, car, task) {
  var c = String(car).trim().toUpperCase();
  var t = String(task).trim().toUpperCase();
  for (var i = dataStartIdx; i < cData.length; i++) {
    if (String(cData[i][1] || '').trim().toUpperCase() === c &&
        String(cData[i][2] || '').trim().toUpperCase() === t) {
      return i + 1;
    }
  }
  return -1;
}

/**
 * Applies a batch of {row, col, text, color, onlyIfEmpty} writes to the
 * Checklist efficiently — grouped per column, formulas preserved.
 */
function flushChecklistWrites_(cSheet, writes) {
  if (!cSheet || !writes || !writes.length) return;
  forgetTaskHistory_();   // the driver log book is read from this sheet (History.js)

  var byCol = {};
  writes.forEach(function (w) {
    if (!w.col || !w.row) return;
    (byCol[w.col] = byCol[w.col] || []).push(w);
  });

  Object.keys(byCol).forEach(function (colKey) {
    var col  = parseInt(colKey, 10);
    var list = byCol[colKey];
    var minRow = list[0].row, maxRow = list[0].row;
    list.forEach(function (w) {
      if (w.row < minRow) minRow = w.row;
      if (w.row > maxRow) maxRow = w.row;
    });

    var height   = maxRow - minRow + 1;
    var range    = cSheet.getRange(minRow, col, height, 1);
    var values   = range.getValues();
    var formulas = range.getFormulas();
    var colors   = range.getFontColors();
    var aligns   = range.getHorizontalAlignments();
    var dirty    = false;

    list.forEach(function (w) {
      var i = w.row - minRow;
      var existing = String(values[i][0] || '').trim();
      if (w.onlyIfEmpty && existing !== '') return;
      values[i][0] = w.text;
      formulas[i][0] = '';
      if (w.color) colors[i][0] = w.color;
      if (w.align) aligns[i][0] = w.align;
      dirty = true;
    });

    if (!dirty) return;

    // Re-apply formulas for cells we did not touch, so nothing is flattened.
    var out = [];
    for (var i2 = 0; i2 < height; i2++) {
      out.push([formulas[i2][0] ? formulas[i2][0] : values[i2][0]]);
    }
    range.setValues(out);
    range.setFontColors(colors);
    range.setHorizontalAlignments(aligns);
  });
}


// ═══════════════════ MISC ═══════════════════

function getRealLastRow(sheet) {
  var data = sheet.getRange('A:A').getValues();
  for (var i = data.length - 1; i >= 0; i--) {
    if (data[i][0] != null && data[i][0].toString().trim() !== '') return i + 1;
  }
  return 1;
}

function esc_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
