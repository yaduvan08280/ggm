/*******************************************************
 * SheetSetup.gs
 * Run setupEverything() ONCE after pasting all files in.
 * Builds Employees / Settings / AuditLog plus this
 * year's attendance tab for each site.
 *******************************************************/

function setupEverything() {
  var ss = ss_();
  setupEmployeesSheet_(ss);
  setupSettingsSheet_(ss);
  setupAuditSheet_(ss);

  ensureSettingsRows_(ss);
  refreshSiteDropdowns_(ss);

  var t = todayParts_();
  SITES.forEach(function (site) {
    ensureYearSheet_(ss, site, t.year);
  });

  installTriggers();

  SpreadsheetApp.getUi().alert(
    'Setup complete.\n\n' +
    'Created: Employees, Users, Settings, AuditLog, and the ' + t.year +
    ' attendance tab for all ' + SITES.length + ' sites.\n\n' +
    'Seed admin login — username: admin, password: ChangeMe123\n' +
    'Change it the first time you sign in.\n\n' +
    'Next: add employees, then Deploy > New deployment > Web app.'
  );
}

function setupEmployeesSheet_(ss) {
  var sh = ss.getSheetByName(SHEET_EMPLOYEES);
  if (sh) return sh;
  sh = ss.insertSheet(SHEET_EMPLOYEES);
  sh.appendRow(['Employee ID', 'Name', 'Site', 'Supervisor', 'Designation', 'Active']);
  styleHeader_(sh, EMP_COL_COUNT);
  sh.setFrozenRows(1);
  sh.getRange(empColA1_(EMP_COL_ACTIVE)).insertCheckboxes();
  var siteRule = SpreadsheetApp.newDataValidation().requireValueInList(SITES, true).build();
  sh.getRange(empColA1_(EMP_COL_SITE)).setDataValidation(siteRule);
  sh.setColumnWidths(1, EMP_COL_COUNT, 150);
  sh.setColumnWidth(EMP_COL_SUPERVISOR, 170);
  refreshSupervisorDropdown_(ss);
  return sh;
}

function setupSettingsSheet_(ss) {
  var sh = ss.getSheetByName(SHEET_SETTINGS);
  if (sh) return sh;
  sh = ss.insertSheet(SHEET_SETTINGS);
  sh.appendRow(['Site', 'Closing Time (HH:MM)', 'Refresh (seconds)', 'Lock Login After Close', 'Allow Redo If Sent Back']);
  styleHeader_(sh, 5);
  sh.setFrozenRows(1);
  SITES.forEach(function (site) {
    sh.appendRow([site, DEFAULT_CLOSING_TIME, DEFAULT_REFRESH_SEC, DEFAULT_LOCK_LOGIN, DEFAULT_ALLOW_RESUBMIT]);
  });
  sh.getRange(2, 2, SITES.length, 1).setNumberFormat('@'); // keep 15:00 as text, not a time value
  sh.getRange(2, 4, SITES.length, 2).insertCheckboxes();
  sh.getRange(2, 4, SITES.length, 1).setValue(DEFAULT_LOCK_LOGIN);
  sh.getRange(2, 5, SITES.length, 1).setValue(DEFAULT_ALLOW_RESUBMIT);
  sh.setColumnWidths(1, 5, 190);
  return sh;
}

/**
 * Run this once from the editor after adding a site to SITES in Config.gs.
 * Gives it a Settings row, puts it in the site dropdowns on the Employees and
 * tab, and builds this year's attendance tab for it.
 */
function syncSites() {
  var ss = ss_();
  var added = ensureSettingsRows_(ss);
  refreshSiteDropdowns_(ss);
  refreshSupervisorDropdown_(ss);

  var t = todayParts_();
  var built = [];
  SITES.forEach(function (site) {
    var name = yearTabName_(site, t.year);
    var existed = !!ss.getSheetByName(name);
    ensureYearSheet_(ss, site, t.year);
    if (!existed) built.push(name);
  });

  var msg = 'Sites in sync.\n\n' +
    'Sites: ' + SITES.join(', ') + '\n' +
    'Settings rows added: ' + (added.length ? added.join(', ') : 'none') + '\n' +
    'Tabs built: ' + (built.length ? built.join(', ') : 'none');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* no UI when run headless */ }
  return msg;
}

