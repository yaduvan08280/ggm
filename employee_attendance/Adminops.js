/*******************************************************
 * AdminOps.gs — manage employees, users, site settings,
 * and the managing-director overview.
 *******************************************************/

function listSites() { return SITES.slice(); }

var MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var MONTH_INDEX = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

/** "Aug-2026" -> a sortable number. Avoids relying on Date string parsing. */
function monthSortKey_(label) {
  var p = String(label).split('-');
  var mi = MONTH_INDEX[p[0]];
  if (mi === undefined) return 0;
  return Number(p[1]) * 12 + mi;
}

/** Pushes the Employees tab onto this year's site tab straight away. */
function refreshRosterNow_(ss, site) {
  if (SITES.indexOf(site) === -1) return;
  var t = todayParts_();
  var sh = ensureYearSheet_(ss, site, t.year);
  syncRoster_(ss, sh, site, t.year, true);
  dropDay_(site);
  cacheDrop_('ATT_OVERVIEW_' + t.iso);
}

/* ---------------- EMPLOYEES ---------------- */

function getEmployees(token, site) {
  var user = requireRole_(token, ['HR', 'Admin']);
  var allowed = scopeSites_(user);
  var out = employeesAll_().filter(function (e) {
    if (allowed.indexOf(e.site) === -1) return false;
    return !site || site === 'ALL' || e.site === site;
  });
  out.sort(function (a, b) { return (a.site + a.name).localeCompare(b.site + b.name); });
  return out;
}

/** Everything the Staff screen needs in one call: employees, supervisor picker, next free IDs. */
function getStaffData(token) {
  var user = requireRole_(token, ['HR', 'Admin']);
  var next = {};
  scopeSites_(user).forEach(function (s) { next[s] = nextEmployeeId_(s); });
  return { employees: getEmployees(token, 'ALL'), supervisors: getSupervisorOptions(token), nextIds: next };
}

/** GGM Portal supervisors, for the picker on the Staff screen. */
function getSupervisorOptions(token) {
  var user = requireRole_(token, ['HR', 'Admin']);
  var allowed = scopeSites_(user);
  return listSupervisors_(ss_(), true)
    .filter(function (s) { return allowed.indexOf(s.site) !== -1; })
    .map(function (s) { return { username: s.username, name: s.name, site: s.site, portal: !!s.portal }; });
}

/**
 * The next free Employee ID for a site, following the IDs it already has:
 * TNK-014, TNK-015 … → TNK-016. Never one that exists anywhere.
 */
function nextEmployeeId_(site) {
  var all = employeesAll_(), taken = {}, prefixes = {};
  all.forEach(function (e) {
    taken[e.id.toLowerCase()] = true;
    if (e.site !== site) return;
    var m = e.id.match(/^(.*?)(\d+)$/);
    if (!m) return;
    var p = prefixes[m[1]] = prefixes[m[1]] || { n: 0, max: 0, width: 0 };
    p.n++; p.max = Math.max(p.max, Number(m[2])); p.width = Math.max(p.width, m[2].length);
  });
  var best = null;
  Object.keys(prefixes).forEach(function (k) { if (!best || prefixes[k].n > prefixes[best].n) best = k; });
  if (best === null) return '';
  var p = prefixes[best], n = p.max + 1, id;
  do { id = best + ('000000000' + n).slice(-Math.max(p.width, String(n).length)); n++; } while (taken[id.toLowerCase()]);
  return id;
}

/**
 * A supervisor name is optional, but if one is given it has to be a real
 * Supervisor account posted to the same site — otherwise nobody would see
 * that employee.
 */
function checkSupervisor_(ss, supervisor, site) {
  var want = String(supervisor || '').trim();
  if (!want) return { ok: true, value: '' };
  var match = listSupervisors_(ss, false).filter(function (s) {
    return s.key === want.toLowerCase();
  })[0];
  if (!match) return { ok: false, error: want + ' is not an active supervisor account.' };
  if (match.site !== site) {
    return { ok: false, error: match.username + ' is posted to ' + (match.site || 'no site') + ', not ' + site + '.' };
  }
  return { ok: true, value: match.username };
}

function addEmployee(token, id, name, site, supervisor, designation, secondary) {
  var user = requireRole_(token, ['HR', 'Admin']);
  resolveSite_(user, site);
  return addEmployeeCore_(user, id, name, site, supervisor, designation, secondary);
}

