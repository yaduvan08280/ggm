// =========================================================================
//  MAIN ADMIN DASHBOARD — HOW GGM PORTAL TALKS TO THIS APP
//  The shared connector is Portal.js (same file in every app).
//
//  This app had no login at all. Once PORTAL_SECRET is set:
//    - every page call needs a session (opened from GGM Portal, or signed
//      in on this app's own login screen while Portal-only is OFF);
//    - "Given By" is the signed-in admin's username;
//    - "Assign to" lists the GGM Portal users who have the Staff Dashboard;
//    - every change is stamped with the username in new columns on the
//      right of the sheet it touches (see MA_COLS).
//  Before PORTAL_SECRET is set the app works exactly as it did.
// =========================================================================

/** First column of each "done by" block. Headers are written if the cells are empty;
    if a header cell already holds something else, nothing is stamped there. */
var MA_COLS = {
  MASTER_CREATED: 21,  // Delegated Master   U Created By · V Last Action · W Last Action By · X Last Action At
  MASTER_ACTION: 22,   //                    (V–X on later changes)
  LEAVE_BY: 11,        // Delegated Leave     K Decided By · L Decided At
                       // (Renewals: Action By / Action At now go to the Feed Inputs tab - RenewalCore.js)
  ROUTINE_BY: 16      // Routine Master / Monthly Master   P Marked By · Q Marked At
};

function portalAdapter_() {
  return {
    startSession: function (c, src) {
      return { token: portalNewSession_(c, src), username: c.u, name: c.n, role: maRole_(c.r) };
    },
    provision: function (w) { return w.active ? 'no sheet write needed' : 'signed out'; },
    endSessions: function () { return 0; },   // cache sessions end through Portal.js (revoke list / epoch)
    counts: maCounts_,
    meta: function () { return { roles: ['ADMIN', 'EA'] }; },   // GGM Portal → Access → MAIN ADMIN → Role
    listUsers: function () { return []; }
  };
}

/** Requests from GGM Portal (this app had no doPost before). */
function doPost(e) {
  return portalHandlePost_(e) || ContentService.createTextOutput('Not found');
}

/** This app's own login screen (only while Portal-only is OFF). */
function maLogin(id, pw) {
  if (!portalEnabled_()) return { success: false, message: 'This app is not connected to GGM Portal yet.' };
  try {
    var b = portalRemoteLogin_(id, pw);
    return { success: true, token: b.token, username: b.username, name: b.name, role: b.role || '' };
  } catch (e) {
    return { success: false, message: e.message || String(e) };
  }
}

/** Who is calling. Not connected yet → { legacy: true } (no login, as before). Bad session → null. */
function maSessionOrNull_(token) {
  if (!portalEnabled_()) return { legacy: true, u: '', n: '' };
  try {
    var rec = portalCheck_(token);
    var role = maRole_(rec.r);
    maNoteEA_(rec.u, role === 'EA');
    return { legacy: false, u: rec.u, n: rec.n, role: role, ea: role === 'EA' };
  } catch (e) { return null; }
}

/**
 * Roles (GGM Portal → Access → MAIN ADMIN → Role):
 *   ADMIN (or blank) - everything, as before.
 *   EA               - only Delegated Tasks: sees them and adds new ones for an admin
 *                      (picks that admin in "Given By"; never herself). No approve / edit /
 *                      transfer / leave / renewal / routine actions.
 */
function maRole_(r) { return String(r || '').trim().toUpperCase() === 'EA' ? 'EA' : 'ADMIN'; }

/** EA usernames seen in sessions (kept so they never show up in anyone's "Given By" list). */
function maEAList_() { try { return JSON.parse(portalP_('MA_EA_USERS') || '[]'); } catch (e) { return []; } }
function maNoteEA_(u, isEA) {
  u = String(u || '').trim(); if (!u) return;
  var list = maEAList_(), lc = u.toLowerCase();
  var has = list.some(function (x) { return String(x).toLowerCase() === lc; });
  if (isEA === has) return;                              // nothing changed: no write
  list = list.filter(function (x) { return String(x).toLowerCase() !== lc; });
  if (isEA) list.push(u);
  portalSetP_('MA_EA_USERS', JSON.stringify(list));
}