/** Every site in SITES gets a Settings row, with the defaults if it is new. */
function ensureSettingsRows_(ss) {
  var sh = ss.getSheetByName(SHEET_SETTINGS);
  if (!sh) return [];
  var have = {};
  var last = sh.getLastRow();
  if (last >= 2) {
    sh.getRange(2, 1, last - 1, 1).getValues().forEach(function (r) {
      if (r[0]) have[String(r[0]).trim()] = true;
    });
  }
  var added = [];
  SITES.forEach(function (site) {
    if (have[site]) return;
    var row = sh.getLastRow() + 1;
    sh.getRange(row, 1, 1, 5).setValues([[site, DEFAULT_CLOSING_TIME, DEFAULT_REFRESH_SEC, DEFAULT_LOCK_LOGIN, DEFAULT_ALLOW_RESUBMIT]]);
    sh.getRange(row, 2).setNumberFormat('@').setValue(DEFAULT_CLOSING_TIME);
    sh.getRange(row, 4, 1, 2).insertCheckboxes();
    sh.getRange(row, 4).setValue(DEFAULT_LOCK_LOGIN);
    sh.getRange(row, 5).setValue(DEFAULT_ALLOW_RESUBMIT);
    added.push(site);
  });
  return added;
}

/** "D2:D2000" for an Employees column. A1 notation grows the grid; numeric ranges don't. */
function empColA1_(col) {
  var L = colLetter_(col);
  return L + '2:' + L + '2000';
}

/**
 * Active supervisors, lower-cased key + display list: the GGM Portal people with the
 * Supervisor role and a site (the "Portal Users ATTENDANCE" tab).
 */
function listSupervisors_(ss, useCache) {
  if (useCache) {
    var hit = cacheGetJson_('SUPERVISORS');
    if (hit) return hit;
  }
  var out = [];
  try {
    var rows = ggmRows_();
    Object.keys(rows).forEach(function (k) {
      var p = rows[k];
      if (normRole_(p.role) !== 'Supervisor' || !p.site) return;
      out.push({ username: p.username, key: k, name: p.name || p.username, site: p.site, portal: true });
    });
  } catch (e) { /* not linked to GGM Portal yet */ }
  out.sort(function (a, b) { return (a.site + a.username).localeCompare(b.site + b.username); });
  cachePutJson_('SUPERVISORS', out, 300);
  return out;
}

/** Puts every supervisor username in the Employees tab's Supervisor dropdown. */
function refreshSupervisorDropdown_(ss) {
  var sh = ss.getSheetByName(SHEET_EMPLOYEES);
  if (!sh) return [];
  cacheDrop_('SUPERVISORS');
  var sups = listSupervisors_(ss, false);
  var rng = sh.getRange(empColA1_(EMP_COL_SUPERVISOR));
  if (!sups.length) { rng.clearDataValidations(); return []; }
  rng.setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(sups.map(function (s) { return s.username; }), true)
      .setAllowInvalid(true)   // a warning, not a hard block, if a name goes stale
      .setHelpText('Leave blank and every supervisor at this site will see the employee.')
      .build());
  return sups;
}

/**
 * warmCaches, every 5 minutes: the hub writes Portal Users without this script hearing of it,
 * so the dropdown is compared with that tab here and only rewritten when the list changed.
 * An empty list is left alone: it means the tab could not be read, not that nobody works here.
 */
function syncSupervisorDropdown_() {
  var ss = ss_();
  var list = listSupervisors_(ss, false).map(function (s) { return s.username; }).join('\n');
  var props = PropertiesService.getScriptProperties();
  if (!list || props.getProperty('ATT_SUP_LIST') === list) return;
  refreshSupervisorDropdown_(ss);
  props.setProperty('ATT_SUP_LIST', list);
}

/** Rebuilds the site dropdowns so a newly added site is selectable. */
function refreshSiteDropdowns_(ss) {
  var emp = ss.getSheetByName(SHEET_EMPLOYEES);
  if (emp) {
    emp.getRange(empColA1_(EMP_COL_SITE)).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(SITES, true).build());
  }
}

function setupAuditSheet_(ss) {
  var sh = ss.getSheetByName(SHEET_AUDIT);
  if (sh) return sh;
  sh = ss.insertSheet(SHEET_AUDIT);
  sh.appendRow(['Timestamp', 'Site', 'Date', 'Employee ID', 'Employee Name', 'Action', 'Value', 'By User', 'Role']);
  styleHeader_(sh, 9);
  sh.setFrozenRows(1);
  sh.setColumnWidths(1, 9, 140);
  return sh;
}

