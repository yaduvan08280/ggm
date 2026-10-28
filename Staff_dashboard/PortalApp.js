// =========================================================================
//  STAFF DASHBOARD (GGM Tasks) — HOW GGM PORTAL TALKS TO THIS APP
//  The shared connector is Portal.js (same file in every app).
//
//  Every page call now carries a session token. The session holds the
//  person's exact "Doer List" name, so the server never trusts a name the
//  browser sends.
//    - Not connected yet (no PORTAL_SECRET): the old mobile + password
//      login still works, and it also gets a session.
//    - Connected: people sign in with their GGM Portal username/phone and
//      password; the doer name is picked in the portal's Access grid.
// =========================================================================

function portalAdapter_() {
  return {
    startSession: portalStaffStart_,
    provision: portalStaffProvision_,
    endSessions: function () { return 0; },   // cache sessions end through Portal.js (revoke list / epoch)
    counts: portalStaffCounts_,
    meta: function () {
      var seen = {};
      var doers = (_loadDelegated().doers || []).map(function (d) { return String(d || '').trim(); })
        .filter(function (d) { if (!d || seen[d]) return false; seen[d] = true; return true; })
        .sort(function (a, b) { return a.localeCompare(b); });
      return { doers: doers };
    },
    listUsers: function () {
      try {
        var sh = SpreadsheetApp.openById(DELEGATED_SHEET_ID).getSheetByName('Doer List');
        if (!sh || sh.getLastRow() < 2) return [];
        return sh.getRange(2, 1, sh.getLastRow() - 1, 4).getDisplayValues()
          .filter(function (r) { return String(r[3]).trim(); })
          .map(function (r) { return { localId: String(r[3]).trim(), name: String(r[3]).trim(), phone: String(r[1]).trim() }; });
      } catch (e) { return []; }
    }
  };
}

/** Requests from GGM Portal. */
function doPost(e) {
  return portalHandlePost_(e) || ContentService.createTextOutput('Not found');
}

/** "JPR-Ramesh Kumar (Store)" → "Ramesh Kumar" — the same cleaning the old login did. */
function staffCleanName_(full) {
  full = String(full || '').trim();
  var parts = full.split('-');
  var clean = parts.length >= 2 ? parts.slice(1).join('-').split('(')[0].trim() : full.split('(')[0].trim();
  return clean || full;
}

function portalStaffStart_(c, src) {
  var doer = String(c.d || c.lu || '').trim();
  if (!doer) throw new Error('No doer name is set for you in GGM Portal (Staff Dashboard). Ask the IT admin.');
  var name = staffCleanName_(doer);
  var token = portalNewSession_({ u: c.u, n: name, d: doer, lu: doer, e: c.e, p: c.p }, src);
  return { token: token, name: name, fullName: doer };
}

/** The session behind a token as { name, full, username }, or null. */
function staffSessionOrNull_(token) {
  try {
    var rec = portalCheck_(token);
    return { name: rec.n || staffCleanName_(rec.d), full: rec.d || rec.n, username: rec.u };
  } catch (e) { return null; }
}

/** A person given Staff Dashboard access whose doer name is new is added to the Doer List. */
function portalStaffProvision_(w) {
  if (!w.active) return 'signed out';
  var doer = String(w.doer || '').trim();
  if (!doer) throw new Error('No doer name.');
  var known = (_loadDelegated().doers || []).some(function (d) { return String(d || '').trim() === doer; });
  if (known) return 'found in Doer List';
  var sh = SpreadsheetApp.openById(DELEGATED_SHEET_ID).getSheetByName('Doer List');
  if (!sh) throw new Error("Sheet 'Doer List' not found.");
  // Same columns the Task Delegation app uses: A name, B mobile, C email, D exact full name
  // (without A the delegation app's "assign to" list skips the person).
  sh.appendRow([staffCleanName_(doer), String(w.phone || ''), String(w.email || ''), doer]);
  _invalidate('delegated');
  return 'added to Doer List';
}

/** Badge: routine due today or overdue + delegated pending/rejected (incl. transfer requests to them) + pending renewals. */
function portalStaffCounts_(list) {
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var dueByToday = function (str) {
    var m = String(str || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!m) return true;                                      // "No Date" tasks are still open work
    return new Date(+m[3], +m[2] - 1, +m[1]).getTime() <= today.getTime();
  };
  var out = {};
  list.forEach(function (x) {
    var res;
    try { res = getAllTasksForUser_(staffCleanName_(x.d || x.lu), false); } catch (e) { out[x.u] = 0; return; }
    var n = 0;
    (res.routineTasks || []).forEach(function (t) { if (t.status === 'pending' && dueByToday(t.dueDate)) n++; });
    (res.delegatedTasks || []).forEach(function (t) {
      if ((t.status === 'pending' || t.status === 'rejected') && t.transferStatus !== 'outgoing') n++;
    });
    (res.renewalTasks || []).forEach(function (t) {
      if ((t.status === 'pending' || t.status === 'rejected') && (!t.triggerDate || dueByToday(t.triggerDate))) n++;
    });
    out[x.u] = n;
  });
  return out;
}
