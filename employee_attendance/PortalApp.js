/*******************************************************
 * PortalApp.gs — how GGM Portal (the hub) talks to Attendance.
 * The shared login is GgmLogin.gs (same file in every v2 app).
 *
 * Who can sign in through the portal: the tab "Portal Users ATTENDANCE" in this
 * spreadsheet, written by the hub the moment the IT admin ticks ATTENDANCE for
 * someone in the Access grid and picks their Role (Supervisor / HR / Admin) and
 * Site (Supervisors need one; blank = all sites). That tab is the only list of
 * users: the Employees tab's Supervisor dropdown follows its Supervisor rows.
 *
 * Setup: Script properties → PORTAL_KEY (the hub shows it: Portal Admin →
 * Connect selected app). Hub Apps row: ATTENDANCE · Type CONNECTED ·
 * Fields role,site · Sheet ID = this spreadsheet.
 *******************************************************/

var GGM_APP = {
  id: 'ATTENDANCE',
  name: 'Attendance',
  hub: 'https://script.google.com/macros/s/AKfycbyWO02yOI3G9IcE1QjCMEvvJostJZL7_2o8DSYIMEswCtI9Ub8sI9uBTdMp_Zd0WSXvSQ/exec?app=ATTENDANCE',
  sheetId: '1Msf0vgketMqVUvd_f_CXOI_YejatEro8iM9BrhGtJVs',   // Employee Attendance (holds "Portal Users ATTENDANCE")

  /** Dropdowns in the hub's Access grid. */
  meta: function () {
    return { roles: ['Supervisor', 'HR', 'Admin'], sites: SITES.slice(), siteRoles: ['Supervisor'] };
  },

  /**
   * Tile badge. Supervisor: own people still to mark today (while marking is open).
   * HR / Admin: today's records waiting for their check.
   */
  counts: function (list) {
    var out = {};
    list.forEach(function (x) {
      try { out[x.u] = attBadge_(x); } catch (e) { out[x.u] = 0; }
    });
    return out;
  }
};

/** Requests from GGM Portal (badges, dropdowns, connection test). */
function doPost(e) {
  return ggmHandlePost_(e) || ContentService.createTextOutput('Not found');
}

function attBadge_(x) {
  var role = normRole_(x.r), site = x.s || 'ALL';
  if (role === 'Supervisor') {
    if (!site || SITES.indexOf(site) === -1 || !isSubmissionWindowOpen_(site).open) return 0;
    var mine = employeesForSupervisor_(ss_(), site, x.u);
    return activeDayRows_(site).filter(function (r) { return mine[r.id] && !r.status; }).length;
  }
  if (role !== 'HR' && role !== 'Admin') return 0;
  var n = 0;
  scopeSites_({ role: role, site: site }).forEach(function (s) {
    n += activeDayRows_(s).filter(function (r) { return r.status && r.approval === APPROVAL_PENDING; }).length;
  });
  return n;
}

/**
 * Opened from a portal tile (?pt=…): the person is signed in before the page is
 * even sent, and the first screen's data rides along in the page — no extra trips.
 */
function attPortalBoot_(e) {
  if (!e || !e.parameter || !e.parameter.pt) return null;
  var gate;
  try { gate = ggmGate_(e); } catch (err) { return { error: 'Attendance is not linked to GGM Portal yet. Sign in with your Attendance account.' }; }
  if (gate.error) return { error: gate.error };
  if (!gate.boot) return null;   // an old pass: the normal sign-in screen
  var res = portalSignIn(gate.boot.token);
  if (!res.ok) return { error: res.error, lang: gate.boot.lang || '' };
  var u = requireSession_(res.token);
  return { session: res, cfg: clientConfig_(u), first: firstScreen_(u), lang: gate.boot.lang || '',
           me: { username: gate.boot.user.username, name: gate.boot.user.name } };
}