/** The Secondary Site field: one of SITES other than the main site, or blank. */
function checkSecondary_(secondary, site) {
  var v = String(secondary || '').trim();
  if (!v) return { ok: true, value: '' };
  var s2 = secondarySite_(v, site);
  if (!s2) return { ok: false, error: SITES.indexOf(v) > -1 ? 'The second site has to be different from the main site.' : 'Pick a second site from the list.' };
  return { ok: true, value: s2 };
}

/**
 * A supervisor adds a worker to their own site. The worker is put on the
 * supervisor's own list and can be marked straight away.
 */
function supervisorAddEmployee(token, id, name, designation) {
  var user = requireRole_(token, ['Supervisor']);
  var mine = listSupervisors_(ss_(), true).some(function (s) { return s.key === user.username.toLowerCase() && s.site === user.site; });
  var res = addEmployeeCore_(user, id, name, user.site, mine ? user.username : '', designation, '');
  if (!res.ok) return res;
  res.employee = {
    id: String(id).trim(), name: String(name).trim(), designation: designation || '',
    status: null, approval: APPROVAL_PENDING, sentBack: false, unassigned: !mine, locked: false
  };
  return res;
}

function addEmployeeCore_(user, id, name, site, supervisor, designation, secondary) {
  id = String(id).trim();
  name = String(name || '').trim();
  if (!id || !name) return { ok: false, error: 'Employee ID and name are both needed.' };
  if (SITES.indexOf(site) === -1) return { ok: false, error: 'Pick a site.' };

  var ss = ss_();
  var sup = checkSupervisor_(ss, supervisor, site);
  if (!sup.ok) return { ok: false, error: sup.error };
  var sec = checkSecondary_(secondary, site);
  if (!sec.ok) return { ok: false, error: sec.error };

  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) { return { ok: false, error: 'Server busy, try again.' }; }
  try {
    var sh = ss.getSheetByName(SHEET_EMPLOYEES);
    var last = sh.getLastRow();
    if (last >= 2) {
      var ids = sh.getRange(2, 1, last - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) {
        if (String(ids[i][0]).trim().toLowerCase() === id.toLowerCase()) return { ok: false, error: 'Employee ID ' + id + ' already exists.' };
      }
    }

    var row = last + 1;
    sh.getRange(row, 1, 1, EMP_COL_COUNT)
      .setValues([[id, name, site, sup.value, designation || '', true, sec.value]]);
    sh.getRange(row, EMP_COL_ACTIVE).insertCheckboxes().setValue(true);
    dropEmployees_();
    refreshRosterNow_(ss, site);
  } finally {
    lock.releaseLock();
  }

  logAudit_({
    site: site, employeeId: id, employeeName: name, action: 'EMPLOYEE_ADD',
    value: (sup.value ? 'supervisor ' + sup.value : 'unassigned') + (sec.value ? ', second site ' + sec.value : ''),
    byUser: user.username, byRole: user.role
  });
  return { ok: true, nextId: nextEmployeeId_(site) };
}

function editEmployee(token, row, id, name, site, supervisor, designation, active, secondary) {
  var user = requireRole_(token, ['HR', 'Admin']);
  resolveSite_(user, site);
  var ss = ss_();
  var sup = checkSupervisor_(ss, supervisor, site);
  if (!sup.ok) return { ok: false, error: sup.error };
  var sec = checkSecondary_(secondary, site);
  if (!sec.ok) return { ok: false, error: sec.error };

  var sh = ss.getSheetByName(SHEET_EMPLOYEES);
  var before = sh.getRange(row, 1, 1, EMP_COL_SITE).getValues()[0];
  var oldSite = String(before[EMP_COL_SITE - 1]).trim();

  sh.getRange(row, 1, 1, EMP_COL_COUNT)
    .setValues([[String(id).trim(), name, site, sup.value, designation || '', !!active, sec.value]]);
  dropEmployees_();

  refreshRosterNow_(ss, site);
  if (oldSite && oldSite !== site) refreshRosterNow_(ss, oldSite);   // move them off the old site's tab

  logAudit_({
    site: site, employeeId: id, employeeName: name, action: 'EMPLOYEE_EDIT',
    value: (sup.value ? 'supervisor ' + sup.value : 'unassigned') + (sec.value ? ', second site ' + sec.value : ''),
    byUser: user.username, byRole: user.role
  });
  return { ok: true };
}

