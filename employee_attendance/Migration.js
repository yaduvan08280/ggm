/*******************************************************
 * Migration.gs — one-time only.
 *
 * Converts the old monthly tabs (Tonk_Aug-2026: four checkbox
 * columns per day plus an HR Check column) into the new yearly
 * tabs (Tonk_2026: one dropdown column per day, HR approval
 * carried by the cell colour).
 *
 * Run migrateMonthlyTabsToYearTabs() from the Apps Script editor.
 * The old tabs are left exactly where they are — delete them
 * yourself once you have checked the result.
 *******************************************************/

var OLD_COLS_PER_DAY = 4;   // Full Day | Half Day | Absent | HR Check
var OLD_FIRST_DAY_COL = 3;
var OLD_FIRST_DATA_ROW = 3;

function migrateMonthlyTabsToYearTabs() {
  var ss = ss_();
  var report = [];
  var skippedIds = {};
  var tabs = [];

  ss.getSheets().forEach(function (sh) {
    var parsed = parseOldMonthTab_(sh.getName());
    if (parsed) tabs.push({ sh: sh, site: parsed.site, year: parsed.year, month: parsed.month });
  });

  if (!tabs.length) {
    return finishMigration_('No old monthly tabs found — nothing to migrate.');
  }

  // oldest first, so later months overwrite earlier ones if they ever overlap
  tabs.sort(function (a, b) { return (a.year * 12 + a.month) - (b.year * 12 + b.month); });

  tabs.forEach(function (t) {
    var res = migrateOneMonthTab_(ss, t.sh, t.site, t.year, t.month);
    report.push(t.sh.getName() + ' → ' + yearTabName_(t.site, t.year) +
                ' : ' + res.moved + ' record' + (res.moved === 1 ? '' : 's') +
                (res.skipped.length ? ', ' + res.skipped.length + ' unknown employee(s) skipped' : ''));
    res.skipped.forEach(function (id) { skippedIds[id] = true; });
  });

  var missing = Object.keys(skippedIds);
  var msg = 'Migration finished.\n\n' + report.join('\n');
  if (missing.length) {
    msg += '\n\nThese IDs were on an old tab but are not on the Employees tab, ' +
           'so they were skipped:\n' + missing.join(', ') +
           '\n\nAdd them to Employees and run this again if you want their history.';
  }
  msg += '\n\nThe old monthly tabs have NOT been touched. Check the new year tabs, then delete the old ones.';
  return finishMigration_(msg);
}

function finishMigration_(msg) {
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* no UI when run headless */ }
  return msg;
}

/** "Tonk_Aug-2026" -> { site, year, month } ; anything else -> null. */
function parseOldMonthTab_(name) {
  var m = String(name).match(/^(.+)_([A-Za-z]{3})-(\d{4})$/);
  if (!m) return null;
  if (SITES.indexOf(m[1]) === -1) return null;
  var mi = MONTH_INDEX[m[2].charAt(0).toUpperCase() + m[2].substring(1, 3).toLowerCase()];
  if (mi === undefined) return null;
  return { site: m[1], year: Number(m[3]), month: mi + 1 };
}