function styleHeader_(sh, numCols) {
  sh.getRange(1, 1, 1, numCols)
    .setFontWeight('bold')
    .setBackground(CLR_HEADER_DARK)
    .setFontColor('#FFFFFF')
    .setVerticalAlignment('middle');
  sh.setRowHeight(1, 34);
}

/*******************************************************
 * Yearly attendance tab
 *
 *  Row 1 |  A: Employee ID | B: Name |<--- January --->|<--- February ...
 *  Row 2 |                           | 1 Th | 2 Fr ... | 1 Su | ...
 *  Row 3 |  EMP001         | Ramesh  |  FD  |  A   ... |  HD  | ...
 *
 * The value is the code. The colour is the HR approval state.
 *******************************************************/

/** The one entry point everything else uses. Cheap when nothing has changed. */
function ensureYearSheet_(ss, site, year) {
  var name = yearTabName_(site, year);
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = buildYearSheet_(ss, site, year);
  } else {
    syncRoster_(ss, sh, site, year, false);
    paintElapsedDays_(sh, year);
  }
  return sh;
}

function buildYearSheet_(ss, site, year) {
  var sh = ss.insertSheet(yearTabName_(site, year));
  var days = daysInYear_(year);
  var totalCols = 2 + days;

  if (sh.getMaxColumns() < totalCols) {
    sh.insertColumnsAfter(sh.getMaxColumns(), totalCols - sh.getMaxColumns());
  } else if (sh.getMaxColumns() > totalCols) {
    sh.deleteColumns(totalCols + 1, sh.getMaxColumns() - totalCols);
  }

  var mo = monthOffsets_(year);
  var row1 = ['Employee ID', 'Name'];
  var row2 = ['', ''];
  var bg1 = [CLR_HEADER_DARK, CLR_HEADER_DARK];
  var bg2 = [CLR_HEADER_DARK, CLR_HEADER_DARK];

  for (var doy = 1; doy <= days; doy++) {
    var p = fromDayOfYear_(year, doy);
    var dt = new Date(year, p.month - 1, p.day);
    var isMonthStart = (p.day === 1);
    row1.push(isMonthStart ? Utilities.formatDate(dt, TZ, 'MMMM') : '');
    row2.push(Utilities.formatDate(dt, TZ, 'd\nEEE'));
    bg1.push(p.month % 2 === 1 ? CLR_MONTH_A : CLR_MONTH_B);
    bg2.push(dt.getDay() === 0 ? CLR_SUNDAY_HEAD : CLR_DAY_HEADER);
  }

  sh.getRange(1, 1, 1, totalCols).setValues([row1]).setBackgrounds([bg1]);
  sh.getRange(2, 1, 1, totalCols).setValues([row2]).setBackgrounds([bg2]);

  // one merged band per month
  for (var m = 1; m <= 12; m++) {
    var startCol = FIRST_DAY_COL + mo.offsets[m - 1];
    sh.getRange(1, startCol, 1, mo.lengths[m - 1]).merge()
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
  }

  sh.getRange(1, 1, 2, 1).merge();
  sh.getRange(1, 2, 2, 1).merge();
  sh.getRange(1, 1, 2, 2)
    .setBackground(CLR_HEADER_DARK).setFontColor('#FFFFFF')
    .setVerticalAlignment('middle').setHorizontalAlignment('left');

  sh.getRange(1, 1, 1, totalCols).setFontWeight('bold').setFontSize(11);
  sh.getRange(2, FIRST_DAY_COL, 1, days)
    .setFontWeight('bold').setFontSize(8)
    .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);

  sh.setFrozenRows(2);
  sh.setFrozenColumns(2);
  sh.setColumnWidth(1, 110);
  sh.setColumnWidth(2, 175);
  sh.setColumnWidths(FIRST_DAY_COL, days, DAY_COL_WIDTH);
  sh.setRowHeight(1, 26);
  sh.setRowHeight(2, 34);

  // 367 columns is wide, so keep the row count sane — syncRoster_ adds more
  // rows when the roster outgrows this.
  var keepRows = Math.max(FIRST_DATA_ROW + 200, 100);
  if (sh.getMaxRows() > keepRows) sh.deleteRows(keepRows + 1, sh.getMaxRows() - keepRows);

  seedEmployeeRows_(ss, sh, site, year);

  // Days already gone by are red from the moment the tab exists.
  var t = todayParts_();
  var target = year < t.year ? days : (year > t.year ? 0 : t.doy);
  PropertiesService.getDocumentProperties().setProperty('PAINTED_' + sh.getName(), String(target));

  return sh;
}