/** Switch off — the row stays on the site tab but goes grey, so history survives. */
function removeEmployee(token, row) {
  var user = requireRole_(token, ['HR', 'Admin']);
  var ss = ss_();
  var sh = ss.getSheetByName(SHEET_EMPLOYEES);
  var rec = sh.getRange(row, 1, 1, EMP_COL_SITE).getValues()[0];
  var site = String(rec[EMP_COL_SITE - 1]).trim();
  resolveSite_(user, site);
  sh.getRange(row, EMP_COL_ACTIVE).setValue(false);
  dropEmployees_();
  refreshRosterNow_(ss, site);
  logAudit_({ site: site, employeeId: rec[0], employeeName: rec[1], action: 'EMPLOYEE_DEACTIVATE', byUser: user.username, byRole: user.role });
  return { ok: true };
}

/**
 * Hard delete. Takes the employee off the Employees tab, which is the only
 * thing that removes their row — and their history — from the site tabs.
 * Admin only, on purpose.
 */
function deleteEmployeePermanently(token, row) {
  var user = requireRole_(token, ['Admin']);
  var ss = ss_();
  var sh = ss.getSheetByName(SHEET_EMPLOYEES);
  var rec = sh.getRange(row, 1, 1, EMP_COL_SITE).getValues()[0];
  var site = String(rec[EMP_COL_SITE - 1]).trim();
  resolveSite_(user, site);
  sh.deleteRow(row);
  dropEmployees_();
  refreshRosterNow_(ss, site);
  logAudit_({
    site: site, employeeId: rec[0], employeeName: rec[1],
    action: 'EMPLOYEE_DELETE', value: 'removed from all site tabs',
    byUser: user.username, byRole: user.role
  });
  return { ok: true };
}

/* ---------------- USERS ---------------- */

/**
 * The people GGM Portal lets in (the "Portal Users ATTENDANCE" tab), to read only:
 * they are added, changed and removed in the portal's Access grid.
 */
function getUsersData(token) {
  requireRole_(token, ['HR', 'Admin']);
  var portal = [], rows = {};
  try { rows = ggmRows_(); } catch (e) { /* not linked to GGM Portal yet */ }
  Object.keys(rows).forEach(function (k) {
    var p = rows[k];
    portal.push({ username: p.username, name: p.name, role: normRole_(p.role) || p.role, site: p.site || 'ALL' });
  });
  portal.sort(function (a, b) { return a.name.localeCompare(b.name); });
  return { portal: portal };
}

/* ---------------- SITE SETTINGS ---------------- */

function getSettings(token) {
  var user = requireRole_(token, ['HR', 'Admin']);
  var allowed = scopeSites_(user);
  var all = settingsAll_();
  return Object.keys(all).filter(function (s) { return allowed.indexOf(s) !== -1; }).map(function (s) {
    var x = all[s];
    return { site: s, closingTime: x.closingTime, refreshSeconds: x.refreshSeconds, lockLogin: x.lockLogin, allowResubmit: x.allowResubmit,
             fdHours: x.fdHours, hdHours: x.hdHours, autoAbsent: x.autoAbsent !== false, row: x.row };
  });
}

/** fdHours / hdHours (optional): punch-report check, first-to-last punch hours for a Full / Half day. */
function updateSettings(token, row, closingTime, refreshSeconds, lockLogin, allowResubmit, fdHours, hdHours, autoAbsent) {
  var user = requireRole_(token, ['HR', 'Admin']);
  var clean = normalizeTime_(closingTime);
  if (!clean) return { ok: false, error: 'Closing time must look like 15:00.' };
  var secs = Number(refreshSeconds);
  if (!secs || secs < 10 || secs > 600) return { ok: false, error: 'Refresh must be between 10 and 600 seconds.' };
  var fd = Number(fdHours), hd = Number(hdHours);
  if (fdHours !== undefined && (!(fd > 0 && fd <= 24) || !(hd > 0 && hd < fd))) {
    return { ok: false, error: 'Half-day hours must be more than 0 and less than full-day hours.' };
  }

  var sh = ss_().getSheetByName(SHEET_SETTINGS);
  var site = String(sh.getRange(row, 1).getValue()).trim();
  resolveSite_(user, site);

  sh.getRange(row, 2).setNumberFormat('@').setValue(clean);
  sh.getRange(row, 3).setValue(secs);
  sh.getRange(row, 4).setValue(!!lockLogin);
  sh.getRange(row, 5).setValue(!!allowResubmit);
  if (fdHours !== undefined) {
    if (!String(sh.getRange(1, 6).getValue()).trim()) sh.getRange(1, 6, 1, 2).setValues([['Full Day Hours (punch)', 'Half Day Hours (punch)']]).setFontWeight('bold');
    sh.getRange(row, 6, 1, 2).setValues([[fd, hd]]);
  }
  if (autoAbsent !== undefined) {
    if (!String(sh.getRange(1, 8).getValue()).trim()) sh.getRange(1, 8).setValue('Auto Absent At Closing').setFontWeight('bold');
    sh.getRange(row, 8).setValue(!!autoAbsent);
  }
  cacheDrop_('ATT_SETTINGS');

  logAudit_({ site: site, action: 'SETTINGS_UPDATE', value: clean + ' / ' + secs + 's', byUser: user.username, byRole: user.role });
  return { ok: true };
}

