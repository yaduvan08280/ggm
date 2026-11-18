/*******************************************************
 * Attendance.gs — marking, HR approval, live KPIs.
 *
 * A day cell holds the code (FD / HD / A).
 * The cell's background holds the HR approval state:
 *   red = waiting on HR · green = approved · yellow = sent back
 * Reads go through the cached day rows (Fast.gs); writes patch that copy.
 *******************************************************/

var STATUSES = ['Full Day', 'Half Day', 'Absent'];

/** The tab + column for today, for one site. */
function todaySheet_(ss, site) {
  var t = todayParts_();
  var sh = ensureYearSheet_(ss, site, t.year);
  return { sh: sh, col: dayCol_(t.year, t.month, t.day), t: t };
}

/** One site's whole day-column: ids, names, codes, colours. */
function readDayBlock_(sh, col) {
  var last = sh.getLastRow();
  if (last < FIRST_DATA_ROW) return { n: 0, idNames: [], nameBg: [], codes: [], bg: [] };
  var n = last - FIRST_DATA_ROW + 1;
  var day = sh.getRange(FIRST_DATA_ROW, col, n, 1);
  return {
    n: n,
    idNames: sh.getRange(FIRST_DATA_ROW, 1, n, 2).getValues(),
    nameBg: sh.getRange(FIRST_DATA_ROW, 1, n, 1).getBackgrounds(),
    codes: day.getValues(),
    bg: day.getBackgrounds()
  };
}

/** Row -> { id, name, status, approval, inactive }, skipping blank rows. */
function readDayRows_(block, includeInactive) {
  var out = [];
  for (var i = 0; i < block.n; i++) {
    var id = block.idNames[i][0];
    if (id === '' || id === null) continue;
    var inactive = isInactiveColor_(block.nameBg[i][0]);
    if (inactive && !includeInactive) continue;
    out.push({
      row: FIRST_DATA_ROW + i,
      id: String(id).trim(),
      name: block.idNames[i][1],
      status: statusFromCode_(block.codes[i][0]),
      approval: approvalFromColor_(block.bg[i][0]),
      inactive: inactive
    });
  }
  return out;
}

/** Today's active rows of one site (cached). */
function activeDayRows_(site) {
  return dayRows_(site).filter(function (r) { return !r.inactive; });
}

/* ---------------- SUPERVISOR ---------------- */

function getSupervisorEmployees(token) {
  return supervisorData_(requireRole_(token, ['Supervisor']));
}

function supervisorData_(user) {
  var gate = isSubmissionWindowOpen_(user.site);
  var ss = ss_();
  // one site can have several supervisors — each only ever sees their own people
  var mine = employeesForSupervisor_(ss, user.site, user.username);
  var desig = {};
  getEmployeesForSite_(ss, user.site).forEach(function (e) { desig[e.id] = e.designation; });

  var counts = { full: 0, half: 0, absent: 0, unmarked: 0 };
  var unassigned = 0, byMe = markedByMe_(user.username);
  var employees = [];
  var add = function (r, extra) {
    var sentBack = r.approval === APPROVAL_SENTBACK;
    if (r.status === 'Full Day') counts.full++;
    else if (r.status === 'Half Day') counts.half++;
    else if (r.status === 'Absent') counts.absent++;
    else counts.unmarked++;
    employees.push(Object.assign({
      id: r.id,
      name: r.name,
      designation: desig[r.id] || '',
      status: r.status,
      approval: r.approval,
      sentBack: sentBack,
      unassigned: false,
      byMe: !!byMe[r.id] && !!r.status,
      locked: !!r.status && !(sentBack && gate.allowResubmit)
    }, extra));
  };

  activeDayRows_(user.site).forEach(function (r) {
    var owned = mine[r.id];
    if (!owned) return;
    if (owned === 'unassigned') unassigned++;
    add(r, { unassigned: owned === 'unassigned' });
  });

  // people whose secondary site is this one: every supervisor here can mark them,
  // the mark goes on their main site's sheet (home)
  var byHome = {};
  visitorsAt_(user.site).forEach(function (e) {
    var rows = byHome[e.site] = byHome[e.site] || activeDayRows_(e.site);
    var r = rows.filter(function (x) { return x.id === e.id; })[0];
    if (!r) return;
    desig[r.id] = e.designation;
    add(r, { home: e.site });
  });

  var done = counts.full + counts.half + counts.absent;
  return {
    site: user.site,
    windowOpen: gate.open,
    closingTime: gate.closingTime,
    minutesLeft: gate.minutesLeft,
    total: employees.length,
    done: done,
    counts: counts,
    unassigned: unassigned,
    nextId: nextEmployeeId_(user.site),
    dateLabel: Utilities.formatDate(new Date(), TZ, 'EEE, dd MMM yyyy'),
    updatedAt: Utilities.formatDate(new Date(), TZ, 'HH:mm:ss'),
    employees: employees
  };
}