/** "Given By" choices for an EA: every active portal user with this app, except EAs (cached 5 min). */
function maGivers_(me) {
  var cache = CacheService.getScriptCache(), list = null, hit = cache.get('ma_givers');
  if (hit) list = JSON.parse(hit);
  else {
    list = portalCallHub_('directory', { app: portalAppId_() || 'MAIN ADMIN' })
      .map(function (x) { return { u: String(x.u || '').trim(), n: String(x.n || x.u || '').trim() }; })
      .filter(function (x) { return x.u; })
      .sort(function (a, b) { return a.n.localeCompare(b.n); });
    cache.put('ma_givers', JSON.stringify(list), 300);
  }
  var ea = maEAList_().map(function (x) { return String(x).toLowerCase(); });
  me = String(me || '').toLowerCase();
  return list.filter(function (x) { var lc = x.u.toLowerCase(); return lc !== me && ea.indexOf(lc) < 0; });
}

var MA_EA_DENIED = { success: false, error: 'Your role (EA) can only add new tasks.' };


function maNow_() { return Utilities.formatDate(new Date(), 'GMT+05:30', 'dd/MM/yyyy HH:mm:ss'); }

/** "Assign to" list: exact doer names of active portal users with the Staff Dashboard (cached 5 min). */
function maPortalDoers_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('ma_doers');
  if (hit) return JSON.parse(hit);
  // The live hub calls it "STAFF DASHBOARD"; asking for "STAFF" got "Unknown app" and the
  // old Delegated Doer List (25 names) was shown instead of every portal doer.
  var ids = [portalP_('PORTAL_STAFF_APP_ID'), 'STAFF DASHBOARD', 'STAFF'].filter(Boolean), list = null, err;
  for (var i = 0; i < ids.length && !list; i++) {
    try { list = portalCallHub_('directory', { app: ids[i] }); } catch (e) { err = e; }
  }
  if (!list) throw err;
  var seen = {};
  var doers = list
    .map(function (x) { return String(x.d || x.lu || '').trim(); })
    .filter(function (d) { if (!d || seen[d]) return false; seen[d] = true; return true; })
    .sort(function (a, b) { return a.localeCompare(b); });
  cache.put('ma_doers', JSON.stringify(doers), 300);
  return doers;
}

function maDoerAllowed_(name) {
  try { return maPortalDoers_().indexOf(String(name || '').trim()) > -1; }
  catch (e) { return true; }   // portal unreachable: do not block the work
}

/** Writes values into a "done by" block, adding its headers the first time. */
function maStamp_(sheet, row, headerRow, startCol, labels, values, sess) {
  if (!sess || sess.legacy || !sess.u || !sheet || !row) return;
  try {
    var need = startCol + labels.length - 1;
    if (sheet.getMaxColumns() < need) sheet.insertColumnsAfter(sheet.getMaxColumns(), need - sheet.getMaxColumns());
    var head = sheet.getRange(headerRow, startCol, 1, labels.length).getValues()[0];
    for (var i = 0; i < labels.length; i++) {
      var h = String(head[i] || '').trim();
      if (!h) sheet.getRange(headerRow, startCol + i).setValue(labels[i]).setFontWeight('bold');
      else if (h !== labels[i]) {
        console.warn('maStamp_: ' + sheet.getName() + ' column ' + (startCol + i) + ' is "' + h + '", expected "' + labels[i] + '". Not stamped.');
        return;
      }
    }
    sheet.getRange(row, startCol, 1, values.length).setValues([values]);
  } catch (e) { console.error('maStamp_: ' + e); }
}

function maStampAction_(sheet, row, action, sess) {
  maStamp_(sheet, row, 1, MA_COLS.MASTER_ACTION, ['Last Action', 'Last Action By', 'Last Action At'], [action, sess.u, maNow_()], sess);
}

/** Badge: what is waiting on the admins (the same number for every admin). */
function maCounts_(list) {
  var n = 0;
  try {
    var master = getSheetData_();
    (master.rows || []).forEach(function (r) { if (String(r[9] || '').trim().toLowerCase() === 'review') n++; });
  } catch (e) {}
  try {
    var leaves = getLeaveData_();
    (leaves.rows || []).forEach(function (r) { if (String(r.status || '').trim().toLowerCase() === 'pending') n++; });
  } catch (e) {}
  try {
    var ren = getRenewalData_();
    (ren.rows || []).forEach(function (r) {
      var st = String(r.status || '').trim().toLowerCase();
      if (st === 'review' || (!st && String(r.renewedOn || '').trim())) n++;
    });
  } catch (e) {}
  var out = {};
  list.forEach(function (x) { out[x.u] = maRole_(x.r) === 'EA' ? 0 : n; });   // EA has nothing to approve
  return out;
}