/* ---------------- MANAGING-DIRECTOR OVERVIEW ---------------- */

/** doy -> 0-based month index, for one year. */
function monthOfDayArray_(year) {
  var m = monthOffsets_(year);
  var out = [0];   // index 0 unused
  for (var i = 0; i < 12; i++) {
    for (var d = 0; d < m.lengths[i]; d++) out.push(i);
  }
  return out;
}

/**
 * Scans every <site>_<yyyy> tab once and aggregates. Values and colours are
 * each read in a single call per tab, and the whole thing is cached for
 * 5 minutes — all-time history does not change second to second.
 */
function getAllTimeStats(token) {
  requireRole_(token, ['Admin']);
  var hit = cacheGetJson_('ALLTIME_STATS');
  if (hit) return hit;

  var ss = ss_();
  var bySite = {};
  var byMonth = {};
  var bySiteMonth = {};

  SITES.forEach(function (s) { bySite[s] = { full: 0, half: 0, absent: 0, verified: 0, sentBack: 0 }; bySiteMonth[s] = {}; });

  ss.getSheets().forEach(function (sh) {
    var info = siteFromYearTab_(sh.getName());
    if (!info) return;

    var lastRow = sh.getLastRow();
    if (lastRow < FIRST_DATA_ROW) return;
    var days = Math.min(daysInYear_(info.year), Math.max(0, sh.getLastColumn() - 2));
    if (days < 1) return;

    var nRows = lastRow - FIRST_DATA_ROW + 1;
    var idCol = sh.getRange(FIRST_DATA_ROW, 1, nRows, 1).getValues();
    var rng = sh.getRange(FIRST_DATA_ROW, FIRST_DAY_COL, nRows, days);
    var vals = rng.getValues();
    var bgs = rng.getBackgrounds();
    var monthOf = monthOfDayArray_(info.year);

    for (var r = 0; r < nRows; r++) {
      if (!idCol[r][0]) continue;
      for (var d = 0; d < days; d++) {
        var status = statusFromCode_(vals[r][d]);
        if (!status) continue;
        var label = MONTH_NAMES[monthOf[d + 1]] + '-' + info.year;
        if (!byMonth[label]) byMonth[label] = { full: 0, half: 0, absent: 0 };
        var sm = bySiteMonth[info.site][label] = bySiteMonth[info.site][label] || { full: 0, half: 0, absent: 0 };

        if (status === 'Full Day') { bySite[info.site].full++; byMonth[label].full++; sm.full++; }
        else if (status === 'Half Day') { bySite[info.site].half++; byMonth[label].half++; sm.half++; }
        else { bySite[info.site].absent++; byMonth[label].absent++; sm.absent++; }

        var approval = approvalFromColor_(bgs[r][d]);
        if (approval === APPROVAL_APPROVED) bySite[info.site].verified++;
        else if (approval === APPROVAL_SENTBACK) bySite[info.site].sentBack++;
      }
    }
  });

  var months = Object.keys(byMonth).sort(function (a, b) { return monthSortKey_(a) - monthSortKey_(b); });

  var grand = { full: 0, half: 0, absent: 0, verified: 0, sentBack: 0 };
  SITES.forEach(function (s) {
    grand.full += bySite[s].full; grand.half += bySite[s].half; grand.absent += bySite[s].absent;
    grand.verified += bySite[s].verified; grand.sentBack += bySite[s].sentBack;
  });
  var records = grand.full + grand.half + grand.absent;
  grand.records = records;
  grand.manDays = Math.round((grand.full + grand.half * 0.5) * 10) / 10;
  grand.attendancePct = records ? Math.round(((grand.full + grand.half * 0.5) / records) * 1000) / 10 : 0;
  grand.verifiedPct = records ? Math.round((grand.verified / records) * 100) : 0;

  var result = { bySite: bySite, byMonth: byMonth, bySiteMonth: bySiteMonth, months: months, grand: grand, sites: SITES.slice(),
                 updatedAt: Utilities.formatDate(new Date(), TZ, 'HH:mm') };
  cachePutJson_('ALLTIME_STATS', result, 300);
  return result;
}