/**
 * Marks one employee for today. Once only — unless HR sent it back
 * and the site allows a redo. LockService serialises concurrent taps.
 */
function submitAttendance(token, employeeId, status) {
  var user = requireRole_(token, ['Supervisor']);
  var gate = isSubmissionWindowOpen_(user.site);
  if (!gate.open) {
    return { ok: false, error: 'Attendance closed at ' + gate.closingTime + ' for today.' };
  }
  if (STATUSES.indexOf(status) === -1) return { ok: false, error: 'Pick Full Day, Half Day or Absent.' };

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (e) {
    return { ok: false, error: 'Server is busy. Tap again in a second.' };
  }

  try {
    var ss = ss_();
    var id = String(employeeId).trim();
    // the sheet the mark goes on: this site's, or the main site of someone staying here
    var site = user.site;
    if (!employeesForSupervisor_(ss, user.site, user.username)[id]) {
      var visitor = visitorsAt_(user.site).filter(function (e) { return e.id === id; })[0];
      if (!visitor) return { ok: false, error: 'This employee is on another supervisor\'s list.' };
      site = visitor.site;
    }
    var ctx = todaySheet_(ss, site);
    var row = rowOf_(ctx.sh, site, id);
    if (!row) return { ok: false, error: 'This employee is not on this year\'s sheet.' };

    var cells = ctx.sh.getRange(row, 1, 1, 2);
    if (isInactiveColor_(cells.getBackgrounds()[0][0])) {
      return { ok: false, error: 'This employee is switched off. Ask HR to reactivate them.' };
    }
    var cell = ctx.sh.getRange(row, ctx.col);
    var existing = statusFromCode_(cell.getValue());
    var sentBack = approvalFromColor_(cell.getBackground()) === APPROVAL_SENTBACK;

    if (existing && !(sentBack && gate.allowResubmit)) {
      patchDay_(site, id, existing, sentBack ? APPROVAL_SENTBACK : approvalFromColor_(cell.getBackground()));
      return { ok: false, error: 'Already marked ' + existing + ' today. Ask HR to reopen it.' };
    }

    cell.setValue(codeFromStatus_(status)).setBackground(CLR_PENDING);
    SpreadsheetApp.flush();
    patchDay_(site, id, status, APPROVAL_PENDING);
    patchRecord_(site, id, existing, status);
    addMarkedByMe_(user.username, id);

    logAudit_({
      site: site, date: ctx.t.iso, employeeId: id, employeeName: cells.getValues()[0][1],
      action: existing ? 'RESUBMIT' : 'MARK', value: status,
      byUser: user.username, byRole: user.role
    });

    return { ok: true, status: status };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  } finally {
    lock.releaseLock();
  }
}

/* ---------------- who marked whom today ("Marked by me") ---------------- */

function markedByKey_(username) { return 'ATT_BY_' + todayParts_().iso + '_' + String(username).toLowerCase(); }

