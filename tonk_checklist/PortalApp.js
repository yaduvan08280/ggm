// =========================================================================
//  TONK CHECKLIST (GGM Master Workspace) — HOW GGM PORTAL TALKS TO THIS APP
//  The shared connector is Portal.js (same file in every app).
//
//  People are the rows of the Tonk routine sheet's "Doer List"
//  (A name, B department, C email, D mobile). The app has two screens:
//  DRIVER (drivers / operators / dumpers) and STAFF — the portal's Role
//  dropdown picks one; blank = decided from the department, as before.
//  Every page call now carries a session token holding the exact name and
//  mobile, so the server never trusts a name or mobile sent by the browser.
//    - Not connected yet (no PORTAL_SECRET): the old login still works and
//      also gets a session.
//    - Connected: people sign in with their GGM Portal username/phone and
//      password (the built-in "Main" login no longer works).
//  New people are NOT added to the Doer List automatically: its rows drive
//  task generation, so the admin adds them there first.
// =========================================================================

function portalAdapter_() {
  return {
    startSession: function (c, src) {
      var p = tkResolve_(c.d || c.lu, c.p, c.r);
      if (!p) throw new Error('"' + (c.d || c.lu || c.n) + '" is not in the Tonk Doer List. Ask the IT admin.');
      var token = portalNewSession_({ u: c.u, n: p.name, d: p.fullName, lu: p.name, p: p.mobile, e: c.e,
                                      r: p.role === 'driver' ? 'DRIVER' : 'STAFF' }, src);
      return { token: token, name: p.name, fullName: p.fullName, role: p.role, mobile: p.mobile, dept: p.dept };
    },
    provision: function (w) {
      if (!w.active) return 'signed out';
      if (!tkFindDoer_(w.doer, w.phone)) throw new Error('"' + w.doer + '" is not in the Tonk Doer List. Add the row there first (name, department, email, mobile).');
      return 'found in Doer List';
    },
    endSessions: function () { return 0; },   // cache sessions end through Portal.js (revoke list / epoch)
    counts: tkCounts_,
    meta: function () {
      var seen = {};
      return {
        roles: ['DRIVER', 'STAFF'],
        doers: tkDoerRows_().map(function (r) { return r.name; })
          .filter(function (n) { if (seen[n]) return false; seen[n] = true; return true; })
          .sort(function (a, b) { return a.localeCompare(b); })
      };
    },
    listUsers: function () {
      return tkDoerRows_().map(function (r) {
        return { localId: r.name, name: r.name, phone: r.mobile, email: r.email, role: tkRoleFromDept_(r.dept) === 'driver' ? 'DRIVER' : 'STAFF' };
      });
    }
  };
}

/** Requests from GGM Portal (this app had no doPost before). */
function doPost(e) {
  return portalHandlePost_(e) || ContentService.createTextOutput('Not found');
}

function tkDigits_(v) { var d = String(v || '').replace(/\D/g, ''); return d.length > 10 ? d.slice(-10) : d; }

function tkRoleFromDept_(dept) {
  var d = String(dept || '').toUpperCase();
  return (d.indexOf('DRIVER') > -1 || d.indexOf('OPERATOR') > -1 || d.indexOf('DUMPER') > -1) ? 'driver' : 'staff';
}

/** Tonk routine Doer List rows: A name, B department, C email, D mobile. */
var TK_MEMO_ = {};   // per execution: the badge count resolves many people in one run

function tkDoerRows_() {
  if (TK_MEMO_.doers) return TK_MEMO_.doers;
  var sh = SpreadsheetApp.openById(ROUTINE_SHEET_ID).getSheetByName('Doer List');
  if (!sh || sh.getLastRow() < 2) return [];
  return (TK_MEMO_.doers = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues()
    .map(function (r) { return { name: String(r[0] || '').trim(), dept: String(r[1] || '').trim(), email: String(r[2] || '').trim(), mobile: String(r[3] || '').trim() }; })
    .filter(function (r) { return r.name; }));
}

