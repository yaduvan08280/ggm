/**
 * NEWAI CHECKLIST — HOW GGM PORTAL TALKS TO THIS APP
 * The shared connector is Portal.js (same file in every app).
 *
 * People are the rows of this sheet's "Doer List" (A = name, D = mobile).
 * Every page call now carries a session token holding that exact name and
 * mobile, so the server never trusts a name or mobile sent by the browser.
 *   - Not connected yet (no PORTAL_SECRET): the old mobile + password login
 *     still works, and it also gets a session.
 *   - Connected: people sign in with their GGM Portal username/phone and
 *     password; their Doer List name is picked in the portal's Access grid.
 * New people are NOT added to the Doer List automatically: its rows drive
 * task generation (department, email), so the admin adds them there first.
 */

function portalAdapter_() {
  return {
    startSession: function (c, src) {
      var p = ckFindDoer_(c.d || c.lu, c.p);
      if (!p) throw new Error('"' + (c.d || c.lu || c.n) + '" is not in the Newai Doer List. Ask the IT admin.');
      var token = portalNewSession_({ u: c.u, n: p.name, d: p.name, lu: p.name, p: p.mobile, e: c.e }, src);
      return { token: token, name: p.name, fullName: p.name, mobile: p.mobile };
    },
    provision: function (w) {
      if (!w.active) return 'signed out';
      if (!ckFindDoer_(w.doer, w.phone)) throw new Error('"' + w.doer + '" is not in the Newai Doer List. Add the row there first (name, department, email, mobile).');
      return 'found in Doer List';
    },
    endSessions: function () { return 0; },   // cache sessions end through Portal.js (revoke list / epoch)
    counts: ckCounts_,
    meta: function () {
      var seen = {};
      return { doers: ckDoerRows_().map(function (r) { return r.name; })
        .filter(function (n) { if (seen[n]) return false; seen[n] = true; return true; })
        .sort(function (a, b) { return a.localeCompare(b); }) };
    },
    listUsers: function () {
      return ckDoerRows_().map(function (r) {
        return { localId: r.name, name: r.name, phone: r.mobile, email: r.email, role: r.dept };
      });
    }
  };
}

/** Requests from GGM Portal (this app had no doPost before). */
function doPost(e) {
  return portalHandlePost_(e) || ContentService.createTextOutput('Not found');
}

function ckDigits_(v) { var d = String(v || '').replace(/\D/g, ''); return d.length > 10 ? d.slice(-10) : d; }

/** Doer List rows: A name, B department, C email, D mobile. */
var CK_DOERS_ = null;   // per execution: the badge count resolves many people in one run

function ckDoerRows_() {
  if (CK_DOERS_) return CK_DOERS_;
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Doer List');
  if (!sh || sh.getLastRow() < 2) return [];
  return CK_DOERS_ = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues()
    .map(function (r) { return { name: String(r[0] || '').trim(), dept: String(r[1] || '').trim(), email: String(r[2] || '').trim(), mobile: String(r[3] || '').trim() }; })
    .filter(function (r) { return r.name; });
}

/** The Doer List row for an exact name, else for a mobile number. */
function ckFindDoer_(name, phone) {
  var rows = ckDoerRows_();
  var n = String(name || '').trim();
  var ph = ckDigits_(phone);
  for (var i = 0; i < rows.length; i++) if (n && rows[i].name === n) return rows[i];
  if (ph.length >= 10) for (var j = 0; j < rows.length; j++) if (ckDigits_(rows[j].mobile) === ph) return rows[j];
  return null;
}

/** The session behind a token as { name, full, mobile, username }, or null. */
function ckSessionOrNull_(token) {
  try {
    var rec = portalCheck_(token);
    return { name: rec.d || rec.n, full: rec.d || rec.n, mobile: rec.p, username: rec.u };
  } catch (e) { return null; }
}


/** Badge: routine tasks due today or overdue + delegated pending/rejected (incl. transfer requests to them). */
function ckCounts_(list) {
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var dueByToday = function (str) {
    var m = String(str || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!m) return true;
    return new Date(+m[3], +m[2] - 1, +m[1]).getTime() <= today.getTime();
  };
  var out = {};
  list.forEach(function (x) {
    var p = ckFindDoer_(x.d || x.lu, '');
    if (!p) { out[x.u] = 0; return; }
    var res;
    try { res = getAllTasksForUser_(p.name, p.mobile, false); } catch (e) { out[x.u] = 0; return; }
    var n = 0;
    (res.routineTasks || []).forEach(function (t) { if (t.status === 'pending' && dueByToday(t.dueDate)) n++; });
    (res.delegatedTasks || []).forEach(function (t) {
      if ((t.status === 'pending' || t.status === 'rejected') && t.transferStatus !== 'outgoing') n++;
    });
    out[x.u] = n;
  });
  return out;
}