/**
 * { employeeId: true } for everyone this supervisor marked today. Kept in a script property
 * per supervisor per day; the first read of a day builds it from today's AuditLog rows, so
 * marks made before this existed (or if the property is lost) still count.
 */
function markedByMe_(username) {
  var props = PropertiesService.getScriptProperties(), key = markedByKey_(username), raw = props.getProperty(key);
  if (raw === null) {
    raw = markedByFromAudit_(username).join(',');
    try { props.setProperty(key, raw); } catch (e) {}
  }
  var out = {};
  raw.split(',').forEach(function (id) { if (id) out[id] = true; });
  return out;
}

function addMarkedByMe_(username, id) {
  try {
    var have = markedByMe_(username);
    if (have[id]) return;
    var ids = Object.keys(have).concat([id]).join(',');
    if (ids.length < 8500) PropertiesService.getScriptProperties().setProperty(markedByKey_(username), ids);
  } catch (e) { /* the filter is a convenience: never block a mark */ }
}

/** Today's MARK / RESUBMIT rows by this user, from the bottom of the AuditLog. */
function markedByFromAudit_(username) {
  var sh = ss_().getSheetByName(SHEET_AUDIT);
  if (!sh || sh.getLastRow() < 2) return [];
  var t = todayParts_(), u = String(username).toLowerCase(), last = sh.getLastRow(), n = Math.min(last - 1, 4000);
  var rows = sh.getRange(last - n + 1, 1, n, 9).getValues(), out = [];
  for (var i = rows.length - 1; i >= 0; i--) {
    var r = rows[i], when = r[0] instanceof Date ? Utilities.formatDate(r[0], TZ, 'yyyy-MM-dd') : '';
    if (when && when < t.iso) break;
    var day = r[2] instanceof Date ? Utilities.formatDate(r[2], TZ, 'yyyy-MM-dd') : String(r[2]);
    if (day !== t.iso || String(r[7]).toLowerCase() !== u) continue;
    if (r[5] === 'MARK' || r[5] === 'RESUBMIT') out.push(String(r[3]).trim());
  }
  return out;
}

/* ---------------- HR / ADMIN — today ---------------- */

/**
 * Everyone in scope with today's state, in one go. The page works out every KPI,
 * list and filter from this, so switching tiles, sites and filters costs nothing.
 *   rows: [{ s: site, id, n: name, st: status|'', ap: approval, sup: supervisor }]
 */
function getTodayRows(token, site) {
  return todayData_(requireRole_(token, ['HR', 'Admin']), site);
}

function todayData_(user, site) {
  var sites = resolveSite_(user, site);
  var ss = ss_();
  var rows = [], info = [];
  sites.forEach(function (s) {
    var gate = isSubmissionWindowOpen_(s);
    info.push({ site: s, closingTime: gate.closingTime, windowOpen: gate.open, allowResubmit: gate.allowResubmit });
    var sup = supervisorMapForSite_(ss, s);
    activeDayRows_(s).forEach(function (r) {
      rows.push({ s: s, id: r.id, n: r.name, st: r.status || '', ap: r.approval, sup: sup[r.id] || '' });
    });
  });
  return {
    scope: sites,
    sites: info,
    rows: rows,
    dateLabel: Utilities.formatDate(new Date(), TZ, 'EEE, dd MMM yyyy'),
    updatedAt: Utilities.formatDate(new Date(), TZ, 'HH:mm:ss')
  };
}

