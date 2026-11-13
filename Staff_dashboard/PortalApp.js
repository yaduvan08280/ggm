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
    return { name: rec.n || staffCleanName_(rec.d), full: rec.d || rec.n, username: rec.u, phone: rec.p || '' };
  } catch (e) { return null; }
}

/** A person given Staff Dashboard access whose doer name is new is added to the Doer List,
 *  and - by the site at the start of the doer name - to that site's checklist too. */
function portalStaffProvision_(w) {
  if (!w.active) return 'signed out';
  var doer = String(w.doer || '').trim();
  if (!doer) throw new Error('No doer name.');
  var site = staffAddToSiteChecklist_(doer, w.phone, w.email);
  var known = (_loadDelegated().doers || []).some(function (d) { return String(d || '').trim() === doer; });
  if (known) return 'found in Doer List' + site;
  var sh = SpreadsheetApp.openById(DELEGATED_SHEET_ID).getSheetByName('Doer List');
  if (!sh) throw new Error("Sheet 'Doer List' not found.");
  // Same columns the Task Delegation app uses: A name, B mobile, C email, D exact full name
  // (without A the delegation app's "assign to" list skips the person).
  sh.appendRow([staffCleanName_(doer), String(w.phone || ''), String(w.email || ''), doer]);
  _invalidate('delegated');
  return 'added to Doer List' + site;
}

/* ---- Site checklists ---------------------------------------------------
   The doer name says where a person works: "JPR - …" Jaipur, "NEWAI - …" Newai, "TONK - …" Tonk.
   Those people also belong on that site's checklist Doer List (A name, B department, C email,
   D mobile = username, E password); anyone else is on the Staff Dashboard only.           */
var SITE_CHECKLISTS = {
  JPR:   { label: 'Jaipur checklist', id: ROUTINE_SHEET_ID },
  NEWAI: { label: 'Newai checklist',  id: NEWAI_ROUTINE_SHEET_ID },
  TONK:  { label: 'Tonk checklist',   id: '1FT2ZCdzMIpqw2LQjs5l5zbCX6d1ir5mpm6Bux3dlA3Q' }
};

/** "JPR - SANIYA (INTERN) - 8302684274" → { site: 'JPR', name: 'SANIYA', dept: 'INTERN', mobile: '8302684274' } */
function staffDoerParts_(doer, phone) {
  var m = String(doer || '').trim().match(/^([A-Za-z]+)\s*-\s*(.*)$/);
  if (!m) return { site: '', name: '', dept: '', mobile: '' };
  var rest = m[2].trim(), mobile = '';
  var tail = rest.match(/\s*-\s*(\+?\d[\d\s]{9,14})\s*$/);
  if (tail) { mobile = tail[1]; rest = rest.slice(0, tail.index).trim(); }
  var dept = '', br = rest.match(/\(([^)]*)\)\s*$/);
  if (br) { dept = br[1].trim().toUpperCase(); rest = rest.slice(0, br.index).trim(); }
  var digits = function (v) { var d = String(v || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; };
  return { site: m[1].toUpperCase(), name: rest.replace(/\s+/g, ' ').toUpperCase(), dept: dept, mobile: digits(mobile) || digits(phone) };
}

/** Adds the person to their site's checklist Doer List when they are not on it yet (matched by
 *  mobile, else by name). Returns a note for the portal's Sync tab; never blocks Staff access. */
// The checklist spreadsheets are big (opening one takes ~30 s), so each is opened once per run.
var siteChecklistOpen_ = {};

function staffAddToSiteChecklist_(doer, phone, email) {
  var p = staffDoerParts_(doer, phone), sc = SITE_CHECKLISTS[p.site];
  if (!sc || !p.name) return '';
  try {
    var open = siteChecklistOpen_[sc.id];
    if (!open) {
      var s = SpreadsheetApp.openById(sc.id).getSheetByName('Doer List');
      open = siteChecklistOpen_[sc.id] = { sh: s, rows: s && s.getLastRow() > 1 ? s.getRange(2, 1, s.getLastRow() - 1, 4).getValues() : [] };
    }
    var sh = open.sh, rows = open.rows;
    if (!sh) return '; ' + sc.label + ' has no Doer List tab';
    var digits = function (v) { var d = String(v || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; };
    // same person = same mobile, or the same name ignoring "JI"; a one-word name ("VIPIN")
    // also matches a longer name starting with it ("VIPIN GOYAL")
    var key = function (s) { return String(s || '').toUpperCase().replace(/\bJI\b/g, ' ').replace(/\s+/g, ' ').trim(); };
    var me = key(p.name), one = me.indexOf(' ') < 0;
    var there = rows.some(function (r) {
      var k = key(r[0]);
      return (p.mobile && digits(r[3]) === p.mobile) || k === me || (one && k.split(' ')[0] === me);
    });
    if (there) return '; on the ' + sc.label;
    // The checklist apps' own mobile + password login reads column E, so it gets a random value
    // nobody knows (never blank); people sign in through GGM Portal.
    var row = [p.name, p.dept, String(email || ''), p.mobile, Utilities.getUuid().replace(/-/g, '').slice(0, 12)];
    sh.appendRow(row);
    rows.push(row);
    return '; added to the ' + sc.label;
  } catch (e) {
    return '; could not add to the ' + sc.label + ': ' + (e.message || e);
  }
}

/** One-time / on demand (editor): everyone already in the Delegated Doer List whose doer name
 *  starts with JPR / NEWAI / TONK is put on that site's checklist if missing. */
function addSitePeopleToChecklists() {
  var sh = SpreadsheetApp.openById(DELEGATED_SHEET_ID).getSheetByName('Doer List');
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues(), log = [];
  rows.forEach(function (r) {
    var doer = String(r[3] || r[0] || '').trim();
    var note = staffAddToSiteChecklist_(doer, r[1], r[2]);
    if (/added|could not|no Doer List/.test(note)) log.push(doer + note);
  });
  Logger.log(log.length ? log.join('\n') : 'Everyone is already on their site checklist.');
  return log;
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
    try { res = getAllTasksForUser_(staffCleanName_(x.d || x.lu), false, x.d || x.lu, x.p); } catch (e) { out[x.u] = 0; return; }
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
