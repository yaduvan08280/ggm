/**
 * JPR FLEET DASHBOARD — HOW GGM PORTAL TALKS TO THIS APP
 * ------------------------------------------------------------------
 * The shared connector is Portal.js (same file in every app). This file
 * says what "start a session", "create a user" and "count what is due"
 * mean here. Until the Script Property PORTAL_SECRET is set, none of it
 * runs and the app keeps its own email + password login.
 *
 * Users sheet: only the auth columns on the right are written
 * (EMAIL, NAME, STATUS, PASSWORD, USERNAME). Columns A–B — the Driver and
 * Vehicle dropdown lists — are never touched, and no row is ever deleted.
 *
 * Portal sessions go in _AUTH like any other; their token starts with
 * "P" (opened from the portal) or "D" (own link, password checked by the
 * portal) and they expire after PORTAL_FUEL_SESSION_HOURS.
 */

var PORTAL_FUEL_SESSION_HOURS = 12;
var PORTAL_FUEL_ROW_ = null;   // the Users row provision last read, when it changed nothing

function portalAdapter_() {
  return {
    startSession: portalFuelStart_,
    provision: portalFuelProvision_,
    endSessions: portalFuelEndSessions_,
    counts: portalFuelCounts_,
    meta: function () { return {}; },
    listUsers: portalFuelListUsers_
  };
}

/** Requests from GGM Portal (this app had no doPost before). */
function doPost(e) {
  return portalHandlePost_(e) || ContentService.createTextOutput('Not found');
}

function portalFuelStart_(c, src) {
  var key = String(c.lu || '').trim().toLowerCase();
  if (!key) throw new Error('GGM Portal did not say which Fleet user this is.');
  PORTAL_FUEL_ROW_ = null;
  portalFuelProvision_({ username: c.u, name: c.n, email: c.e, localId: key, active: true });

  var u = PORTAL_FUEL_ROW_ || findUser_(key);   // SPEED: reuse the row the sync just read when nothing changed
  if (!u) throw new Error('Your Fleet account is not set up yet. Ask the IT admin.');
  var status = String(u.data[u.cols.STATUS - 1] || '').trim().toUpperCase();
  if (status === 'DISABLED' || status === 'INACTIVE') throw new Error('Your Fleet account is switched off.');

  var name = String(u.data[u.cols.NAME - 1] || '').trim() || c.n || key;
  var token = (src === 'portal' ? 'P' : 'D') + Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  var now = fmtStamp_(new Date());
  try {   // SPEED: expired portal sessions are cleared at most hourly (row-by-row deletes)
    var c0 = CacheService.getScriptCache();
    if (!c0.get('portal_purge')) { c0.put('portal_purge', '1', 3600); portalFuelPurge_(); }
  } catch (e) {}
  authSheet_().appendRow([token, key, name, now, now]);
  u.sheet.getRange(u.row, u.cols.LAST_LOGIN).setValue(now);
  return {
    token: token, name: name, email: key,
    role: String(u.data[u.cols.ROLE - 1] || 'USER').trim().toUpperCase(),
    username: String(c.u || '') || key
  };
}

/** Writes the auth columns of one person; switches off instead of deleting. */
function portalFuelProvision_(w) {
  var sh = usersSheet_();
  var cols = ensureUserCols_(sh);
  var key = String(w.localId || '').trim().toLowerCase();
  if (!key) throw new Error('No Fleet login (email or username).');

  var u = findUser_(key);
  if (!u && w.username) u = portalFuelFindByUsername_(sh, cols, w.username);

  if (!w.active) {
    if (!u) return 'not in Fleet';
    var st = String(u.data[cols.STATUS - 1] || '').trim().toUpperCase();
    if (st === 'DISABLED') return 'already off';
    sh.getRange(u.row, cols.STATUS).setValue('DISABLED');
    return 'switched off';
  }

  var row = u ? u.row : portalFuelFreeRow_(sh, cols);
  var cur = u ? u.data : [];
  var want = {};
  want[cols.EMAIL] = key;
  want[cols.NAME] = String(w.name || '').trim() || key;
  want[cols.USERNAME] = String(w.username || '').trim();
  want[cols.STATUS] = 'ACTIVE';
  var changed = 0;
  Object.keys(want).forEach(function (c) {
    if (String(cur[c - 1] || '').trim() !== String(want[c])) { sh.getRange(row, Number(c)).setValue(want[c]); changed++; }
  });
  // A blank PASSWORD means "1234" in the old login: never leave it blank.
  if (!String(cur[cols.PASSWORD - 1] || '').trim()) {
    sh.getRange(row, cols.PASSWORD).setValue(hashPassword_(Utilities.getUuid() + Utilities.getUuid()));
    changed++;
  }
  if (changed) SpreadsheetApp.flush();
  else PORTAL_FUEL_ROW_ = u;
  return u ? (changed ? 'updated' : 'already up to date') : 'created';
}