/** site may be a specific site or 'ALL'. Returns per-site rows plus a combined total. */
function getKpis(token, site) {
  var d = todayData_(requireRole_(token, ['HR', 'Admin']), site);
  var keys = ['total', 'filled', 'pending', 'full', 'half', 'absent', 'verified', 'sentBack', 'unverified'];
  var combined = {}, bySite = {};
  keys.forEach(function (k) { combined[k] = 0; });
  d.sites.forEach(function (s) {
    bySite[s.site] = { site: s.site, closingTime: s.closingTime, windowOpen: s.windowOpen };
    keys.forEach(function (k) { bySite[s.site][k] = 0; });
  });
  d.rows.forEach(function (r) {
    var row = bySite[r.s];
    row.total++;
    if (!r.st) return;
    row.filled++;
    if (r.st === 'Full Day') row.full++; else if (r.st === 'Half Day') row.half++; else row.absent++;
    if (r.ap === APPROVAL_APPROVED) row.verified++;
    else if (r.ap === APPROVAL_SENTBACK) row.sentBack++;
    else row.unverified++;
  });
  var perSite = d.sites.map(function (s) {
    var row = bySite[s.site];
    row.pending = row.total - row.filled;
    row.attendancePct = row.total ? Math.round(((row.full + row.half * 0.5) / row.total) * 1000) / 10 : 0;
    keys.forEach(function (k) { combined[k] += row[k]; });
    return row;
  });
  combined.attendancePct = combined.total ? Math.round(((combined.full + combined.half * 0.5) / combined.total) * 1000) / 10 : 0;
  combined.completionPct = combined.total ? Math.round((combined.filled / combined.total) * 100) : 0;
  return { scope: d.scope, perSite: perSite, totals: combined, dateLabel: d.dateLabel, updatedAt: d.updatedAt };
}

/** Today's marked records for HR to approve or send back. */
function getFilledList(token, site, filter) {
  var d = todayData_(requireRole_(token, ['HR', 'Admin']), site);
  return d.rows.filter(function (r) {
    if (!r.st) return false;
    if (filter === 'pending' && r.ap !== APPROVAL_PENDING && r.ap !== APPROVAL_MISMATCH) return false;
    if (filter === 'sentback' && r.ap !== APPROVAL_SENTBACK) return false;
    return true;
  }).map(function (r) { return { site: r.s, id: r.id, name: r.n, supervisor: r.sup, status: r.st, approval: r.ap }; });
}

/** Employees with nothing marked today — HR chases these. */
function getUnmarkedList(token, site) {
  var d = todayData_(requireRole_(token, ['HR', 'Admin']), site);
  return d.rows.filter(function (r) { return !r.st; })
    .map(function (r) { return { site: r.s, id: r.id, name: r.n, supervisor: r.sup }; });
}

function decisionColor_(decision) {
  if (decision === APPROVAL_APPROVED || decision === 'Correct') return CLR_APPROVED;
  if (decision === APPROVAL_SENTBACK || decision === 'Incorrect') return CLR_SENTBACK;
  return null;
}