/** Delegated sheet Users (A mobile … C name) and Doer List (B mobile, D name), read once per run. */
function tkDelegatedLists_() {
  if (TK_MEMO_.del) return TK_MEMO_.del;
  var out = { users: [], doers: [] };
  try {
    var ss2 = SpreadsheetApp.openById(DELEGATED_SHEET_ID);
    var u = ss2.getSheetByName('Users'), d = ss2.getSheetByName('Doer List');
    if (u) out.users = _readBlock(u, 2, 1, 4);
    if (d) out.doers = _readBlock(d, 2, 1, 4);
  } catch (e) { /* the routine name alone still works */ }
  return (TK_MEMO_.del = out);
}

function tkFindDoer_(name, phone) {
  var rows = tkDoerRows_();
  var n = String(name || '').trim();
  var ph = tkDigits_(phone);
  for (var i = 0; i < rows.length; i++) if (n && rows[i].name === n) return rows[i];
  if (ph.length >= 10) for (var j = 0; j < rows.length; j++) if (tkDigits_(rows[j].mobile) === ph) return rows[j];
  return null;
}

/** Same lookup the old login did, without the password: routine Doer List, then the delegated-task name by mobile. */
function tkResolve_(doer, phone, roleHint) {
  var row = tkFindDoer_(doer, phone);
  if (!row) return null;
  var mobile = row.mobile || String(phone || '');
  var fullName = row.name, dept = row.dept;
  try {
    var del = tkDelegatedLists_();
    var mob = tkDigits_(mobile), found = false;
    if (mob) {
      del.users.some(function (r) {
        if (tkDigits_(r[0]) === mob && r[2]) { fullName = String(r[2]).trim(); found = true; return true; }
        return false;
      });
    }
    if (!found && mob) {
      del.doers.some(function (r) {
        if (tkDigits_(r[1]) === mob) {
          fullName = r[3] ? String(r[3]).trim() : String(r[0]).trim();
          if (r[2] && !dept) dept = String(r[2]).trim();
          return true;
        }
        return false;
      });
    }
  } catch (e) { /* the routine name alone still works */ }
  var hint = String(roleHint || '').toUpperCase();
  var role = hint === 'DRIVER' ? 'driver' : hint === 'STAFF' ? 'staff' : tkRoleFromDept_(dept);
  return { name: row.name, fullName: fullName || row.name, role: role, mobile: mobile, dept: dept || 'Staff' };
}

/** The session behind a token as { name, full, mobile, role }, or null. */
function tkSessionOrNull_(token) {
  try {
    var rec = portalCheck_(token);
    return { name: rec.n || rec.d, full: rec.d || rec.n, mobile: rec.p, role: String(rec.r || '').toUpperCase(), username: rec.u };
  } catch (e) { return null; }
}


/** Badge — drivers: today's tasks + open delegated · staff: routine due today or overdue + delegated pending/rejected. */
function tkCounts_(list) {
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var dueByToday = function (str) {
    var m = String(str || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!m) return true;
    return new Date(+m[3], +m[2] - 1, +m[1]).getTime() <= today.getTime();
  };
  var out = {};
  list.forEach(function (x) {
    var p = tkResolve_(x.d || x.lu, '', x.r);
    if (!p) { out[x.u] = 0; return; }
    try {
      if (p.role === 'driver') {
        var dr = drv_getAllTasksForUser_(p.name, p.mobile, false);
        out[x.u] = (dr.todayTasks || []).length + (dr.delegatedTasks || []).length;
        return;
      }
      var res = stf_getAllTasksForUser_(p.name, p.mobile, false);
      var n = 0;
      (res.routineTasks || []).forEach(function (t) { if (t.status === 'pending' && dueByToday(t.dueDate)) n++; });
      (res.delegatedTasks || []).forEach(function (t) {
        if ((t.status === 'pending' || t.status === 'rejected') && t.transferStatus !== 'outgoing') n++;
      });
      out[x.u] = n;
    } catch (e) { out[x.u] = 0; }
  });
  return out;
}