function seedEmployeeRows_(ss, sh, site, year) {
  var employees = getEmployeesForSite_(ss, site);
  if (!employees.length) return;

  // Rows: { e: employee } or { label: '…' } for a blank separator row (text in column B only)
  var rows = previousYearOrder_(ss, site, year, employees);
  var values = rows.map(function (x) { return x.e ? [x.e.id, x.e.name] : ['', x.label]; });
  sh.getRange(FIRST_DATA_ROW, 1, values.length, 2).setValues(values);
  applyDayValidation_(sh, year, FIRST_DATA_ROW, values.length);
  paintRowsElapsed_(sh, year, FIRST_DATA_ROW, values.length);
  rows.forEach(function (x, i) {
    if (x.e && !x.e.active) applyInactiveState_(sh, year, FIRST_DATA_ROW + i, true);
  });
}

/**
 * A new year keeps the order the site's rows had last year (rows may be arranged by hand),
 * blank separator rows and their column-B labels included. Anyone not on last year's tab
 * follows at the end in Employees-tab order. No previous tab: Employees-tab order.
 */
function previousYearOrder_(ss, site, year, employees) {
  var plain = employees.map(function (e) { return { e: e }; });
  var prev = ss.getSheetByName(yearTabName_(site, year - 1));
  if (!prev || prev.getLastRow() < FIRST_DATA_ROW) return plain;
  var byId = {};
  employees.forEach(function (e) { byId[e.id] = e; });
  var out = [], used = {};
  prev.getRange(FIRST_DATA_ROW, 1, prev.getLastRow() - FIRST_DATA_ROW + 1, 2).getValues().forEach(function (r) {
    var id = String(r[0] == null ? '' : r[0]).trim();
    if (!id) { out.push({ label: String(r[1] == null ? '' : r[1]) }); return; }
    if (byId[id] && !used[id]) { out.push({ e: byId[id] }); used[id] = true; }
  });
  while (out.length && !out[out.length - 1].e) out.pop();   // no blank rows at the end
  employees.forEach(function (e) { if (!used[e.id]) out.push({ e: e }); });
  return out;
}

/** FD / HD / A dropdown across the whole year, in one call. */
function applyDayValidation_(sh, year, startRow, numRows) {
  if (numRows < 1) return;
  var days = daysInYear_(year);
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(DAY_CODES, true)
    .setAllowInvalid(false)
    .setHelpText('FD = Full Day, HD = Half Day, A = Absent')
    .build();
  var rng = sh.getRange(startRow, FIRST_DAY_COL, numRows, days);
  rng.setDataValidation(rule);
  rng.setHorizontalAlignment('center')
     .setVerticalAlignment('middle')
     .setFontWeight('bold')
     .setFontSize(10)
     .setNumberFormat('@');
}

/**
 * Paints every day that has already happened red, unless it is already
 * green (approved), yellow (sent back) or grey (employee switched off).
 * Only ever touches the columns it has not painted before.
 */
function paintElapsedDays_(sh, year) {
  var lastRow = sh.getLastRow();
  if (lastRow < FIRST_DATA_ROW) return;

  var t = todayParts_();
  var days = daysInYear_(year);
  var target = year < t.year ? days : (year > t.year ? 0 : t.doy);
  if (target < 1) return;

  var props = PropertiesService.getDocumentProperties();
  var key = 'PAINTED_' + sh.getName();
  var done = Number(props.getProperty(key) || 0);
  if (done >= target) return;

  var from = Math.max(1, done + 1);
  var nCols = target - from + 1;
  var nRows = lastRow - FIRST_DATA_ROW + 1;
  var rng = sh.getRange(FIRST_DATA_ROW, FIRST_DAY_COL + from - 1, nRows, nCols);
  var bg = rng.getBackgrounds();
  var touched = false;
  for (var r = 0; r < bg.length; r++) {
    for (var c = 0; c < bg[r].length; c++) {
      if (String(bg[r][c]).toLowerCase() === CLR_FUTURE) { bg[r][c] = CLR_PENDING; touched = true; }
    }
  }
  if (touched) rng.setBackgrounds(bg);
  props.setProperty(key, String(target));
}