/** decision: 'Approved' (green) or 'SentBack' (yellow). */
function verifyRecord(token, site, employeeId, decision) {
  var user = requireRole_(token, ['HR', 'Admin']);
  var color = decisionColor_(decision);
  if (!color) return { ok: false, error: 'Invalid decision' };
  var sites = resolveSite_(user, site);
  if (sites.length !== 1) return { ok: false, error: 'Pick a single site first.' };

  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) { return { ok: false, error: 'Server busy, try again.' }; }

  try {
    var ss = ss_();
    var ctx = todaySheet_(ss, sites[0]);
    var row = rowOf_(ctx.sh, sites[0], employeeId);
    if (!row) return { ok: false, error: 'Employee not found.' };
    var cell = ctx.sh.getRange(row, ctx.col);
    var status = statusFromCode_(cell.getValue());
    if (!status) return { ok: false, error: 'Nothing is marked for this person today.' };
    cell.setBackground(color);
    SpreadsheetApp.flush();
    patchDay_(sites[0], employeeId, status, color === CLR_APPROVED ? APPROVAL_APPROVED : APPROVAL_SENTBACK);
    logAudit_({
      site: sites[0], date: ctx.t.iso, employeeId: employeeId,
      employeeName: ctx.sh.getRange(row, 2).getValue(),
      action: 'VERIFY', value: color === CLR_APPROVED ? 'Approved' : 'Sent back',
      byUser: user.username, byRole: user.role
    });
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/** Approve everything still waiting at a site — one write, not one per row.
 *  Purple (punches do not fit) is left for HR to look at one by one. */
function verifyAllPending(token, site) {
  var user = requireRole_(token, ['HR', 'Admin']);
  var sites = resolveSite_(user, site);
  if (sites.length !== 1) return { ok: false, error: 'Pick a single site first.' };

  var lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch (e) { return { ok: false, error: 'Server busy, try again.' }; }

  try {
    var ss = ss_();
    var ctx = todaySheet_(ss, sites[0]);
    var block = readDayBlock_(ctx.sh, ctx.col);
    if (!block.n) return { ok: true, count: 0, left: 0 };

    var bg = [];
    var count = 0, left = 0;
    for (var i = 0; i < block.n; i++) {
      var has = !!statusFromCode_(block.codes[i][0]);
      var state = approvalFromColor_(block.bg[i][0]);
      var inactive = isInactiveColor_(block.nameBg[i][0]);
      if (has && !inactive && state === APPROVAL_PENDING) { bg.push([CLR_APPROVED]); count++; }
      else { bg.push([block.bg[i][0]]); if (has && !inactive && state === APPROVAL_MISMATCH) left++; }
    }
    if (count) {
      ctx.sh.getRange(FIRST_DATA_ROW, ctx.col, block.n, 1).setBackgrounds(bg);
      SpreadsheetApp.flush();
    }
    dropDay_(sites[0]);
    logAudit_({
      site: sites[0], date: ctx.t.iso, action: 'VERIFY_ALL', value: String(count),
      byUser: user.username, byRole: user.role
    });
    return { ok: true, count: count, left: left };
  } finally {
    lock.releaseLock();
  }
}

/**
 * HR override — set or clear a status directly, for the cases where a
 * supervisor marked the wrong thing or the day has already closed.
 * Anything HR sets is approved by definition, so it goes green.
 */
function hrSetAttendance(token, site, employeeId, status) {
  var user = requireRole_(token, ['HR', 'Admin']);
  var sites = resolveSite_(user, site);
  if (sites.length !== 1) return { ok: false, error: 'Pick a single site first.' };
  if (status !== '' && STATUSES.indexOf(status) === -1) return { ok: false, error: 'Invalid status.' };

  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) { return { ok: false, error: 'Server busy, try again.' }; }

  try {
    var ss = ss_();
    var ctx = todaySheet_(ss, sites[0]);
    var row = rowOf_(ctx.sh, sites[0], employeeId);
    if (!row) return { ok: false, error: 'Employee not found.' };

    var cell = ctx.sh.getRange(row, ctx.col);
    var before = statusFromCode_(cell.getValue());
    cell.setValue(status ? codeFromStatus_(status) : '')
      .setBackground(status ? CLR_APPROVED : CLR_PENDING);
    if (String(cell.getNote() || '').indexOf(AUTO_ABSENT_NOTE) === 0) cell.setNote('');
    SpreadsheetApp.flush();
    patchDay_(sites[0], employeeId, status || null, status ? APPROVAL_APPROVED : APPROVAL_PENDING);
    patchRecord_(sites[0], employeeId, before, status || null);
    logAudit_({
      site: sites[0], date: ctx.t.iso, employeeId: employeeId,
      employeeName: ctx.sh.getRange(row, 2).getValue(),
      action: 'HR_OVERRIDE', value: status || 'CLEARED',
      byUser: user.username, byRole: user.role
    });
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/* ---------------- the Record tab: everyone's month, one row each ---------------- */

/**
 * Month totals per person for one site or all sites in scope.
 *   rows: [{ s: site, id, n: name, f: full, h: half, a: absent, u: not marked (days gone by), off }]
 */
function getMonthRecord(token, site, year, month) {
  var user = requireRole_(token, ['HR', 'Admin']);
  var sites = resolveSite_(user, site);
  var t = todayParts_();
  year = Number(year) || t.year; month = Number(month) || t.month;
  if (year > t.year || (year === t.year && month > t.month)) return { ok: false, error: 'That month has not started yet.' };
  var rows = [];
  sites.forEach(function (s) { rows = rows.concat(siteMonthRows_(s, year, month)); });
  var current = year === t.year && month === t.month;
  return {
    ok: true, year: year, month: month, sites: sites, rows: rows,
    label: Utilities.formatDate(new Date(year, month - 1, 1), TZ, 'MMMM yyyy'),
    daysCounted: current ? t.day : daysInMonth_(year, month), current: current,
    updatedAt: Utilities.formatDate(new Date(), TZ, 'dd MMM yyyy, HH:mm')
  };
}

/** One site's month, cached: this month 5 minutes (warmCaches keeps it fresh), past months 6 hours. */
function siteMonthRows_(site, year, month) {
  var t = todayParts_(), current = year === t.year && month === t.month;
  var key = 'ATT_REC_' + site + '_' + year + '_' + month;
  var hit = cacheGetJson_(key);
  if (hit) return hit;
  var out = [];
  var sh = ss_().getSheetByName(yearTabName_(site, year));
  if (sh && sh.getLastRow() >= FIRST_DATA_ROW) {
    var n = sh.getLastRow() - FIRST_DATA_ROW + 1, len = daysInMonth_(year, month);
    var upTo = current ? t.day : len;
    var idNames = sh.getRange(FIRST_DATA_ROW, 1, n, 2).getValues();
    var nameBg = sh.getRange(FIRST_DATA_ROW, 1, n, 1).getBackgrounds();
    var grid = sh.getRange(FIRST_DATA_ROW, dayCol_(year, month, 1), n, len).getValues();
    for (var r = 0; r < n; r++) {
      if (idNames[r][0] === '' || idNames[r][0] === null) continue;
      var p = { s: site, id: String(idNames[r][0]).trim(), n: String(idNames[r][1]), f: 0, h: 0, a: 0, u: 0, off: isInactiveColor_(nameBg[r][0]) };
      for (var d = 0; d < len; d++) {
        var st = statusFromCode_(grid[r][d]);
        if (st === 'Full Day') p.f++; else if (st === 'Half Day') p.h++; else if (st === 'Absent') p.a++;
      }
      p.u = p.off ? 0 : Math.max(0, upTo - p.f - p.h - p.a);
      out.push(p);
    }
  }
  cachePutJson_(key, out, current ? 300 : 21600);
  return out;
}

/* ---------------- one employee's month ---------------- */

/**
 * One person's attendance for a month: one row read from the site tab.
 * month: 1-12 (default this month). Supervisors may look at their own site only.
 */
function getEmployeeMonth(token, site, employeeId, year, month) {
  var user = requireSession_(token);
  var sites = resolveSite_(user, site);
  if (sites.length !== 1) return { ok: false, error: 'Pick a single site first.' };
  var t = todayParts_();
  year = Number(year) || t.year; month = Number(month) || t.month;
  var sh = ss_().getSheetByName(yearTabName_(sites[0], year));
  if (!sh) return { ok: false, error: 'No ' + year + ' sheet for ' + sites[0] + '.' };
  var row = empRowMap_(sh)[String(employeeId).trim()];
  if (!row) return { ok: false, error: 'Not on the ' + year + ' sheet.' };

  var len = daysInMonth_(year, month);
  var rng = sh.getRange(row, dayCol_(year, month, 1), 1, len);
  var vals = rng.getValues()[0], bgs = rng.getBackgrounds()[0];
  var days = [], c = { full: 0, half: 0, absent: 0, approved: 0, sentBack: 0, unmarked: 0 };
  var upTo = (year === t.year && month === t.month) ? t.day : (year > t.year || (year === t.year && month > t.month) ? 0 : len);
  for (var d = 0; d < len; d++) {
    var st = statusFromCode_(vals[d]) || '', ap = st ? approvalFromColor_(bgs[d]) : '';
    if (st === 'Full Day') c.full++; else if (st === 'Half Day') c.half++; else if (st === 'Absent') c.absent++;
    else if (d < upTo) c.unmarked++;
    if (ap === APPROVAL_APPROVED) c.approved++; else if (ap === APPROVAL_SENTBACK) c.sentBack++;
    days.push({ d: d + 1, st: st, ap: ap, dow: new Date(year, month - 1, d + 1).getDay(), future: d >= upTo });
  }
  return {
    ok: true, site: sites[0], id: String(employeeId).trim(), name: sh.getRange(row, 2).getValue(),
    year: year, month: month, label: Utilities.formatDate(new Date(year, month - 1, 1), TZ, 'MMMM yyyy'),
    days: days, counts: c, manDays: c.full + c.half * 0.5
  };
}

/* ---------------- auto Absent at closing time ---------------- */

var AUTO_ABSENT_NOTE = 'Auto-marked Absent';

/**
 * warmCaches (every 5 minutes): once a site's closing time has passed, everyone active there
 * who is still not marked today is marked Absent - light red (waiting for HR) with a note.
 * Once a day per site, also on a day when nobody there was marked (13 Nov 2026: no day counts as
 * a holiday). Only a site whose rule is switched off (Settings H) is left alone.
 */
function autoAbsent_() {
  var t = todayParts_(), props = PropertiesService.getScriptProperties(), done = [];
  SITES.forEach(function (site) {
    var key = 'ATT_AUTOABS2_' + site;   // 2: the no-holiday rule (re-runs the day it went live)
    if (props.getProperty(key) === t.iso) return;
    var cfg = getSiteSetting_(site), gate = isSubmissionWindowOpen_(site);
    if (gate.open) return;
    if (!cfg.autoAbsent) { props.setProperty(key, t.iso); return; }
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) return;   // next run tries again
    try {
      var ss = ss_(), ctx = todaySheet_(ss, site), block = readDayBlock_(ctx.sh, ctx.col);
      var add = [];
      for (var i = 0; i < block.n; i++) {
        var id = block.idNames[i][0];
        if (id === '' || id === null || isInactiveColor_(block.nameBg[i][0])) continue;
        if (!statusFromCode_(block.codes[i][0]) && !isInactiveColor_(block.bg[i][0])) add.push(i);
      }
      if (!add.length) { props.setProperty(key, t.iso); return; }
      var rng = ctx.sh.getRange(FIRST_DATA_ROW, ctx.col, block.n, 1);
      var codes = block.codes.map(function (r) { return [r[0]]; }), bgs = block.bg.map(function (r) { return [r[0]]; }), notes = rng.getNotes();
      var note = AUTO_ABSENT_NOTE + ': not marked by ' + gate.closingTime + ' on ' + Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy');
      add.forEach(function (i) { codes[i][0] = CODE_ABSENT; bgs[i][0] = CLR_PENDING; notes[i][0] = note; });
      rng.setValues(codes);
      rng.setBackgrounds(bgs);
      rng.setNotes(notes);
      SpreadsheetApp.flush();
      dropDay_(site);
      cacheDrop_('ATT_REC_' + site + '_' + t.year + '_' + t.month);
      props.setProperty(key, t.iso);
      logAudit_({ site: site, date: t.iso, action: 'AUTO_ABSENT', value: add.length + ' marked Absent at ' + gate.closingTime, byUser: 'system', byRole: 'system' });
      done.push(site + ' ' + add.length);
    } finally {
      lock.releaseLock();
    }
  });
  return done;
}

/* ---------------- one-off: past empty days -> Absent ---------------- */

var BACKFILL_FROM = '2026-10-01';   // 13 Nov 2026: "fill all previous blanks till October with Absent"

/**
 * Runs once (from warmCaches): every empty day from BACKFILL_FROM to yesterday becomes Absent,
 * light red (waiting for HR) with a note, the same as the 3 PM auto Absent - also days when nobody at
 * the site was marked (no holidays). Left alone: switched-off people, grey cells, and sites whose
 * auto Absent rule is off (Site rules). An empty purple day (the punch report shows punches) gets A too but
 * stays purple, and its note says "Marked: Absent".
 */
function backfillAbsentOnce_() {
  var props = PropertiesService.getScriptProperties(), key = 'ATT_BACKFILL2_' + BACKFILL_FROM;   // 2: second pass, holidays filled too
  if (props.getProperty(key)) return null;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return null;
  try {
    if (props.getProperty(key)) return null;
    var out = backfillAbsent_(BACKFILL_FROM);
    props.setProperty(key, todayParts_().iso);
    return out;
  } finally {
    lock.releaseLock();
  }
}

function backfillAbsent_(fromIso) {
  var t = todayParts_(), f = fromIso.split('-').map(Number);
  if (f[0] !== t.year) throw new Error('backfill stays inside one year');
  var lo = dayOfYear_(f[0], f[1], f[2]), hi = t.doy - 1, out = [];
  if (hi < lo) return out;
  var stamp = Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy');
  var note = AUTO_ABSENT_NOTE + ': day left empty, filled in on ' + stamp;
  var ss = ss_();
  SITES.forEach(function (site) {
    var sh = ss.getSheetByName(yearTabName_(site, t.year));
    if (!sh || !getSiteSetting_(site).autoAbsent) return;
    var last = sh.getLastRow();
    if (last < FIRST_DATA_ROW) return;
    var n = last - FIRST_DATA_ROW + 1, w = hi - lo + 1;
    var ids = sh.getRange(FIRST_DATA_ROW, 1, n, 1).getValues(), nameBg = sh.getRange(FIRST_DATA_ROW, 1, n, 1).getBackgrounds();
    var rng = sh.getRange(FIRST_DATA_ROW, FIRST_DAY_COL + lo - 1, n, w);
    var vals = rng.getValues(), bgs = rng.getBackgrounds(), notes = rng.getNotes();
    var filled = 0, purple = 0, months = {};
    for (var c = 0; c < w; c++) {
      var add = [];
      for (var r = 0; r < n; r++) {
        if (ids[r][0] === '' || ids[r][0] === null || isInactiveColor_(nameBg[r][0])) continue;
        if (String(vals[r][c]).trim() === '' && !isInactiveColor_(bgs[r][c])) add.push(r);
      }
      var md = fromDayOfYear_(t.year, lo + c);
      if (!add.length) continue;
      add.forEach(function (r) {
        vals[r][c] = CODE_ABSENT;
        if (String(bgs[r][c]).toLowerCase() === CLR_MISMATCH) {
          notes[r][c] = String(notes[r][c] || '').replace('Marked: nothing', 'Marked: Absent');
          purple++;
        } else {
          bgs[r][c] = CLR_PENDING;
          notes[r][c] = note;
        }
      });
      filled += add.length;
      months[md.month] = 1;
      cacheDrop_(dayKey_(site, t.year + '-' + ('0' + md.month).slice(-2) + '-' + ('0' + md.day).slice(-2)));
    }
    if (filled) {
      rng.setValues(vals);
      rng.setBackgrounds(bgs);
      rng.setNotes(notes);
      SpreadsheetApp.flush();
      Object.keys(months).forEach(function (m) { cacheDrop_('ATT_REC_' + site + '_' + t.year + '_' + m); });
    }
    var msg = filled + ' empty days marked Absent (' + purple + ' of them purple: punched) from ' + fromIso + ', days nobody was marked included';
    if (filled) logAudit_({ site: site, date: t.iso, action: 'BACKFILL_ABSENT', value: msg, byUser: 'system', byRole: 'system' });
    out.push(site + ': ' + msg);
  });
  return out;
}