function portalFuelFindByUsername_(sh, cols, username) {
  var last = sh.getLastRow();
  if (last < 2) return null;
  var vals = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getDisplayValues();
  var want = String(username).trim().toLowerCase();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][cols.USERNAME - 1] || '').trim().toLowerCase() === want) {
      return { row: i + 2, cols: cols, data: vals[i], sheet: sh };
    }
  }
  return null;
}

/** First row whose EMAIL cell is empty (rows may hold Driver / Vehicle list values in A–B). */
function portalFuelFreeRow_(sh, cols) {
  var last = sh.getLastRow();
  if (last >= 2) {
    var emails = sh.getRange(2, cols.EMAIL, last - 1, 1).getDisplayValues();
    for (var i = 0; i < emails.length; i++) if (!String(emails[i][0]).trim()) return i + 2;
  }
  return Math.max(last, 1) + 1;
}

/** { user: wanted } → that user's sessions · { direct: true } → every session not opened from the portal. */
function portalFuelEndSessions_(opts) {
  var sh = authSheet_();
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var vals = sh.getRange(2, 1, last - 1, 2).getDisplayValues();
  var key = opts && opts.user ? String(opts.user.localId || '').trim().toLowerCase() : '';
  var n = 0, cache = CacheService.getScriptCache();
  for (var i = vals.length - 1; i >= 0; i--) {
    var tok = String(vals[i][0]).trim();
    var hit = opts && opts.direct ? tok.charAt(0) !== 'P' : (key && String(vals[i][1]).trim().toLowerCase() === key);
    if (hit) { sh.deleteRow(i + 2); try { cache.remove('fs_' + tok); } catch (e) {} n++; }
  }
  return n;
}

/** Portal sessions older than PORTAL_FUEL_SESSION_HOURS are removed. */
function portalFuelPurge_() {
  var sh = authSheet_();
  var last = sh.getLastRow();
  if (last < 2) return;
  var vals = sh.getRange(2, 1, last - 1, 4).getDisplayValues();
  for (var i = vals.length - 1; i >= 0; i--) {
    var tok = String(vals[i][0]).trim();
    if ((tok.charAt(0) === 'P' || tok.charAt(0) === 'D') && portalFuelExpired_(vals[i][3])) sh.deleteRow(i + 2);
  }
}

/** "dd/MM/yyyy HH:mm" older than the portal session life? */
function portalFuelExpired_(createdStr) {
  var bits = String(createdStr || '').trim().split(' ');
  var d = parseDMY_(bits[0]);
  if (!d) return true;
  if (bits[1]) {
    var hm = bits[1].split(':');
    d.setHours(parseInt(hm[0], 10) || 0, parseInt(hm[1], 10) || 0, 0, 0);
  }
  return Date.now() - d.getTime() > PORTAL_FUEL_SESSION_HOURS * 3600000;
}

/** Badge: tasks due / overdue / unreadable today. Tasks belong to no one, so every Fuel user gets the same number. */
function portalFuelCounts_(list) {
  var n = portalFuelDueCount_();
  var out = {};
  list.forEach(function (x) { out[x.u] = n; });
  return out;
}

function portalFuelDueCount_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_MASTER);
  if (!sh || sh.getLastRow() < 2) return 0;
  var cols = ensureMasterCols_(sh);
  var today = todayStart_();
  var width = Math.max(sh.getLastColumn(), cols.LAST_NOTE);
  var data = sh.getRange(2, 1, sh.getLastRow() - 1, width).getDisplayValues();
  var n = 0;
  data.forEach(function (r) {
    if (!String(r[0] || '').trim()) return;
    var sch = parseSchedule_(r[2]);
    if (sch.kind === 'invalid') { n++; return; }
    var anchor = resolveAnchor_(sch, r[cols.ANCHOR - 1], r[4], today);
    if (!anchor) return;
    var shiftUsed = parseInt(r[cols.SHIFT_USED - 1], 10) || 0;
    var st = computeTaskState_(sch, addDays_(anchor, shiftUsed), parseDMY_(String(r[cols.LAST_DONE - 1] || '').trim()), shiftUsed, today);
    if (st.visible && (st.state === 'due' || st.state === 'overdue')) n++;
  });
  return n;
}

function portalFuelListUsers_() {
  var sh = usersSheet_();
  var cols = ensureUserCols_(sh);
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, sh.getLastColumn()).getDisplayValues()
    .filter(function (r) { return String(r[cols.EMAIL - 1] || '').trim(); })
    .map(function (r) {
      return { localId: String(r[cols.EMAIL - 1]).trim(), name: String(r[cols.NAME - 1] || '').trim(),
               email: String(r[cols.EMAIL - 1]).trim(), role: String(r[cols.ROLE - 1] || '').trim() };
    });
}
