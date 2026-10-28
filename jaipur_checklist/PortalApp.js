/**
 * JAIPUR CHECKLIST (GGM Workspace) — HOW GGM PORTAL TALKS TO THIS APP
 * The shared connector is Portal.js (same file in every app).
 *
 * People are the rows of this sheet's "Doer List" (A = name, D = mobile).
 * Two kinds of user: USER (their own tasks) and ADMIN (the master panel).
 * Every page call carries a session token, so the server never trusts a name
 * sent by the browser.
 *   - Not connected yet (no PORTAL_SECRET): the old login still works and also
 *     gets a session.
 *   - Connected: people sign in with their GGM Portal username/phone and
 *     password (the built-in "Main" login no longer works). Role USER needs a
 *     Doer List name, picked in the portal's Access grid; ADMIN does not.
 * New people are NOT added to the Doer List automatically: its rows drive task
 * generation, so the admin adds them there first.
 */

function portalAdapter_() {
  return {
    startSession: function (c, src) {
      var admin = String(c.r || '').toUpperCase() === 'ADMIN';
      var name = admin ? (c.n || 'Admin') : (jpFindDoer_(c.d || c.lu, c.p) || {}).name;
      if (!name) throw new Error('"' + (c.d || c.lu || c.n) + '" is not in the Jaipur Doer List. Ask the IT admin.');
      var token = portalNewSession_({ u: c.u, n: name, d: name, lu: name, r: admin ? 'ADMIN' : 'USER', p: c.p, e: c.e }, src);
      return { token: token, name: name, isAdmin: admin };
    },
    provision: function (w) {
      if (!w.active || String(w.role).toUpperCase() === 'ADMIN') return w.active ? 'admin: no Doer List row needed' : 'signed out';
      if (!jpFindDoer_(w.doer, w.phone)) throw new Error('"' + w.doer + '" is not in the Jaipur Doer List. Add the row there first (name, department, email, mobile).');
      return 'found in Doer List';
    },
    endSessions: function () { return 0; },   // cache sessions end through Portal.js (revoke list / epoch)
    counts: jpCounts_,
    meta: function () {
      var seen = {};
      return {
        roles: ['USER', 'ADMIN'],
        doers: jpDoerRows_().map(function (r) { return r.name; })
          .filter(function (n) { if (seen[n]) return false; seen[n] = true; return true; })
          .sort(function (a, b) { return a.localeCompare(b); })
      };
    },
    listUsers: function () {
      return jpDoerRows_().map(function (r) { return { localId: r.name, name: r.name, phone: r.mobile, email: r.email, role: 'USER' }; });
    }
  };
}

/** Requests from GGM Portal (this app had no doPost before). */
function doPost(e) {
  return portalHandlePost_(e) || ContentService.createTextOutput('Not found');
}

var JP_DOERS_ = null;   // per execution: the badge count resolves many people in one run

/** Doer List rows: A name, B department, C email, D mobile. */
function jpDoerRows_() {
  if (JP_DOERS_) return JP_DOERS_;
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Doer List');
  if (!sh || sh.getLastRow() < 2) return [];
  return JP_DOERS_ = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues()
    .map(function (r) { return { name: String(r[0] || '').trim(), dept: String(r[1] || '').trim(), email: String(r[2] || '').trim(), mobile: String(r[3] || '').trim() }; })
    .filter(function (r) { return r.name; });
}

function jpDigits_(v) { var d = String(v || '').replace(/\D/g, ''); return d.length > 10 ? d.slice(-10) : d; }

/** The Doer List row for an exact name, else for a mobile number. */
function jpFindDoer_(name, phone) {
  var rows = jpDoerRows_(), n = String(name || '').trim(), ph = jpDigits_(phone);
  for (var i = 0; i < rows.length; i++) if (n && rows[i].name === n) return rows[i];
  if (ph.length >= 10) for (var j = 0; j < rows.length; j++) if (jpDigits_(rows[j].mobile) === ph) return rows[j];
  return null;
}

/** The session behind a token as { name, admin, username }, or null. */
function jpSessionOrNull_(token) {
  try {
    var rec = portalCheck_(token);
    return { name: rec.d || rec.n, admin: String(rec.r || '').toUpperCase() === 'ADMIN', username: rec.u };
  } catch (e) { return null; }
}

/** Badge — USER: tasks due today + missed this month · ADMIN: missed tasks across the team this month. */
function jpCounts_(list) {
  var out = {}, adminMissed = null;
  list.forEach(function (x) {
    try {
      if (String(x.r || '').toUpperCase() === 'ADMIN') {
        if (adminMissed === null) adminMissed = ((getAdminDashboardData_() || {}).companyStats || {}).missed || 0;
        out[x.u] = adminMissed;
        return;
      }
      var p = jpFindDoer_(x.d || x.lu, '');
      if (!p) { out[x.u] = 0; return; }
      out[x.u] = (getTasksForDoer_(p.name).tasks || []).filter(function (t) {
        return t.status === 'pending' && (t.isToday || t.isPastMissed);
      }).length;
    } catch (e) { out[x.u] = 0; }
  });
  return out;
}