/** Same idea, but for a block of rows that has just been added. */
function paintRowsElapsed_(sh, year, startRow, numRows) {
  if (numRows < 1) return;
  var t = todayParts_();
  var days = daysInYear_(year);
  var target = year < t.year ? days : (year > t.year ? 0 : t.doy);
  if (target < 1) return;

  var rng = sh.getRange(startRow, FIRST_DAY_COL, numRows, target);
  var bg = rng.getBackgrounds();
  for (var r = 0; r < bg.length; r++) {
    for (var c = 0; c < bg[r].length; c++) {
      if (String(bg[r][c]).toLowerCase() === CLR_FUTURE) bg[r][c] = CLR_PENDING;
    }
  }
  rng.setBackgrounds(bg);
}

/**
 * Switched-off employee: ID and name go grey with the name struck through,
 * and every day from today onwards goes grey so nobody marks them.
 * Days already recorded keep their real colour — history stays readable.
 */
function applyInactiveState_(sh, year, row, inactive) {
  var nameRange = sh.getRange(row, 1, 1, 2);
  nameRange.setBackground(inactive ? CLR_INACTIVE : null);
  nameRange.setFontColor(inactive ? '#8A8A8A' : '#000000');
  nameRange.setFontLine(inactive ? 'line-through' : 'none');

  var t = todayParts_();
  if (year < t.year) return;                       // a closed year has no future days
  var days = daysInYear_(year);
  var from = (year > t.year) ? 1 : t.doy;          // today counts as "future" — not marked yet
  var nCols = days - from + 1;
  if (nCols < 1) return;

  var rng = sh.getRange(row, FIRST_DAY_COL + from - 1, 1, nCols);
  var vals = rng.getValues()[0];
  var bg = rng.getBackgrounds()[0];

  for (var c = 0; c < nCols; c++) {
    if (inactive) {
      // a day that was actually marked keeps its own colour — history first
      if (statusFromCode_(vals[c])) continue;
      bg[c] = CLR_INACTIVE;
    } else {
      // only undo the grey; never repaint over a real record
      if (String(bg[c]).toLowerCase() !== CLR_INACTIVE) continue;
      var elapsed = (year === t.year && (from + c) <= t.doy);
      bg[c] = elapsed ? CLR_PENDING : CLR_FUTURE;
    }
  }
  rng.setBackgrounds([bg]);
}

/**
 * Brings the tab's rows in line with the Employees tab:
 *   - anyone deleted from Employees loses their row here
 *   - anyone new gets a row
 *   - renames are copied across
 *   - switched-off employees go grey, switched-on ones come back
 * Throttled, because it runs off the back of ordinary polling.
 */