/** Month-to-date numbers for the Admin landing screen (today's numbers come from getTodayRows). */
function getAdminOverview(token) {
  return overviewData_(requireRole_(token, ['Admin']));
}

/**
 * Month-to-date per site and per person (cached CACHE_OVERVIEW_SEC).
 *   people: [{ s, id, n, f, h, a }] — everyone with at least one marked day this month
 */
function overviewData_(user) {
  var t = todayParts_();
  var key = 'ATT_OVERVIEW_' + t.iso;
  var hit = cacheGetJson_(key);
  if (hit) return hit;

  var ss = ss_();
  var mtd = { full: 0, half: 0, absent: 0, records: 0 };
  var siteMtd = {};
  var people = [];
  var headcount = 0;

  SITES.forEach(function (site) {
    var sh = ensureYearSheet_(ss, site, t.year);
    var lastRow = sh.getLastRow();
    var sm = siteMtd[site] = { full: 0, half: 0, absent: 0, manDays: 0, attendancePct: 0, headcount: 0 };
    if (lastRow < FIRST_DATA_ROW) return;

    var nRows = lastRow - FIRST_DATA_ROW + 1;
    var idNames = sh.getRange(FIRST_DATA_ROW, 1, nRows, 2).getValues();
    var nameBg = sh.getRange(FIRST_DATA_ROW, 1, nRows, 1).getBackgrounds();
    var grid = sh.getRange(FIRST_DATA_ROW, dayCol_(t.year, t.month, 1), nRows, t.day).getValues();

    for (var r = 0; r < nRows; r++) {
      if (!idNames[r][0]) continue;
      if (!isInactiveColor_(nameBg[r][0])) { headcount++; sm.headcount++; }
      var p = { s: site, id: String(idNames[r][0]).trim(), n: String(idNames[r][1]), f: 0, h: 0, a: 0 };
      for (var d = 0; d < t.day; d++) {
        var status = statusFromCode_(grid[r][d]);
        if (status === 'Full Day') { sm.full++; p.f++; }
        else if (status === 'Half Day') { sm.half++; p.h++; }
        else if (status === 'Absent') { sm.absent++; p.a++; }
      }
      if (p.f || p.h || p.a) people.push(p);
    }
    var rec = sm.full + sm.half + sm.absent;
    sm.manDays = Math.round((sm.full + sm.half * 0.5) * 10) / 10;
    sm.attendancePct = rec ? Math.round(((sm.full + sm.half * 0.5) / rec) * 1000) / 10 : 0;

    mtd.full += sm.full; mtd.half += sm.half; mtd.absent += sm.absent;
    mtd.records += rec;
  });

  mtd.manDays = Math.round((mtd.full + mtd.half * 0.5) * 10) / 10;
  mtd.attendancePct = mtd.records ? Math.round(((mtd.full + mtd.half * 0.5) / mtd.records) * 1000) / 10 : 0;
  mtd.lostDays = Math.round((mtd.absent + mtd.half * 0.5) * 10) / 10;

  var result = {
    mtd: mtd,
    siteMtd: siteMtd,
    people: people,
    headcount: headcount,
    monthLabel: Utilities.formatDate(new Date(), TZ, 'MMMM yyyy'),
    dateLabel: Utilities.formatDate(new Date(), TZ, 'EEE, dd MMM yyyy'),
    updatedAt: Utilities.formatDate(new Date(), TZ, 'HH:mm:ss')
  };
  cachePutJson_(key, result, CACHE_OVERVIEW_SEC);
  return result;
}
