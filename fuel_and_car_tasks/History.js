/**
 * JPR FLEET DASHBOARD — DRIVER HISTORY
 * ------------------------------------------------------------------
 * The Checklist calendar already holds every completion ever made:
 *   NAME (time)      done on time
 *   ⚠ NAME (time)    done late
 *   ❌ / ⏭ ...        missed / postponed — not a completion
 * taskHistory_() reads it back into a flat log book so the dashboard can show
 * how many tasks each driver did this month and his full history by date.
 *
 * The parse is cached (split over several cache keys, 15 min) and dropped
 * whenever the app writes to the Checklist, so a completion shows at once.
 */

var HIST_CACHE_KEY = 'task_hist_v1';
var HIST_CACHE_TTL = 900;            // seconds
var HIST_CHUNK     = 90000;          // characters per cache entry (limit is 100 KB)

/**
 * [[ 'dd/MM/yyyy', 'hh:mm a', car, task, doer, late(1/0) ], ...] newest first.
 */
function taskHistory_() {
  var cache = CacheService.getScriptCache();
  try {
    var n = parseInt(cache.get(HIST_CACHE_KEY + '_n'), 10);
    if (n > 0) {
      var keys = [];
      for (var k = 0; k < n; k++) keys.push(HIST_CACHE_KEY + '_' + k);
      var got = cache.getAll(keys), parts = [];
      for (var j = 0; j < keys.length; j++) {
        if (got[keys[j]] == null) { parts = null; break; }
        parts.push(got[keys[j]]);
      }
      if (parts) return JSON.parse(parts.join(''));
    }
  } catch (ignore) {}

  var log = readTaskHistory_(SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CHECKLIST), todayStart_());
  try {
    var s = JSON.stringify(log), put = {}, count = 0;
    for (var i = 0; i < s.length; i += HIST_CHUNK) put[HIST_CACHE_KEY + '_' + (count++)] = s.substr(i, HIST_CHUNK);
    put[HIST_CACHE_KEY + '_n'] = String(count);
    cache.putAll(put, HIST_CACHE_TTL);
  } catch (ignore) {}
  return log;
}

/** Called after anything writes to the Checklist. */
function forgetTaskHistory_() {
  try { CacheService.getScriptCache().remove(HIST_CACHE_KEY + '_n'); } catch (ignore) {}
}

/**
 * The calendar's columns carry month + day only. A cell can only hold a
 * completion on or before today, so a month-day later than today is last year's.
 */
function readTaskHistory_(cSheet, today) {
  var out = [];
  if (!cSheet) return out;
  var layout = checklistLayout_(cSheet);
  if (!layout) return out;

  var colDate = {};                                  // 1-based column -> Date
  Object.keys(layout.map).forEach(function (key) {
    var p = key.split('-'), m = +p[0], d = +p[1];
    var dt = new Date(today.getFullYear(), m, d);
    if (dt.getMonth() !== m) return;                 // 30 Feb and friends
    if (dt.getTime() > today.getTime()) dt = new Date(today.getFullYear() - 1, m, d);
    colDate[layout.map[key]] = dt;
  });

  var lastRow = cSheet.getLastRow(), lastCol = cSheet.getLastColumn();
  if (lastRow < layout.dataStart) return out;
  var vals = cSheet.getRange(layout.dataStart, 1, lastRow - layout.dataStart + 1, lastCol).getDisplayValues();

  for (var r = 0; r < vals.length; r++) {
    var car = String(vals[r][1] || '').trim(), task = String(vals[r][2] || '').trim();
    if (!car || !task) continue;
    for (var c in colDate) {
      var cell = String(vals[r][c - 1] || '').trim();
      if (!cell) continue;
      var e = parseChecklistCell_(cell);
      if (!e) continue;
      var dt = colDate[c];
      out.push([fmtDMY_(dt), e.time, car, task, e.by, e.late ? 1 : 0, dt.getTime()]);
    }
  }
  out.sort(function (a, b) { return b[6] - a[6] || (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0); });
  return out.map(function (x) { return x.slice(0, 6); });
}

/** "⚠ NAME\n(10:32 AM)\nremark" -> { by, time, late } ; null for ❌ / ⏭ / blanks. */
function parseChecklistCell_(cell) {
  var lines = String(cell).split(/\r?\n/);
  var first = String(lines[0] || '').trim();
  if (!first) return null;
  if (first.indexOf(MARK_MISSED) === 0 || first.indexOf(MARK_SHIFT) === 0) return null;
  var late = first.indexOf(MARK_LATE) === 0;
  var by = first.replace(MARK_LATE, '').replace(/️/g, '').trim();
  var time = '';
  var m = String(lines[1] || '').match(/^\((.*)\)$/);
  if (m) time = m[1].trim();
  else {                                             // "NAME (10:32 AM)" on one line
    var m2 = by.match(/^(.*?)\s*\(([^)]*)\)$/);
    if (m2) { by = m2[1].trim(); time = m2[2].trim(); }
  }
  if (!by || /^[✓✔✅xX\-]+$/.test(by)) return null;
  return { by: by, time: time, late: late };
}

/**
 * Everyone who can sign in (name + portal username), so the dashboard can match
 * "GAJENDRA" in a fuel row and "Gajendra Meena" in the Checklist to one person.
 */
function fleetPeople_(ss) {
  var out = [];
  try {
    var sh = ss.getSheetByName(SHEET_USERS);
    if (!sh || sh.getLastRow() < 2) return out;
    var cols = ensureUserCols_(sh);
    var width = Math.max(sh.getLastColumn(), cols.USERNAME, cols.ROLE, cols.STATUS);
    sh.getRange(2, 1, sh.getLastRow() - 1, width).getDisplayValues().forEach(function (r) {
      var email = String(r[cols.EMAIL - 1] || '').trim();
      var name = String(r[cols.NAME - 1] || '').trim();
      if (!email && !name) return;
      out.push({
        name: name || email,
        username: String(r[cols.USERNAME - 1] || '').trim(),
        role: String(r[cols.ROLE - 1] || '').trim().toUpperCase(),
        active: !/^(DISABLED|INACTIVE)$/.test(String(r[cols.STATUS - 1] || '').trim().toUpperCase())
      });
    });
  } catch (e) { Logger.log('fleetPeople_: ' + e); }
  return out;
}

/** This month's completions only: enough for the driver tiles, small enough for every refresh. */
function monthHistory_() {
  var mk = fmtDMY_(todayStart_()).slice(3);
  return taskHistory_().filter(function (r) { return String(r[0]).slice(3) === mk; });
}

/** The whole log book, fetched when a driver's history is opened. */
function apiTaskHistory(token) {
  try {
    requireSession_(token);
    return JSON.stringify({ success: true, log: taskHistory_() });
  } catch (e) {
    if (String(e.message || e).indexOf('SESSION_EXPIRED') >= 0) return JSON.stringify({ success: false, expired: true });
    return JSON.stringify({ success: false, message: e.message || String(e) });
  }
}