function syncRoster_(ss, sh, site, year, force) {
  var cache = CacheService.getScriptCache();
  var key = 'ROSTER_' + sh.getName();
  if (!force && cache.get(key)) return;
  cache.put(key, '1', EMP_SYNC_TTL_SECONDS);

  var master = getEmployeesForSite_(ss, site);
  var byId = {};
  master.forEach(function (e) { byId[e.id] = e; });

  // ---- 1. drop anyone who is gone from the Employees tab ----
  var read = readRosterBlock_(sh);
  var toDelete = [];
  for (var i = 0; i < read.n; i++) {
    var id = String(read.rows[i][0]).trim();
    if (!id) continue;
    if (!byId[id]) toDelete.push(FIRST_DATA_ROW + i);
  }
  if (toDelete.length) {
    for (var d = toDelete.length - 1; d >= 0; d--) sh.deleteRow(toDelete[d]);
    read = readRosterBlock_(sh);
    dropDay_(site);   // rows moved: the cached day rows point at the wrong rows now
  }

  // ---- 2. names and on/off state ----
  var present = {};
  var names = [];
  var nameChanged = false;
  for (var j = 0; j < read.n; j++) {
    var rid = String(read.rows[j][0]).trim();
    if (!rid) { names.push([read.rows[j][1]]); continue; }
    var emp = byId[rid];
    present[rid] = FIRST_DATA_ROW + j;
    names.push([emp.name]);
    if (String(read.rows[j][1]) !== String(emp.name)) nameChanged = true;

    var greyNow = isInactiveColor_(read.bg[j][0]);
    if (!emp.active && !greyNow) { applyInactiveState_(sh, year, FIRST_DATA_ROW + j, true); dropDay_(site); }
    else if (emp.active && greyNow) { applyInactiveState_(sh, year, FIRST_DATA_ROW + j, false); dropDay_(site); }
  }
  if (nameChanged && names.length) {
    sh.getRange(FIRST_DATA_ROW, 2, names.length, 1).setValues(names);
    dropDay_(site);
  }

  // ---- 3. add anyone new ----
  var missing = master.filter(function (e) { return !present[e.id]; });
  if (!missing.length) return;
  dropDay_(site);

  var startRow = Math.max(sh.getLastRow() + 1, FIRST_DATA_ROW);
  var needRows = startRow + missing.length - 1;
  if (needRows > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), needRows - sh.getMaxRows());

  sh.getRange(startRow, 1, missing.length, 2)
    .setValues(missing.map(function (e) { return [e.id, e.name]; }));
  applyDayValidation_(sh, year, startRow, missing.length);
  paintRowsElapsed_(sh, year, startRow, missing.length);
  missing.forEach(function (e, i) {
    if (!e.active) applyInactiveState_(sh, year, startRow + i, true);
  });
}

function readRosterBlock_(sh) {
  var lastRow = sh.getLastRow();
  if (lastRow < FIRST_DATA_ROW) return { n: 0, rows: [], bg: [] };
  var n = lastRow - FIRST_DATA_ROW + 1;
  return {
    n: n,
    rows: sh.getRange(FIRST_DATA_ROW, 1, n, 2).getValues(),
    bg: sh.getRange(FIRST_DATA_ROW, 1, n, 1).getBackgrounds()
  };
}

/* ---------------- master employee list ---------------- */

/** Everyone on the Employees tab for this site, active or not. */
function getEmployeesForSite_(ss, site) {
  var memoKey = 'empSite_' + site;
  if (MEMO_[memoKey]) return MEMO_[memoKey];
  var out = [];
  var seen = {};
  employeesAll_().forEach(function (e) {
    if (e.site !== site || seen[e.id]) return;   // duplicate IDs would create duplicate rows
    seen[e.id] = true;
    out.push({ id: e.id, name: e.name, supervisor: e.supervisor, designation: e.designation, active: e.active });
  });
  return (MEMO_[memoKey] = out);
}

/**
 * { employeeId -> 'mine' | 'unassigned' } for one supervisor at one site.
 * A supervisor username that no longer exists counts as unassigned, so nobody
 * silently disappears off every screen when an account is deleted.
 */
function employeesForSupervisor_(ss, site, username) {
  var me = String(username || '').trim().toLowerCase();
  var known = {};
  listSupervisors_(ss, true).forEach(function (s) { known[s.key] = true; });

  var out = {};
  getEmployeesForSite_(ss, site).forEach(function (e) {
    if (!e.active) return;
    var sup = e.supervisor.toLowerCase();
    if (sup && known[sup]) {
      if (sup === me) out[e.id] = 'mine';
    } else if (SUPERVISOR_SEES_UNASSIGNED) {
      out[e.id] = 'unassigned';
    }
  });
  return out;
}

/** { employeeId -> supervisor username } for one site, for the HR screens. */
function supervisorMapForSite_(ss, site) {
  var out = {};
  getEmployeesForSite_(ss, site).forEach(function (e) { out[e.id] = e.supervisor; });
  return out;
}

function getActiveEmployeesForSite_(ss, site) {
  return getEmployeesForSite_(ss, site).filter(function (e) { return e.active; });
}

/** { employeeId -> row number } for an attendance tab. */
function empRowMap_(sh) {
  var last = sh.getLastRow();
  if (last < FIRST_DATA_ROW) return {};
  var ids = sh.getRange(FIRST_DATA_ROW, 1, last - FIRST_DATA_ROW + 1, 1).getValues();
  var map = {};
  for (var i = 0; i < ids.length; i++) {
    if (ids[i][0] !== '' && ids[i][0] !== null) map[String(ids[i][0]).trim()] = FIRST_DATA_ROW + i;
  }
  return map;
}