function migrateOneMonthTab_(ss, oldSh, site, year, month) {
  var out = { moved: 0, skipped: [] };

  var oldLastRow = oldSh.getLastRow();
  if (oldLastRow < OLD_FIRST_DATA_ROW) return out;

  var days = daysInMonth_(year, month);
  var oldCols = days * OLD_COLS_PER_DAY;
  var availableCols = oldSh.getLastColumn() - (OLD_FIRST_DAY_COL - 1);
  if (availableCols < oldCols) days = Math.floor(availableCols / OLD_COLS_PER_DAY);
  if (days < 1) return out;

  var nOld = oldLastRow - OLD_FIRST_DATA_ROW + 1;
  var oldIds = oldSh.getRange(OLD_FIRST_DATA_ROW, 1, nOld, 1).getValues();
  var oldGrid = oldSh.getRange(OLD_FIRST_DATA_ROW, OLD_FIRST_DAY_COL, nOld, days * OLD_COLS_PER_DAY).getValues();

  // target
  var target = ensureYearSheet_(ss, site, year);
  syncRoster_(ss, target, site, year, true);
  var map = empRowMap_(target);

  var tLastRow = target.getLastRow();
  if (tLastRow < FIRST_DATA_ROW) return out;
  var nNew = tLastRow - FIRST_DATA_ROW + 1;

  var startCol = dayCol_(year, month, 1);
  var block = target.getRange(FIRST_DATA_ROW, startCol, nNew, days);
  var values = block.getValues();
  var bgs = block.getBackgrounds();

  for (var i = 0; i < nOld; i++) {
    var id = String(oldIds[i][0] == null ? '' : oldIds[i][0]).trim();
    if (!id) continue;
    var targetRow = map[id];
    if (!targetRow) { if (out.skipped.indexOf(id) === -1) out.skipped.push(id); continue; }
    var r = targetRow - FIRST_DATA_ROW;
    if (r < 0 || r >= nNew) continue;

    for (var d = 0; d < days; d++) {
      var o = d * OLD_COLS_PER_DAY;
      var code = '';
      if (oldGrid[i][o] === true) code = CODE_FULL;
      else if (oldGrid[i][o + 1] === true) code = CODE_HALF;
      else if (oldGrid[i][o + 2] === true) code = CODE_ABSENT;
      if (!code) continue;

      var hr = String(oldGrid[i][o + 3] || '').trim();
      values[r][d] = code;
      bgs[r][d] = hr === 'Correct' ? CLR_APPROVED
                : hr === 'Incorrect' ? CLR_SENTBACK
                : CLR_PENDING;
      out.moved++;
    }
  }

  block.setValues(values);
  block.setBackgrounds(bgs);
  SpreadsheetApp.flush();
  return out;
}

/*******************************************************
 * Adds the Supervisor column to an Employees tab that was
 * built before it existed. Run addSupervisorColumn() once
 * from the editor. Safe to run again — it does nothing if
 * the column is already there.
 *******************************************************/
function addSupervisorColumn() {
  var ss = ss_();
  var sh = ss.getSheetByName(SHEET_EMPLOYEES);
  if (!sh) return finishMigration_('No Employees tab found. Run setupEverything() first.');

  var width = Math.max(sh.getLastColumn(), EMP_COL_COUNT);
  var headers = sh.getRange(1, 1, 1, width).getValues()[0];

  if (String(headers[EMP_COL_SUPERVISOR - 1]).trim() === 'Supervisor') {
    var sups0 = refreshSupervisorDropdown_(ss);
    return finishMigration_(
      'The Supervisor column is already in place.\n\n' +
      'Dropdown refreshed with ' + sups0.length + ' supervisor account' +
      (sups0.length === 1 ? '' : 's') + '.');
  }

  // Designation and Active shift right on their own, checkboxes and all.
  sh.insertColumnAfter(EMP_COL_SITE);
  sh.getRange(1, EMP_COL_SUPERVISOR).setValue('Supervisor');
  styleHeader_(sh, EMP_COL_COUNT);
  sh.setColumnWidth(EMP_COL_SUPERVISOR, 170);

  var sups = refreshSupervisorDropdown_(ss);
  var rows = Math.max(0, sh.getLastRow() - 1);

  return finishMigration_(
    'Supervisor column added.\n\n' +
    'Employees tab is now: Employee ID | Name | Site | Supervisor | Designation | Active\n' +
    rows + ' employee row' + (rows === 1 ? '' : 's') + ' kept their data.\n' +
    'Dropdown built from ' + sups.length + ' supervisor account' + (sups.length === 1 ? '' : 's') + '.\n\n' +
    'Every employee is unassigned until you fill the column in, which means every ' +
    'supervisor at a site still sees everyone there. Fill it in and each supervisor ' +
    'only sees their own people.');
}

/**
 * Optional tidy-up once you are happy with the year tabs:
 * hides every old monthly tab instead of deleting it.
 */
function hideOldMonthlyTabs() {
  var n = 0;
  ss_().getSheets().forEach(function (sh) {
    if (parseOldMonthTab_(sh.getName()) && !sh.isSheetHidden()) { sh.hideSheet(); n++; }
  });
  return finishMigration_('Hid ' + n + ' old monthly tab' + (n === 1 ? '' : 's') + '.');
}
