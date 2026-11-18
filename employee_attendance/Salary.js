/*******************************************************
 * Salary.gs — monthly salary from the attendance tabs (built 17 Nov 2026).
 *
 * Tabs (in this spreadsheet):
 *   Salary Setup      one row per person: pay type, basic, paid absents, Sundays paid, joining date,
 *                     firm, Bank/Cash, bank details. A blank cell = the group rule.
 *   Salary Rules      group defaults. Most specific wins: Site + Designation → Designation → Site → All.
 *   Holidays          festival days, for everyone or a site / designation / list of IDs.
 *   Firms             the firms that pay salaries (dropdown in Setup).
 *   Advances & Loans  a ledger: one row when money is given; "Recovered" rows are added when a
 *                     month is locked, so the history is never overwritten. Still due = sum.
 *   Salary <Mon yyyy> the month's salary, made by the app (HR / Accounts / Admin), locked by
 *                     Accounts / Admin. Locked = protected values + recoveries written.
 *
 * The rules (owner, 17 Nov 2026):
 *   Present       = Full days + ½ × Half days (all sites the person is on; one mark per day)
 *   Payable days  = Present + paid Sundays + festival days + paid absents. Worked a paid off day?
 *                   It still counts as an off ("given 4 offs, takes 3 → paid for the extra one").
 *   Monthly pay   = Basic ÷ days in the month (28-31, every site) × payable days
 *   Daily pay     = Basic × payable days;   Fixed = Basic.
 *   No rounding of half days anywhere. Joining month: no festival days, no paid absents, Sundays from
 *   the joining date. A month with no day present gets no paid days.
 *   Net = Gross + Bonus − recoveries; net never goes below 0 (the rest waits for next month).
 *******************************************************/

var SAL_SETUP = 'Salary Setup', SAL_RULES = 'Salary Rules', SAL_HOLIDAYS = 'Holidays', SAL_FIRMS = 'Firms', SAL_LEDGER = 'Advances & Loans';
var SAL_TAB_RE = /^Salary ([A-Z][a-z]{2}) (\d{4})$/;
var SAL_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var SAL_MON_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
var SAL_PAY_TYPES = ['Monthly', 'Daily', 'Fixed'];
var SAL_MODES = ['Bank', 'Cash'];
var SAL_TYPES_GIVE = ['Advance', 'Petrol', 'Loan', 'Deduction', 'Bonus'];   // entered by people
var SAL_TYPE_RECOVERED = 'Recovered', SAL_TYPE_PAID = 'Paid out';            // written when a month is locked
var SAL_FIRST_FIRMS = ['NAKUL GOYAL HUF', 'NEERAJ KUMAR GOYAL HUF', 'BIJENDRA KUMAR GOYAL HUF', 'SHRI BALAJI METACAST PVT LTD',
  'SHREE BS MINING COMPANY', 'GOYAL ENTERPRISES', 'N K MINERALS', 'STONE SCIENCE', 'STONE EMPIRE', 'BQPL', 'GMPL'];

// looks: the app's ink & honey
var SAL_INK = '#232220', SAL_AMBER = '#F2C14E', SAL_WASH = '#FBEFCB', SAL_CREAM = '#FCFAF5', SAL_LINE = '#E8E3D6',
    SAL_AUTO = '#F1EEE6', SAL_OK = '#E3F1E7', SAL_BAD = '#F8E2DB', SAL_SOFT = '#6C685D';
var SAL_MONEY = '[>=10000000]##\\,##\\,##\\,##0;[>=100000]##\\,##\\,##0;##,##0';   // Indian grouping: 1,23,45,678
var SAL_HEAD_ROW = 3, SAL_FIRST_ROW = 4;           // Setup / Rules / Holidays / Firms / Ledger: title, hint, header
var SAL_RUN_HEAD = 5, SAL_RUN_FIRST = 6;           // a month tab: title, KPI labels, KPI values, groups, header

/* ---------------- tab layouts ---------------- */

var SAL_LAYOUT = {};
SAL_LAYOUT[SAL_SETUP] = {
  title: 'Salary Setup', hint: 'One row per person. Grey columns come from Employees by themselves. A blank cell uses the group rule in "Salary Rules".',
  head: ['Emp ID', 'Name', 'Site', 'Designation', 'Active', 'Pay type', 'Basic ₹', 'Paid absents / month', 'Sundays paid', 'Joining date', 'Firm', 'Bank / Cash', 'Account holder', 'Account no.', 'IFSC', 'Note'],
  widths: [70, 210, 110, 150, 60, 90, 90, 90, 80, 95, 210, 80, 180, 150, 110, 200], auto: 5, freezeCols: 2,
  groups: [[1, 5, 'Employee · filled by the app'], [6, 10, 'Pay rules'], [11, 15, 'Payment'], [16, 16, '']]
};
SAL_LAYOUT[SAL_RULES] = {
  title: 'Salary Rules', hint: 'Used when a person\'s own cell in "Salary Setup" is blank. Most specific wins: Site + Designation → Designation → Site → All (both blank).',
  head: ['Site', 'Designation', 'Pay type', 'Basic ₹', 'Paid absents / month', 'Sundays paid', 'Firm', 'Bank / Cash', 'Note'],
  widths: [110, 170, 90, 90, 100, 90, 210, 90, 260], freezeCols: 0,
  groups: [[1, 2, 'Applies to (blank = everyone)'], [3, 8, 'Default'], [9, 9, '']]
};
SAL_LAYOUT[SAL_HOLIDAYS] = {
  title: 'Holidays', hint: 'Paid festival days. A blank filter means everyone; fill Site, Designation or IDs (comma list) to narrow it. Fill the whole year at once.',
  head: ['Date', 'Festival', 'Site', 'Designation', 'Only these IDs', 'Note'],
  widths: [95, 200, 110, 170, 200, 220], freezeCols: 0,
  groups: [[1, 2, 'Holiday'], [3, 5, 'Who gets it (blank = everyone)'], [6, 6, '']]
};
SAL_LAYOUT[SAL_FIRMS] = {
  title: 'Firms', hint: 'The firms that pay salaries. The Firm dropdown in "Salary Setup" and "Salary Rules" comes from here.',
  head: ['Firm', 'Pays from (bank)', 'Account no.', 'IFSC', 'Note'],
  widths: [240, 180, 160, 110, 240], freezeCols: 0,
  groups: [[1, 1, 'Firm'], [2, 4, 'Paying account'], [5, 5, '']]
};
SAL_LAYOUT[SAL_LEDGER] = {
  title: 'Advances & Loans', hint: 'Enter in the app (Salary → Advances). One row when money is given; "Recovered" rows are added when a month\'s salary is locked. Do not edit old rows — add a new one.',
  head: ['No.', 'Date', 'Emp ID', 'Name', 'Site', 'Type', 'Amount ₹', 'Recover over (months)', 'From salary of', 'Still due ₹', 'Against No.', 'Note', 'Entered by', 'Entered on'],
  widths: [70, 90, 70, 200, 100, 90, 90, 100, 100, 90, 85, 230, 110, 130], freezeCols: 0,
  groups: [[1, 6, 'Entry'], [7, 11, 'Money'], [12, 14, '']]
};
var LG = { NO: 0, DATE: 1, ID: 2, NAME: 3, SITE: 4, TYPE: 5, AMT: 6, MONTHS: 7, FROM: 8, DUE: 9, AGAINST: 10, NOTE: 11, BY: 12, AT: 13 };

/* ---------------- small helpers ---------------- */

function salNum_(v) {
  if (v === '' || v === null || v === undefined) return null;
  var n = Number(String(v).replace(/[₹,\s]/g, ''));
  return isFinite(n) ? n : null;
}
function salStr_(v) { return String(v == null ? '' : v).trim(); }
function salKey_(v) { return salStr_(v).toLowerCase(); }
function salYes_(v) {
  var s = salKey_(v);
  if (s === '') return null;
  return s === 'yes' || s === 'y' || s === 'true' || s === '1';
}
function salRound2_(n) { return Math.round(n * 100) / 100; }
function salMoney_(n) { return '₹' + Math.round(n).toLocaleString('en-IN'); }

/** '2026-11' | 'Nov 2026' | a Date → { y, m, key: '2026-11', label: 'Nov 2026', long: 'November 2026' }, or null. */
function salMonth_(v) {
  var y, m;
  if (v instanceof Date) { y = Number(Utilities.formatDate(v, TZ, 'yyyy')); m = Number(Utilities.formatDate(v, TZ, 'M')); }
  else {
    var s = salStr_(v), a = s.match(/^(\d{4})-(\d{1,2})$/), b = s.match(/^([A-Za-z]{3})[a-z]*[\s-]+(\d{4})$/);
    if (a) { y = Number(a[1]); m = Number(a[2]); }
    else if (b) { y = Number(b[2]); m = SAL_MON.map(function (x) { return x.toLowerCase(); }).indexOf(b[1].toLowerCase()) + 1; }
  }
  if (!y || !(m >= 1 && m <= 12)) return null;
  return { y: y, m: m, key: y + '-' + ('0' + m).slice(-2), label: SAL_MON[m - 1] + ' ' + y, long: SAL_MON_LONG[m - 1] + ' ' + y };
}
function salTabName_(mo) { return 'Salary ' + mo.label; }
function salDate_(v) {
  if (v instanceof Date && !isNaN(v)) return v;
  var s = salStr_(v), a = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/), b = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (a) return new Date(Number(a[3]), Number(a[2]) - 1, Number(a[1]));
  if (b) return new Date(Number(b[1]), Number(b[2]) - 1, Number(b[3]));
  return null;
}
function salIso_(d) { return d ? Utilities.formatDate(d, TZ, 'yyyy-MM-dd') : ''; }

function salUser_(token, roles) {
  var user = requireRole_(token, roles || ['HR', 'Accounts', 'Admin']);
  return user;
}
function salAllSites_(user) {
  if (scopeSites_(user).length < SITES.length) throw new Error('Salary is for all sites together — ask the IT admin to clear the Site on your Attendance access.');
}
function salState_(mo) {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('SAL_STATE_' + mo.key) || 'null'); } catch (e) { return null; }
}
function salSetState_(mo, st) {
  var p = PropertiesService.getScriptProperties();
  if (st) p.setProperty('SAL_STATE_' + mo.key, JSON.stringify(st)); else p.deleteProperty('SAL_STATE_' + mo.key);
}

/* ---------------- building the tabs ---------------- */

/** A tab with the title, hint, group band and header (rows 1-3), styled. Existing tabs keep their rows. */
function salEnsureTab_(ss, name) {
  var L = SAL_LAYOUT[name], sh = ss.getSheetByName(name), fresh = !sh;
  if (!sh) sh = ss.insertSheet(name);
  var n = L.head.length;
  if (sh.getMaxColumns() < n) sh.insertColumnsAfter(sh.getMaxColumns(), n - sh.getMaxColumns());
  sh.getRange(1, 1).setValue(L.title).setFontSize(15).setFontWeight('bold').setFontColor(SAL_INK);
  sh.getRange(1, 1, 1, n).setBackground(SAL_CREAM);
  sh.getRange(2, 1).setValue(L.hint).setFontColor(SAL_SOFT).setFontStyle('italic').setWrap(false);
  sh.getRange(2, 1, 1, n).setBackground(SAL_CREAM);
  sh.getRange(SAL_HEAD_ROW, 1, 1, n).setValues([L.head]).setBackground(SAL_INK).setFontColor('#FFFFFF').setFontWeight('bold')
    .setVerticalAlignment('middle').setWrap(true);
  if (L.auto) sh.getRange(SAL_HEAD_ROW, 1, 1, L.auto).setBackground('#4A4740');
  sh.setRowHeight(1, 34); sh.setRowHeight(SAL_HEAD_ROW, 40);
  sh.setFrozenRows(SAL_HEAD_ROW);
  if (L.freezeCols) sh.setFrozenColumns(L.freezeCols);
  L.widths.forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  if (fresh) sh.setTabColor(SAL_AMBER);
  return sh;
}

/** Dropdowns, number formats and the grey "filled by the app" columns. Safe to run again. */
function salFormatTabs_(ss) {
  var rows = 2000, list = function (vals) { return SpreadsheetApp.newDataValidation().requireValueInList(vals, true).setAllowInvalid(true).build(); };
  var firms = ss.getSheetByName(SAL_FIRMS);
  var firmRule = firms ? SpreadsheetApp.newDataValidation().requireValueInRange(firms.getRange(SAL_FIRST_ROW, 1, 200, 1), true).setAllowInvalid(true).build() : null;

  var su = ss.getSheetByName(SAL_SETUP);
  if (su) {
    if (su.getMaxRows() < rows) su.insertRowsAfter(su.getMaxRows(), rows - su.getMaxRows());
    su.getRange(SAL_FIRST_ROW, 1, rows - SAL_FIRST_ROW + 1, 5).setBackground(SAL_AUTO).setFontColor(SAL_SOFT);
    su.getRange(SAL_FIRST_ROW, 6, rows - SAL_FIRST_ROW + 1, 1).setDataValidation(list(SAL_PAY_TYPES));
    su.getRange(SAL_FIRST_ROW, 7, rows - SAL_FIRST_ROW + 1, 1).setNumberFormat(SAL_MONEY);
    su.getRange(SAL_FIRST_ROW, 9, rows - SAL_FIRST_ROW + 1, 1).setDataValidation(list(['Yes', 'No']));
    su.getRange(SAL_FIRST_ROW, 10, rows - SAL_FIRST_ROW + 1, 1).setNumberFormat('dd/mm/yyyy');
    if (firmRule) su.getRange(SAL_FIRST_ROW, 11, rows - SAL_FIRST_ROW + 1, 1).setDataValidation(firmRule);
    su.getRange(SAL_FIRST_ROW, 12, rows - SAL_FIRST_ROW + 1, 1).setDataValidation(list(SAL_MODES));
    su.getRange(SAL_FIRST_ROW, 14, rows - SAL_FIRST_ROW + 1, 2).setNumberFormat('@');
    su.getRange(SAL_FIRST_ROW, 6, rows - SAL_FIRST_ROW + 1, 4).setHorizontalAlignment('center');
  }
  var ru = ss.getSheetByName(SAL_RULES);
  if (ru) {
    ru.getRange(SAL_FIRST_ROW, 1, 200, 1).setDataValidation(list(SITES.slice()));
    ru.getRange(SAL_FIRST_ROW, 3, 200, 1).setDataValidation(list(SAL_PAY_TYPES));
    ru.getRange(SAL_FIRST_ROW, 4, 200, 1).setNumberFormat(SAL_MONEY);
    ru.getRange(SAL_FIRST_ROW, 6, 200, 1).setDataValidation(list(['Yes', 'No']));
    if (firmRule) ru.getRange(SAL_FIRST_ROW, 7, 200, 1).setDataValidation(firmRule);
    ru.getRange(SAL_FIRST_ROW, 8, 200, 1).setDataValidation(list(SAL_MODES));
  }
  var ho = ss.getSheetByName(SAL_HOLIDAYS);
  if (ho) {
    ho.getRange(SAL_FIRST_ROW, 1, 400, 1).setNumberFormat('ddd, dd mmm yyyy').setDataValidation(SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false).build());
    ho.getRange(SAL_FIRST_ROW, 3, 400, 1).setDataValidation(list(SITES.slice()));
    ho.getRange(SAL_FIRST_ROW, 5, 400, 1).setNumberFormat('@');
  }
  var fi = ss.getSheetByName(SAL_FIRMS);
  if (fi) fi.getRange(SAL_FIRST_ROW, 3, 200, 1).setNumberFormat('@');
  var lg = ss.getSheetByName(SAL_LEDGER);
  if (lg) {
    if (lg.getMaxRows() < 3000) lg.insertRowsAfter(lg.getMaxRows(), 3000 - lg.getMaxRows());
    lg.getRange(SAL_FIRST_ROW, 2, 2997, 1).setNumberFormat('dd/mm/yyyy');
    lg.getRange(SAL_FIRST_ROW, 7, 2997, 1).setNumberFormat(SAL_MONEY);
    lg.getRange(SAL_FIRST_ROW, 9, 2997, 1).setNumberFormat('@');
    lg.getRange(SAL_FIRST_ROW, 10, 2997, 1).setNumberFormat(SAL_MONEY).setFontWeight('bold');
    lg.getRange(SAL_FIRST_ROW, 14, 2997, 1).setNumberFormat('dd/mm/yyyy hh:mm');
  }
}

/** Creates the salary tabs once, seeds the firms and a few group rules, and fills Setup from Employees. */
function salSetup_(ss) {
  ss = ss || ss_();
  var made = {};
  [SAL_FIRMS, SAL_RULES, SAL_HOLIDAYS, SAL_SETUP, SAL_LEDGER].forEach(function (n) { made[n] = !ss.getSheetByName(n); salEnsureTab_(ss, n); });
  if (made[SAL_FIRMS]) ss.getSheetByName(SAL_FIRMS).getRange(SAL_FIRST_ROW, 1, SAL_FIRST_FIRMS.length, 1).setValues(SAL_FIRST_FIRMS.map(function (f) { return [f]; }));
  if (made[SAL_RULES]) ss.getSheetByName(SAL_RULES).getRange(SAL_FIRST_ROW, 1, 5, 9).setValues([
    ['', '', '', '', 0, 'No', '', '', 'Everyone: no paid absents, no paid Sundays unless set below or per person'],
    ['', 'Ladies', 'Daily', 350, '', '', '', 'Cash', 'From the old LABOUR SHEET'],
    ['', 'LABOUR', 'Daily', 425, '', '', '', 'Cash', 'From the old LABOUR SHEET'],
    ['', 'Local Gents labour', 'Daily', 425, '', '', '', 'Cash', 'From the old LABOUR SHEET'],
    ['Jaipur', '', '', '', '', 'Yes', '', '', 'Jaipur office: Sundays are paid (old STAFF CONDITION)']
  ]);
  salFormatTabs_(ss);
  salSyncSetup_(ss);
  return made;
}

/** warmCaches: build the salary tabs the first time (after a deploy), never again. */
function salSetupOnce_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('SAL_SETUP_V1')) return;
  salSetup_(ss_());
  props.setProperty('SAL_SETUP_V1', todayParts_().iso);
}

/**
 * One-time import (17 Nov 2026) from the old workbook "SALARY SHEET FINAL-OCT-2026 NEW": MASTER SHEET gives pay
 * type, basic, firm, Bank/Cash and bank details; LABOUR SHEET gives daily rates (only written when the group rule
 * would not give the same). Only Setup rows whose pay columns are all empty are filled. Returns the count.
 */
var SAL_OLD_BOOK = '1U0H4yiwJeWuTeeb7v3OZfBkd3URumYMrJlGal61tUTo';
function salImportOld_(ss, oldBook) {
  var su = ss.getSheetByName(SAL_SETUP);
  if (!su || su.getLastRow() < SAL_FIRST_ROW) return 0;
  var old = oldBook || SpreadsheetApp.openById(SAL_OLD_BOOK);
  var ms = old.getSheetByName('MASTER SHEET'), ls = old.getSheetByName('LABOUR SHEET');
  var master = {}, labour = {};
  if (ms && ms.getLastRow() >= 2) ms.getRange(2, 1, ms.getLastRow() - 1, 16).getDisplayValues().forEach(function (r) {
    var id = salStr_(r[0]);
    if (id && id !== '0' && !master[id]) master[id] = r;
  });
  if (ls && ls.getLastRow() >= 5) ls.getRange(5, 1, ls.getLastRow() - 4, 9).getDisplayValues().forEach(function (r) {
    var id = salStr_(r[0]), rate = salNum_(r[7]);
    if (id && rate && !labour[id]) labour[id] = rate;
  });
  var firms = salFirms_(ss), rules = salReadRules_(ss), n = su.getLastRow() - SAL_FIRST_ROW + 1;
  var grid = su.getRange(SAL_FIRST_ROW, 1, n, 16).getValues(), out = grid.map(function (r) { return r.slice(5, 16); }), done = 0;
  grid.forEach(function (r, i) {
    var id = salStr_(r[0]);
    if (!id || r.slice(5, 16).some(function (x) { return salStr_(x) !== ''; })) return;
    var m = master[id];
    if (m) {
      var basic = salNum_(m[15]), fixed = salKey_(m[4]) === 'fix' || salKey_(m[5]) === 'fix';
      var firm = salStr_(m[14]).toUpperCase().replace('BIJENDER', 'BIJENDRA'), modeOld = salKey_(m[11]);
      var notes = ['From old MASTER SHEET'];
      if (/^(allow|specified people)$/.test(salKey_(m[5]))) notes.push('old rule: ' + salStr_(m[5]) + ' (paid absents by slab, max 3)');
      if (modeOld === 'not paid' || salKey_(m[4]) === 'not paid' || firm === 'NOT PAID') notes.push('old sheet said NOT PAID');
      if (salKey_(m[2]) === 'jaipur/ft') notes.push('Jaipur full-time: Sundays not paid');
      out[i] = [fixed ? 'Fixed' : basic ? (basic > 2000 ? 'Monthly' : 'Daily') : '', basic || '', '', salKey_(m[2]) === 'jaipur/ft' ? 'No' : '', '',
                firms.indexOf(firm) > -1 ? firm : '', modeOld === 'bank' ? 'Bank' : (modeOld === 'cash' || modeOld === 'other cash') ? 'Cash' : '',
                salStr_(m[10]), salStr_(m[12]), salStr_(m[13]), notes.join(' · ')];
      done++;
    } else if (labour[id]) {
      var rb = salPick_(null, rules, 'basic', r[2], r[3]).v, rt = salPick_(null, rules, 'payType', r[2], r[3]).v;
      if (rb === labour[id] && rt === 'Daily') return;   // the group rule already pays this
      out[i] = ['Daily', labour[id], '', '', '', '', 'Cash', '', '', '', 'From old LABOUR SHEET'];
      done++;
    }
  });
  if (done) su.getRange(SAL_FIRST_ROW, 6, n, 11).setValues(out);
  return done;
}
function salImportOnce_() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SAL_SETUP_V1') || props.getProperty('SAL_IMPORT_V1')) return;
  var n = salImportOld_(ss_());
  props.setProperty('SAL_IMPORT_V1', todayParts_().iso + ' · ' + n + ' rows');
}

/**
 * Setup follows Employees: a row for every Employee ID (new people are added at the bottom), and the grey
 * columns (name, site, designation, active) are rewritten. An ID on two Employees rows is one Setup row.
 */
function salSyncSetup_(ss) {
  var sh = ss.getSheetByName(SAL_SETUP);
  if (!sh) return 0;
  dropEmployees_();
  var people = salPeople_();
  var last = sh.getLastRow(), have = {}, ids = [];
  if (last >= SAL_FIRST_ROW) {
    ids = sh.getRange(SAL_FIRST_ROW, 1, last - SAL_FIRST_ROW + 1, 1).getValues().map(function (r) { return salStr_(r[0]); });
    ids.forEach(function (id) { if (id) have[id] = true; });
  }
  var add = Object.keys(people).filter(function (id) { return !have[id]; })
    .sort(function (a, b) { var x = people[a], y = people[b]; return (SITES.indexOf(x.site) - SITES.indexOf(y.site)) || (Number(a) - Number(b)) || a.localeCompare(b); });
  var all = ids.concat(add);
  if (!all.length) return 0;
  var block = all.map(function (id) {
    var p = people[id];
    if (!id) return ['', '', '', '', ''];
    if (!p) return [id, '(not in Employees)', '', '', 'No'];
    return [id, p.name, p.sites.join(' + '), p.designation, p.active ? 'Yes' : 'No'];
  });
  sh.getRange(SAL_FIRST_ROW, 1, block.length, 5).setValues(block);
  return add.length;
}

/** Employees grouped by ID: { id: { name, names[], sites[], site (main), designation, active, two (different people) } } */
function salPeople_() {
  var out = {};
  employeesAll_().forEach(function (e) {
    var p = out[e.id];
    if (!p) p = out[e.id] = { id: e.id, name: e.name, names: [], sites: [], site: e.site, designation: e.designation, active: false, two: false };
    var nk = salKey_(e.name).replace(/\s+/g, ' ');
    if (p.names.map(function (x) { return salKey_(x).replace(/\s+/g, ' '); }).indexOf(nk) === -1) p.names.push(e.name);
    if (p.sites.indexOf(e.site) === -1) p.sites.push(e.site);
    if (e.active && !p.active) { p.active = true; p.site = e.site; if (e.designation) p.designation = e.designation; }
    if (!p.designation && e.designation) p.designation = e.designation;
  });
  Object.keys(out).forEach(function (id) {
    var p = out[id];
    p.two = p.names.length > 1;
    if (p.two) p.name = p.names.join(' / ');
  });
  return out;
}

/* ---------------- reading setup, rules, holidays, firms ---------------- */

function salReadSetup_(ss) {
  var sh = ss.getSheetByName(SAL_SETUP), out = {};
  if (!sh || sh.getLastRow() < SAL_FIRST_ROW) return out;
  sh.getRange(SAL_FIRST_ROW, 1, sh.getLastRow() - SAL_FIRST_ROW + 1, 16).getValues().forEach(function (r) {
    var id = salStr_(r[0]);
    if (!id || out[id]) return;
    out[id] = { payType: salStr_(r[5]), basic: salNum_(r[6]), paidAbsents: salNum_(r[7]), sundays: salYes_(r[8]), joining: salDate_(r[9]),
                firm: salStr_(r[10]), mode: salStr_(r[11]), holder: salStr_(r[12]), account: salStr_(r[13]), ifsc: salStr_(r[14]) };
  });
  return out;
}

function salReadRules_(ss) {
  var sh = ss.getSheetByName(SAL_RULES), out = [];
  if (!sh || sh.getLastRow() < SAL_FIRST_ROW) return out;
  sh.getRange(SAL_FIRST_ROW, 1, sh.getLastRow() - SAL_FIRST_ROW + 1, 8).getValues().forEach(function (r) {
    var o = { site: salKey_(r[0]), desig: salKey_(r[1]), payType: salStr_(r[2]), basic: salNum_(r[3]), paidAbsents: salNum_(r[4]),
              sundays: salYes_(r[5]), firm: salStr_(r[6]), mode: salStr_(r[7]) };
    if (!o.payType && o.basic === null && o.paidAbsents === null && o.sundays === null && !o.firm && !o.mode) return;
    o.rank = o.site && o.desig ? 4 : o.desig ? 3 : o.site ? 2 : 1;
    out.push(o);
  });
  return out.sort(function (a, b) { return b.rank - a.rank; });
}

/** A person's value for a field: own cell, else the most specific rule that sets it. */
function salPick_(own, rules, field, site, desig) {
  if (own && own[field] !== null && own[field] !== undefined && own[field] !== '') return { v: own[field], from: 'own' };
  var s = salKey_(site), d = salKey_(desig);
  for (var i = 0; i < rules.length; i++) {
    var r = rules[i];
    if ((r.site && r.site !== s) || (r.desig && r.desig !== d)) continue;
    if (r[field] !== null && r[field] !== undefined && r[field] !== '') return { v: r[field], from: r.rank === 4 ? 'site + designation' : r.rank === 3 ? 'designation' : r.rank === 2 ? 'site' : 'all' };
  }
  return { v: null, from: '' };
}

function salReadHolidays_(ss, mo) {
  var sh = ss.getSheetByName(SAL_HOLIDAYS), out = [];
  if (!sh || sh.getLastRow() < SAL_FIRST_ROW) return out;
  sh.getRange(SAL_FIRST_ROW, 1, sh.getLastRow() - SAL_FIRST_ROW + 1, 5).getValues().forEach(function (r) {
    var d = salDate_(r[0]);
    if (!d || d.getFullYear() !== mo.y || d.getMonth() + 1 !== mo.m) return;
    out.push({ day: d.getDate(), name: salStr_(r[1]) || 'Holiday', site: salKey_(r[2]), desig: salKey_(r[3]),
               ids: salStr_(r[4]) ? salStr_(r[4]).split(/[\s,;]+/).filter(String) : [] });
  });
  return out;
}

function salFirms_(ss) {
  var sh = ss.getSheetByName(SAL_FIRMS);
  if (!sh || sh.getLastRow() < SAL_FIRST_ROW) return [];
  return sh.getRange(SAL_FIRST_ROW, 1, sh.getLastRow() - SAL_FIRST_ROW + 1, 1).getValues().map(function (r) { return salStr_(r[0]); }).filter(String);
}

/* ---------------- the ledger ---------------- */

function salReadLedger_(ss) {
  var sh = ss.getSheetByName(SAL_LEDGER), out = [];
  if (!sh || sh.getLastRow() < SAL_FIRST_ROW) return out;
  sh.getRange(SAL_FIRST_ROW, 1, sh.getLastRow() - SAL_FIRST_ROW + 1, 14).getValues().forEach(function (r, i) {
    var no = salStr_(r[LG.NO]), type = salStr_(r[LG.TYPE]);
    if (!no && !salStr_(r[LG.ID])) return;
    var from = salMonth_(r[LG.FROM]);
    out.push({ row: SAL_FIRST_ROW + i, no: no, date: salDate_(r[LG.DATE]), id: salStr_(r[LG.ID]), name: salStr_(r[LG.NAME]), site: salStr_(r[LG.SITE]),
               type: type, amount: salNum_(r[LG.AMT]) || 0, months: Math.max(1, Math.round(salNum_(r[LG.MONTHS]) || 1)),
               from: from ? from.key : '', against: salStr_(r[LG.AGAINST]), note: salStr_(r[LG.NOTE]), by: salStr_(r[LG.BY]), at: r[LG.AT] });
  });
  return out;
}

function salIsAuto_(type) { return type === SAL_TYPE_RECOVERED || type === SAL_TYPE_PAID; }
function salIsAddition_(type) { return type === 'Bonus'; }

/** Each entry's recovered / paid total, counting only months before `beforeKey` (all when blank). */
function salSettled_(entries, beforeKey) {
  var out = {};
  entries.forEach(function (e) {
    if (!salIsAuto_(e.type) || !e.against) return;
    if (beforeKey && e.from >= beforeKey) return;
    out[e.against] = (out[e.against] || 0) + e.amount;
  });
  return out;
}

/** Rewrites "Still due ₹" for every entry row (blank on the automatic rows). */
function salRefreshDue_(ss, entries) {
  var sh = ss.getSheetByName(SAL_LEDGER);
  if (!sh || !entries.length) return;
  var done = salSettled_(entries, ''), first = entries[0].row, last = entries[entries.length - 1].row;
  var col = [];
  for (var r = first; r <= last; r++) col.push(['']);
  entries.forEach(function (e) {
    if (salIsAuto_(e.type)) return;
    col[e.row - first][0] = Math.max(0, salRound2_(e.amount - (done[e.no] || 0)));
  });
  sh.getRange(first, LG.DUE + 1, col.length, 1).setValues(col);
}

/* ---------------- attendance for a month ---------------- */

/**
 * Every person's marks for the month, all site tabs together: one mark per day (Full beats Half beats
 * Absent, so someone on two sites is never counted twice), plus what still needs HR.
 */
function salAttendance_(ss, mo, upTo) {
  var out = {}, len = daysInMonth_(mo.y, mo.m), rank = { FD: 3, HD: 2, A: 1 };
  SITES.forEach(function (site) {
    var sh = ss.getSheetByName(yearTabName_(site, mo.y));
    if (!sh || sh.getLastRow() < FIRST_DATA_ROW) return;
    var n = sh.getLastRow() - FIRST_DATA_ROW + 1;
    var ids = sh.getRange(FIRST_DATA_ROW, 1, n, 1).getValues();
    var rng = sh.getRange(FIRST_DATA_ROW, dayCol_(mo.y, mo.m, 1), n, len);
    var vals = rng.getValues(), bgs = rng.getBackgrounds();
    for (var r = 0; r < n; r++) {
      var id = salStr_(ids[r][0]);
      if (!id) continue;
      var p = out[id] || (out[id] = { days: [], purple: 0, pending: 0, unmarked: 0, sites: [] });
      if (p.sites.indexOf(site) === -1) p.sites.push(site);
      for (var d = 0; d < upTo; d++) {
        var code = salStr_(vals[r][d]).toUpperCase(), bg = String(bgs[r][d]).toLowerCase();
        if (bg === CLR_MISMATCH) p.purple++;
        if (!rank[code]) continue;
        if (!p.days[d] || rank[code] > rank[p.days[d]]) p.days[d] = code;
        if (bg === CLR_PENDING || bg === CLR_SENTBACK) p.pending++;
      }
    }
  });
  Object.keys(out).forEach(function (id) {
    var p = out[id], f = 0, h = 0, a = 0, u = 0;
    for (var d = 0; d < upTo; d++) { var c = p.days[d]; if (c === 'FD') f++; else if (c === 'HD') h++; else if (c === 'A') a++; else u++; }
    p.f = f; p.h = h; p.a = a; p.u = u;
  });
  return out;
}

/* ---------------- the calculation ---------------- */

/**
 * The month's salary for everyone, not written anywhere. Returns
 * { rows, problems, totals, byFirm, bySite, purple, ended, days }.
 */
function salCompute_(ss, mo) {
  var t = todayParts_(), D = daysInMonth_(mo.y, mo.m);
  var started = mo.y < t.year || (mo.y === t.year && mo.m <= t.month);
  if (!started) throw new Error(mo.long + ' has not started yet.');
  var ended = mo.y < t.year || (mo.y === t.year && mo.m < t.month);
  var upTo = ended ? D : t.day;
  var people = salPeople_(), setup = salReadSetup_(ss), rules = salReadRules_(ss), hols = salReadHolidays_(ss, mo);
  var att = salAttendance_(ss, mo, upTo), ledger = salReadLedger_(ss), done = salSettled_(ledger, mo.key);
  var monthStart = new Date(mo.y, mo.m - 1, 1), monthEnd = new Date(mo.y, mo.m - 1, D);
  var sundays = [];
  for (var d = 1; d <= upTo; d++) if (new Date(mo.y, mo.m - 1, d).getDay() === 0) sundays.push(d);

  // money waiting per person: bonus for this month, recoveries due (oldest first)
  var money = {};
  ledger.forEach(function (e) {
    if (salIsAuto_(e.type) || !e.id || !e.from || e.from > mo.key) return;
    var left = salRound2_(e.amount - (done[e.no] || 0));
    if (left <= 0) return;
    if (salIsAddition_(e.type) && e.from !== mo.key) return;   // a bonus belongs to its own month
    (money[e.id] = money[e.id] || []).push({ e: e, left: left });
  });
  Object.keys(money).forEach(function (id) { money[id].sort(function (a, b) { return (a.e.date || 0) - (b.e.date || 0) || a.e.no.localeCompare(b.e.no); }); });

  var rows = [], problems = {}, purpleTotal = 0;
  var note = function (k, label, row, blocker) {
    var p = problems[k] || (problems[k] = { k: k, label: label, n: 0, ids: [], blocker: !!blocker });
    p.n++; if (p.ids.length < 2000) p.ids.push(row.id);
  };

  Object.keys(people).forEach(function (id) {
    var P = people[id], A = att[id] || { f: 0, h: 0, a: 0, u: upTo, purple: 0, pending: 0, days: [] }, own = setup[id] || {};
    var present = A.f + A.h * 0.5;
    if (!P.active && present === 0 && !money[id]) return;   // switched off, nothing this month
    var site = P.site, desig = P.designation;
    var pick = function (f) { return salPick_(own, rules, f, site, desig); };
    var basic = pick('basic').v, payType = pick('payType').v, paidAbs = Number(pick('paidAbsents').v) || 0;
    var sunPaid = pick('sundays').v === true, firm = pick('firm').v || '', mode = pick('mode').v || '';
    var guessed = false;
    if (!payType && basic !== null) { payType = basic > 2000 ? 'Monthly' : 'Daily'; guessed = true; }
    payType = SAL_PAY_TYPES.filter(function (x) { return x.toLowerCase() === salKey_(payType); })[0] || (payType ? 'Monthly' : '');
    var join = own.joining || null;
    if (join && join > monthEnd) return;   // joins after this month
    var joinDay = join && join >= monthStart ? join.getDate() : 0;
    var checks = [];

    var su = sunPaid ? sundays.filter(function (x) { return x >= (joinDay || 1); }).length : 0;
    var fe = 0;
    if (!joinDay) hols.forEach(function (h) {
      if (h.day > upTo) return;
      if (h.site && P.sites.map(salKey_).indexOf(h.site) === -1) return;
      if (h.desig && h.desig !== salKey_(desig)) return;
      if (h.ids.length && h.ids.indexOf(id) === -1) return;
      if (sunPaid && sundays.indexOf(h.day) > -1) return;   // already paid as a Sunday
      fe++;
    });
    var pa = joinDay ? 0 : paidAbs;
    if (present === 0 && (su || fe || pa)) { su = 0; fe = 0; pa = 0; checks.push('No day present — no paid days'); }
    var payable = salRound2_(present + su + fe + pa);

    var held = '';
    if (P.two) held = 'Held: ID ' + id + ' is used by two different people (' + P.names.join(', ') + ')';
    else if (basic === null || basic <= 0) held = 'Held: no basic pay in Salary Setup or Salary Rules';
    else if (!payType) held = 'Held: no pay type';

    var rate = 0, gross = 0;
    if (!held) {
      if (payType === 'Daily') { rate = basic; gross = Math.round(basic * payable); }
      else if (payType === 'Fixed') { rate = basic / D; gross = Math.round(basic); if (present === 0) checks.push('Fixed pay with no day present'); }
      else { rate = basic / D; gross = Math.round(basic / D * payable); }
    }

    // bonus in, then recoveries out (never below zero)
    var bonus = 0, ded = { Advance: 0, Petrol: 0, Loan: 0, Deduction: 0 }, takes = [], carried = 0;
    if (!held) {
      (money[id] || []).forEach(function (x) { if (salIsAddition_(x.e.type)) { bonus += x.left; takes.push({ no: x.e.no, type: x.e.type, amt: x.left }); } });
      var room = gross + bonus;
      (money[id] || []).forEach(function (x) {
        if (salIsAddition_(x.e.type)) return;
        var per = Math.ceil(x.e.amount / x.e.months), due = Math.min(x.left, per), take = Math.min(due, room);
        if (take > 0) { room -= take; ded[x.e.type in ded ? x.e.type : 'Deduction'] += take; takes.push({ no: x.e.no, type: x.e.type, amt: take }); }
        if (take < due) carried += due - take;
      });
      if (carried > 0) checks.push(salMoney_(carried) + ' of recoveries waits for next month (salary too small)');
    }
    var dedTotal = ded.Advance + ded.Petrol + ded.Loan + ded.Deduction;
    var net = held ? 0 : Math.max(0, gross + bonus - dedTotal);

    if (A.purple) checks.push(A.purple + ' purple day' + (A.purple > 1 ? 's' : '') + ' (punches don\'t match)');
    if (A.pending) checks.push(A.pending + ' day' + (A.pending > 1 ? 's' : '') + ' not approved by HR');
    if (A.u && P.active) checks.push(A.u + ' day' + (A.u > 1 ? 's' : '') + ' not marked');
    if (guessed) checks.push('Pay type guessed from the amount');
    if (!held && mode === 'Bank' && !own.account) checks.push('Bank, but no account no.');
    if (!P.active) checks.push('Switched off in Employees');

    var how = held ? held : (
      'Present ' + present + (A.h ? ' (' + A.f + ' full + ' + A.h + ' half)' : '') +
      (su ? ' + Sundays ' + su : '') + (fe ? ' + festivals ' + fe : '') + (pa ? ' + paid absents ' + pa : '') +
      ' = ' + payable + ' day' + (payable === 1 ? '' : 's') +
      (payType === 'Daily' ? ' × ' + salMoney_(basic) + '/day' :
       payType === 'Fixed' ? ' · fixed ' + salMoney_(basic) :
       ' × ' + salMoney_(basic) + ' ÷ ' + D) + ' = ' + salMoney_(gross) +
      (bonus ? ' + bonus ' + salMoney_(bonus) : '') +
      (dedTotal ? ' − recovered ' + salMoney_(dedTotal) : '') + ' → net ' + salMoney_(net));

    var row = {
      id: id, n: P.name, s: P.sites.join(' + '), site: site, d: desig, pt: payType || '', b: basic === null ? '' : basic,
      fd: A.f, hd: A.h, a: A.a, p: present, su: su, fe: fe, pa: pa, pd: payable, r: salRound2_(rate), g: gross,
      bo: bonus, ad: ded.Advance, pe: ded.Petrol, lo: ded.Loan, ot: ded.Deduction, net: net,
      f: firm, mo: mode, h: own.holder || '', ac: own.account || '', ifsc: own.ifsc || '',
      ck: (held ? [held] : []).concat(checks).join(' · '), how: how, held: !!held, takes: takes
    };
    rows.push(row);
    if (held) note(P.two ? 'two' : 'noBasic', P.two ? 'ID used by two different people — held' : 'No basic pay — held', row);
    if (A.purple) { note('purple', 'Purple days (punches don\'t match) — clear them before locking', row, true); purpleTotal += A.purple; }
    if (A.pending) note('pending', 'Days not yet approved by HR', row);
    if (A.u && P.active) note('unmarked', 'Days not marked', row);
    if (checks.some(function (c) { return /no account no/.test(c); })) note('noBank', 'Bank mode but no account no.', row);
    if (carried > 0) note('carried', 'Recoveries carried to next month', row);
    if (guessed) note('guessed', 'Pay type guessed from the amount (> ₹2,000 = Monthly)', row);
  });

  rows.sort(function (a, b) { return (SITES.indexOf(a.site) - SITES.indexOf(b.site)) || (Number(a.id) - Number(b.id)) || a.id.localeCompare(b.id); });
  var totals = { people: 0, held: 0, payable: 0, gross: 0, bonus: 0, ded: 0, net: 0, bank: 0, cash: 0 }, byFirm = {}, bySite = {};
  rows.forEach(function (r) {
    if (r.held) { totals.held++; return; }
    totals.people++; totals.payable = salRound2_(totals.payable + r.pd); totals.gross += r.g; totals.bonus += r.bo;
    totals.ded += r.ad + r.pe + r.lo + r.ot; totals.net += r.net;
    var cash = r.mo !== 'Bank';
    if (cash) totals.cash += r.net; else totals.bank += r.net;
    [[byFirm, r.f || (cash ? '(cash, no firm)' : '(no firm)')], [bySite, r.site]].forEach(function (x) {
      var o = x[0][x[1]] || (x[0][x[1]] = { k: x[1], people: 0, bank: 0, cash: 0, net: 0 });
      o.people++; o.net += r.net; if (cash) o.cash += r.net; else o.bank += r.net;
    });
  });
  var order = { purple: 0, two: 1, noBasic: 2, noBank: 3, carried: 4, guessed: 5, pending: 6, unmarked: 7 };
  return {
    rows: rows, totals: totals, days: D, upTo: upTo, ended: ended, purple: purpleTotal,
    problems: Object.keys(problems).map(function (k) { return problems[k]; }).sort(function (a, b) { return order[a.k] - order[b.k]; }),
    byFirm: Object.keys(byFirm).map(function (k) { return byFirm[k]; }).sort(function (a, b) { return b.net - a.net; }),
    bySite: SITES.filter(function (s) { return bySite[s]; }).map(function (s) { return bySite[s]; })
  };
}

/* ---------------- the month tab ---------------- */

var SAL_RUN_COLS = [
  ['Emp ID', 'id', 70], ['Name', 'n', 200], ['Site', 's', 95], ['Designation', 'd', 140], ['Pay type', 'pt', 72], ['Basic ₹', 'b', 80, 'money'],
  ['Full days', 'fd', 58, 'num'], ['Half days', 'hd', 58, 'num'], ['Absent', 'a', 58, 'num'], ['Present', 'p', 62, 'num'], ['Sundays', 'su', 62, 'num'],
  ['Festivals', 'fe', 66, 'num'], ['Paid absents', 'pa', 66, 'num'], ['Payable days', 'pd', 72, 'num'],
  ['Rate / day ₹', 'r', 80, 'rate'], ['Gross ₹', 'g', 88, 'money'], ['Bonus ₹', 'bo', 72, 'money'], ['Advance ₹', 'ad', 76, 'money'],
  ['Petrol ₹', 'pe', 72, 'money'], ['Loan EMI ₹', 'lo', 76, 'money'], ['Other ₹', 'ot', 72, 'money'], ['Net pay ₹', 'net', 96, 'money'],
  ['Firm', 'f', 190], ['Bank / Cash', 'mo', 70], ['Account holder', 'h', 170], ['Account no.', 'ac', 140], ['IFSC', 'ifsc', 100],
  ['Check', 'ck', 260], ['How it was worked out', 'how', 520]
];
var SAL_RUN_GROUPS = [[1, 6, 'Employee'], [7, 14, 'Attendance → payable days'], [15, 22, 'Pay'], [23, 27, 'Paid by'], [28, 29, 'Notes']];
var SAL_RUN_GROUP_BG = ['#E9E4D8', '#E3EEF8', SAL_WASH, '#EDE7F6', '#F3F0EA'];
function salRunCol_(k) { for (var i = 0; i < SAL_RUN_COLS.length; i++) if (SAL_RUN_COLS[i][1] === k) return i + 1; return 0; }

/** Writes the month's tab: title, KPI strip, groups, header, rows, total, then "By firm" and "By site". */
function salWriteRun_(ss, mo, res, state) {
  var name = salTabName_(mo), sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.setTabColor(SAL_INK); }
  else { sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function (p) { p.remove(); }); sh.clear(); }
  var N = SAL_RUN_COLS.length, rows = res.rows, n = rows.length;
  var need = SAL_RUN_FIRST + n + 6 + Math.max(res.byFirm.length, res.bySite.length) + 4;
  if (sh.getMaxRows() < need) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows());
  if (sh.getMaxColumns() < N) sh.insertColumnsAfter(sh.getMaxColumns(), N - sh.getMaxColumns());
  sh.getRange(1, 1, need, N).setFontFamily('Inter').setFontSize(10).setVerticalAlignment('middle');

  // 1: title + status
  var locked = state && state.state === 'locked';
  sh.getRange(1, 1).setValue('Salary · ' + mo.long).setFontSize(16).setFontWeight('bold').setFontColor(SAL_INK);
  sh.getRange(1, 6).setValue((locked ? 'LOCKED' : 'DRAFT') + ' · made by ' + state.by + ', ' + state.atText + (locked ? ' · locked by ' + state.lockedBy + ', ' + state.lockedText : '') +
    ' · ' + res.days + ' days in the month' + (res.ended ? '' : ' · month not over: counted to day ' + res.upTo))
    .setFontColor(locked ? '#1E6B3A' : '#8A5A00').setFontWeight('bold');
  sh.getRange(1, 1, 1, N).setBackground(SAL_CREAM);
  // 2-3: KPI strip (label over value)
  var T = res.totals;
  var kpis = [['People paid', T.people], ['Held', T.held], ['Payable days', T.payable], ['Gross ₹', T.gross], ['Bonus ₹', T.bonus],
              ['Recovered ₹', T.ded], ['Net pay ₹', T.net], ['By bank ₹', T.bank], ['In cash ₹', T.cash]];
  var labels = [], values = [];
  kpis.forEach(function (k) { labels.push(k[0], ''); values.push(k[1], ''); });
  labels = labels.slice(0, N); values = values.slice(0, N);
  while (labels.length < N) { labels.push(''); values.push(''); }
  sh.getRange(2, 1, 1, N).setValues([labels]).setFontColor(SAL_SOFT).setFontSize(9).setBackground(SAL_CREAM);
  sh.getRange(3, 1, 1, N).setValues([values]).setFontSize(13).setFontWeight('bold').setFontColor(SAL_INK).setBackground(SAL_CREAM)
    .setNumberFormat(SAL_MONEY).setHorizontalAlignment('left');
  sh.getRange(3, 3, 1, 1).setNumberFormat('0');
  sh.getRange(3, 5, 1, 1).setNumberFormat('#,##0.##');
  sh.getRange(3, 13, 1, 2).setBackground(SAL_OK);
  sh.getRange(2, 13, 1, 2).setBackground(SAL_OK);
  // 4: groups
  var gv = [], gb = [];
  for (var c = 0; c < N; c++) { gv.push(''); gb.push('#FFFFFF'); }
  SAL_RUN_GROUPS.forEach(function (g, i) { gv[g[0] - 1] = g[2]; for (var c2 = g[0] - 1; c2 < g[1]; c2++) gb[c2] = SAL_RUN_GROUP_BG[i]; });
  sh.getRange(4, 1, 1, N).setValues([gv]).setBackgrounds([gb]).setFontWeight('bold').setFontColor(SAL_INK).setFontSize(9);
  // 5: header
  sh.getRange(SAL_RUN_HEAD, 1, 1, N).setValues([SAL_RUN_COLS.map(function (x) { return x[0]; })])
    .setBackground(SAL_INK).setFontColor('#FFFFFF').setFontWeight('bold').setWrap(true).setHorizontalAlignment('center');
  sh.getRange(SAL_RUN_HEAD, salRunCol_('net')).setBackground('#1E6B3A');
  sh.setRowHeight(1, 36); sh.setRowHeight(3, 28); sh.setRowHeight(SAL_RUN_HEAD, 42);

  // rows
  if (n) {
    var vals = rows.map(function (r) { return SAL_RUN_COLS.map(function (x) { var v = r[x[1]]; return v === undefined || v === null ? '' : v; }); });
    var bgs = rows.map(function (r, i) {
      var base = r.held ? SAL_BAD : (i % 2 ? '#FFFFFF' : SAL_CREAM);
      return SAL_RUN_COLS.map(function (x) { return x[1] === 'net' && !r.held ? SAL_OK : x[1] === 'ck' && r.ck ? (r.held ? SAL_BAD : '#FFF4D6') : base; });
    });
    var body = sh.getRange(SAL_RUN_FIRST, 1, n, N);
    body.setValues(vals).setBackgrounds(bgs).setFontColor(SAL_INK);
    SAL_RUN_COLS.forEach(function (x, i) {
      var col = sh.getRange(SAL_RUN_FIRST, i + 1, n + 1, 1);
      if (x[3] === 'money') col.setNumberFormat(SAL_MONEY).setHorizontalAlignment('right');
      else if (x[3] === 'rate') col.setNumberFormat('#,##0.00').setHorizontalAlignment('right');
      else if (x[3] === 'num') col.setNumberFormat('0.##').setHorizontalAlignment('center');
    });
    sh.getRange(SAL_RUN_FIRST, salRunCol_('ac'), n, 1).setNumberFormat('@');
    sh.getRange(SAL_RUN_FIRST, salRunCol_('net'), n, 1).setFontWeight('bold');
    sh.getRange(SAL_RUN_FIRST, salRunCol_('ck'), n, 1).setFontColor('#8A3A1E').setWrap(false);
    sh.getRange(SAL_RUN_FIRST, salRunCol_('how'), n, 1).setFontColor(SAL_SOFT).setWrap(false);
  }
  // total row
  var tr = SAL_RUN_FIRST + n, tot = [];
  SAL_RUN_COLS.forEach(function (x) {
    if (x[1] === 'id') tot.push('TOTAL');
    else if (x[1] === 'n') tot.push(T.people + ' paid' + (T.held ? ' · ' + T.held + ' held' : ''));
    else if (['fd', 'hd', 'a', 'p', 'su', 'fe', 'pa', 'pd', 'g', 'bo', 'ad', 'pe', 'lo', 'ot', 'net'].indexOf(x[1]) > -1)
      tot.push(salRound2_(rows.reduce(function (s, r) { return r.held ? s : s + (Number(r[x[1]]) || 0); }, 0)));
    else tot.push('');
  });
  sh.getRange(tr, 1, 1, N).setValues([tot]).setBackground(SAL_INK).setFontColor('#FFFFFF').setFontWeight('bold');
  sh.getRange(tr, salRunCol_('net')).setBackground('#1E6B3A');

  // By firm · By site (side by side under the table)
  var sr = tr + 3;
  var block = function (col, title, list) {
    sh.getRange(sr, col).setValue(title).setFontWeight('bold').setFontSize(12).setFontColor(SAL_INK);
    var head = [['', 'People', 'By bank ₹', 'In cash ₹', 'Net ₹']];
    sh.getRange(sr + 1, col, 1, 5).setValues(head).setBackground(SAL_INK).setFontColor('#FFFFFF').setFontWeight('bold');
    if (!list.length) return;
    var body = list.map(function (o) { return [o.k, o.people, o.bank, o.cash, o.net]; });
    body.push(['Total', list.reduce(function (s, o) { return s + o.people; }, 0), list.reduce(function (s, o) { return s + o.bank; }, 0),
               list.reduce(function (s, o) { return s + o.cash; }, 0), list.reduce(function (s, o) { return s + o.net; }, 0)]);
    sh.getRange(sr + 2, col, body.length, 5).setValues(body).setBackground(SAL_CREAM);
    sh.getRange(sr + 2, col + 2, body.length, 3).setNumberFormat(SAL_MONEY);
    sh.getRange(sr + 1 + body.length, col, 1, 5).setFontWeight('bold').setBackground(SAL_WASH);
  };
  block(2, 'By firm', res.byFirm);
  block(9, 'By site', res.bySite);

  sh.setFrozenRows(SAL_RUN_HEAD);
  sh.setFrozenColumns(2);
  SAL_RUN_COLS.forEach(function (x, i) { sh.setColumnWidth(i + 1, x[2]); });
  sh.setHiddenGridlines(true);
  if (locked) salProtect_(sh, 'Salary ' + mo.label + ' is locked — unlock it in the app (Admin) to change it.');
  return sh;
}

function salProtect_(sh, why) {
  var p = sh.protect().setDescription(why);
  try {
    var me = Session.getEffectiveUser();
    p.addEditor(me);
    p.removeEditors(p.getEditors().filter(function (u) { return u.getEmail() !== me.getEmail(); }));
    if (p.canDomainEdit()) p.setDomainEdit(false);
  } catch (e) { p.setWarningOnly(true); }
}

/** Rows written in a month tab, back as objects (for the app). */
function salReadRun_(ss, mo, n) {
  var sh = ss.getSheetByName(salTabName_(mo));
  if (!sh || !n) return [];
  return sh.getRange(SAL_RUN_FIRST, 1, n, SAL_RUN_COLS.length).getValues().map(function (r) {
    var o = {};
    SAL_RUN_COLS.forEach(function (x, i) { o[x[1]] = r[i] instanceof Date ? salIso_(r[i]) : r[i]; });
    o.id = salStr_(o.id); o.held = /^Held:/.test(String(o.ck));
    o.site = String(o.s).split(' + ')[0];
    return o;
  });
}

/* ---------------- what the app calls ---------------- */

function salMonthOf_(ym) {
  var mo = salMonth_(ym);
  if (!mo) throw new Error('Pick a month.');
  return mo;
}

/** One month's salary screen: state, totals, problems and rows (read from the month tab). */
function salaryHome(token, ym) {
  var user = salUser_(token), mo = salMonthOf_(ym), ss = ss_(), st = salState_(mo), t = todayParts_();
  var ended = mo.y < t.year || (mo.y === t.year && mo.m < t.month);
  var started = mo.y < t.year || (mo.y === t.year && mo.m <= t.month);
  var out = salHomeBase_(user, mo, st, ended, started);
  if (st && ss.getSheetByName(salTabName_(mo))) {
    out.rows = salReadRun_(ss, mo, st.n || 0).map(salSlim_);
    out.totals = st.totals || null; out.problems = st.problems || []; out.byFirm = st.byFirm || []; out.bySite = st.bySite || [];
  }
  return out;
}

function salHomeBase_(user, mo, st, ended, started) {
  var all = scopeSites_(user).length >= SITES.length;
  var latestLocked = salLatestLocked_();
  return {
    ok: true, ym: mo.key, label: mo.long, state: st ? st.state : 'none', by: st ? st.by : '', at: st ? st.atText : '',
    lockedBy: st ? st.lockedBy || '' : '', lockedAt: st ? st.lockedText || '' : '', ended: ended, started: started,
    canMake: all && started && (!st || st.state !== 'locked'),
    canLock: all && ended && !!st && st.state === 'draft' && (user.role === 'Accounts' || user.role === 'Admin'),
    canUnlock: !!st && st.state === 'locked' && user.role === 'Admin' && latestLocked === mo.key,
    tab: salTabName_(mo), sheetUrl: ss_().getUrl ? ss_().getUrl() : '',
    rows: [], totals: null, problems: [], byFirm: [], bySite: []
  };
}

function salSlim_(r) {
  return { id: r.id, n: r.n, s: r.s, d: r.d, pt: r.pt, b: r.b, fd: r.fd, hd: r.hd, a: r.a, p: r.p, su: r.su, fe: r.fe, pa: r.pa, pd: r.pd,
           r: r.r, g: r.g, bo: r.bo, ad: r.ad, pe: r.pe, lo: r.lo, ot: r.ot, net: r.net, f: r.f, mo: r.mo, ck: r.ck, how: r.how, held: !!r.held };
}

function salLatestLocked_() {
  var props = PropertiesService.getScriptProperties().getProperties(), best = '';
  Object.keys(props).forEach(function (k) {
    if (k.indexOf('SAL_STATE_') !== 0) return;
    try { var s = JSON.parse(props[k]); if (s && s.state === 'locked' && k.slice(10) > best) best = k.slice(10); } catch (e) {}
  });
  return best;
}

function salStateFrom_(res, user, prev) {
  var now = new Date();
  return {
    state: prev && prev.state === 'locked' ? 'locked' : 'draft', by: user.name || user.username, atText: Utilities.formatDate(now, TZ, 'dd/MM/yyyy HH:mm'),
    n: res.rows.length, totals: res.totals,
    problems: res.problems.map(function (p) { return { k: p.k, label: p.label, n: p.n, ids: p.ids.slice(0, 1500), blocker: p.blocker }; }),
    byFirm: res.byFirm, bySite: res.bySite, net: res.totals.net, purple: res.purple
  };
}

/** Make (or make again) a month's salary. HR, Accounts, Admin. A locked month cannot be made again. */
function makeSalary(token, ym) {
  var user = salUser_(token);
  salAllSites_(user);
  var mo = salMonthOf_(ym), ss = ss_();
  var lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch (e) { return { ok: false, error: 'Server busy, try again.' }; }
  try {
    var prev = salState_(mo);
    if (prev && prev.state === 'locked') return { ok: false, error: mo.long + ' is locked. An Admin must unlock it first.' };
    salSetup_(ss);
    var res = salCompute_(ss, mo), st = salStateFrom_(res, user, null);
    var pm = salMonth_(mo.m === 1 ? (mo.y - 1) + '-12' : mo.y + '-' + (mo.m - 1)), ps = salState_(pm);
    if (ps && ps.state !== 'locked') st.problems.unshift({ k: 'prev', label: pm.long + ' is not locked yet: its recoveries are not counted, so they show again here', n: 0, ids: [], blocker: false });
    salWriteRun_(ss, mo, res, st);
    salSetState_(mo, st);
    SpreadsheetApp.flush();
    logAudit_({ action: 'SALARY_MADE', value: mo.label + ' · ' + res.totals.people + ' paid · net ' + salMoney_(res.totals.net), byUser: user.username, byRole: user.role });
    var t = todayParts_(), ended = mo.y < t.year || (mo.y === t.year && mo.m < t.month);
    var out = salHomeBase_(user, mo, st, ended, true);
    out.rows = res.rows.map(salSlim_); out.totals = st.totals; out.problems = st.problems; out.byFirm = st.byFirm; out.bySite = st.bySite;
    return out;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Lock a finished month (Accounts / Admin): works it out again; if anything changed since it was made the
 * tab is rewritten and nothing is locked. Otherwise the recoveries go into the ledger and the tab is protected.
 */
function lockSalary(token, ym) {
  var user = salUser_(token, ['Accounts', 'Admin']);
  salAllSites_(user);
  var mo = salMonthOf_(ym), ss = ss_(), t = todayParts_();
  if (!(mo.y < t.year || (mo.y === t.year && mo.m < t.month))) return { ok: false, error: mo.long + ' is not over yet. Lock it once the month has ended.' };
  var lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch (e) { return { ok: false, error: 'Server busy, try again.' }; }
  try {
    var st = salState_(mo);
    if (!st) return { ok: false, error: 'Make the salary first.' };
    if (st.state === 'locked') return { ok: false, error: mo.long + ' is already locked.' };
    var res = salCompute_(ss, mo);
    if (res.purple) return { ok: false, error: res.purple + ' purple day' + (res.purple > 1 ? 's' : '') + ' (punches don\'t match) in ' + mo.long + '. HR must clear them in Verify first.' };
    if (Math.round(res.totals.net) !== Math.round(st.net) || res.rows.length !== st.n) {
      var again = salStateFrom_(res, user, null);
      salWriteRun_(ss, mo, res, again); salSetState_(mo, again);
      return { ok: false, changed: true, error: 'Attendance or advances changed since the salary was made (net was ' + salMoney_(st.net) + ', now ' + salMoney_(res.totals.net) + '). It has been made again — check it and lock again.' };
    }
    // recoveries and paid bonuses → ledger
    var lg = ss.getSheetByName(SAL_LEDGER), entries = salReadLedger_(ss), next = salNextNo_(entries), now = new Date(), add = [];
    res.rows.forEach(function (r) {
      (r.takes || []).forEach(function (x) {
        add.push(['A-' + ('000' + next++).slice(-4), now, r.id, r.n, r.site, salIsAddition_(x.type) ? SAL_TYPE_PAID : SAL_TYPE_RECOVERED, x.amt, '', mo.label, '', x.no,
                  (salIsAddition_(x.type) ? 'Bonus paid with ' : x.type + ' recovered from ') + mo.label + ' salary', user.username, now]);
      });
    });
    if (add.length) lg.getRange(salLedgerEnd_(lg), 1, add.length, 14).setValues(add);
    st.state = 'locked'; st.lockedBy = user.name || user.username; st.lockedText = Utilities.formatDate(now, TZ, 'dd/MM/yyyy HH:mm');
    salWriteRun_(ss, mo, res, st);
    salSetState_(mo, st);
    salRefreshDue_(ss, salReadLedger_(ss));
    SpreadsheetApp.flush();
    logAudit_({ action: 'SALARY_LOCKED', value: mo.label + ' · net ' + salMoney_(res.totals.net) + ' · ' + add.length + ' ledger rows', byUser: user.username, byRole: user.role });
    return salaryHome(token, ym);
  } finally {
    lock.releaseLock();
  }
}

/** Admin: unlock the newest locked month — its ledger rows are taken out again. */
function unlockSalary(token, ym) {
  var user = salUser_(token, ['Admin']);
  var mo = salMonthOf_(ym), ss = ss_();
  var lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch (e) { return { ok: false, error: 'Server busy, try again.' }; }
  try {
    var st = salState_(mo);
    if (!st || st.state !== 'locked') return { ok: false, error: mo.long + ' is not locked.' };
    if (salLatestLocked_() !== mo.key) return { ok: false, error: 'Unlock the newest locked month first.' };
    var lg = ss.getSheetByName(SAL_LEDGER), entries = salReadLedger_(ss);
    entries.filter(function (e) { return salIsAuto_(e.type) && e.from === mo.key; }).map(function (e) { return e.row; })
      .sort(function (a, b) { return b - a; }).forEach(function (r) { lg.deleteRow(r); });
    st.state = 'draft'; delete st.lockedBy; delete st.lockedText;
    salSetState_(mo, st);
    var sh = ss.getSheetByName(salTabName_(mo));
    if (sh) {
      sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function (p) { p.remove(); });
      sh.getRange(1, 6).setValue('DRAFT (unlocked by ' + user.username + ', ' + Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm') + ') · make it again before locking').setFontColor('#8A5A00');
    }
    salRefreshDue_(ss, salReadLedger_(ss));
    logAudit_({ action: 'SALARY_UNLOCKED', value: mo.label, byUser: user.username, byRole: user.role });
    return salaryHome(token, ym);
  } finally {
    lock.releaseLock();
  }
}

/* ---------------- advances & loans in the app ---------------- */

function salNextNo_(entries) {
  var max = 0;
  entries.forEach(function (e) { var m = String(e.no).match(/(\d+)$/); if (m) max = Math.max(max, Number(m[1])); });
  return max + 1;
}
function salLedgerEnd_(sh) {
  var last = sh.getLastRow();
  if (last < SAL_FIRST_ROW) return SAL_FIRST_ROW;
  var col = sh.getRange(SAL_FIRST_ROW, 1, last - SAL_FIRST_ROW + 1, 3).getValues();
  for (var i = col.length - 1; i >= 0; i--) if (salStr_(col[i][0]) || salStr_(col[i][2])) return SAL_FIRST_ROW + i + 1;
  return SAL_FIRST_ROW;
}

/** The ledger for the app: every entry with what is still due, and the people to pick from. */
function advancesData(token) {
  salUser_(token);
  var ss = ss_();
  if (!ss.getSheetByName(SAL_LEDGER)) salSetup_(ss);
  var entries = salReadLedger_(ss), done = salSettled_(entries, '');
  var list = entries.map(function (e) {
    return { no: e.no, date: salIso_(e.date), id: e.id, n: e.name, s: e.site, type: e.type, amt: e.amount, months: e.months, from: e.from,
             due: salIsAuto_(e.type) ? 0 : Math.max(0, salRound2_(e.amount - (done[e.no] || 0))), against: e.against, note: e.note, by: e.by, auto: salIsAuto_(e.type) };
  });
  var people = employeesAll_().filter(function (e) { return e.active; }).map(function (e) { return { id: e.id, n: e.name, s: e.site }; });
  var locked = {};
  Object.keys(PropertiesService.getScriptProperties().getProperties()).forEach(function (k) {
    if (k.indexOf('SAL_STATE_') === 0) { var s = salState_(salMonth_(k.slice(10))); if (s && s.state === 'locked') locked[k.slice(10)] = true; }
  });
  return { ok: true, entries: list, people: people, locked: Object.keys(locked), types: SAL_TYPES_GIVE };
}

/**
 * o = { id, type, amount, date: 'yyyy-mm-dd', months, from: 'yyyy-mm', note }. HR, Accounts, Admin.
 * months 1 = all from one salary; more = split. A bonus is paid with the "from" month's salary.
 */
function addAdvance(token, o) {
  var user = salUser_(token);
  o = o || {};
  var id = salStr_(o.id), type = salStr_(o.type), amt = salNum_(o.amount), months = Math.round(salNum_(o.months) || 1), from = salMonth_(o.from);
  var date = salDate_(o.date) || new Date();
  if (SAL_TYPES_GIVE.indexOf(type) === -1) return { ok: false, error: 'Pick a type.' };
  if (!amt || amt <= 0 || amt > 1000000) return { ok: false, error: 'Enter an amount between ₹1 and ₹10,00,000.' };
  if (Math.round(amt * 100) !== Math.round(amt) * 100) return { ok: false, error: 'Enter the amount in whole rupees.' };
  if (!from) return { ok: false, error: 'Pick the salary month to start from.' };
  if (salIsAddition_(type)) months = 1;
  if (!(months >= 1 && months <= 60)) return { ok: false, error: 'Recover over 1 to 60 months.' };
  var st = salState_(from);
  if (st && st.state === 'locked') return { ok: false, error: from.long + ' salary is already locked. Start from a later month.' };
  var p = salPeople_()[id];
  if (!p) return { ok: false, error: 'No employee with ID ' + id + '.' };
  var ss = ss_();
  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) { return { ok: false, error: 'Server busy, try again.' }; }
  try {
    if (!ss.getSheetByName(SAL_LEDGER)) salSetup_(ss);
    var lg = ss.getSheetByName(SAL_LEDGER), entries = salReadLedger_(ss), no = 'A-' + ('000' + salNextNo_(entries)).slice(-4);
    lg.getRange(salLedgerEnd_(lg), 1, 1, 14).setValues([[no, date, id, p.name, p.site, type, amt, months, from.label, amt, '', salStr_(o.note).slice(0, 300), user.username, new Date()]]);
    SpreadsheetApp.flush();
    logAudit_({ site: p.site, employeeId: id, employeeName: p.name, action: 'ADVANCE_ADDED', value: no + ' · ' + type + ' ' + salMoney_(amt) + ' · ' + (months > 1 ? months + ' months' : 'one salary') + ' from ' + from.label, byUser: user.username, byRole: user.role });
  } finally {
    lock.releaseLock();
  }
  var out = advancesData(token);
  out.added = true;
  return out;
}

/** Remove an entry typed by mistake — only while nothing has been recovered against it. */
function deleteAdvance(token, no) {
  var user = salUser_(token);
  var ss = ss_(), lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) { return { ok: false, error: 'Server busy, try again.' }; }
  try {
    var entries = salReadLedger_(ss), e = entries.filter(function (x) { return x.no === no && !salIsAuto_(x.type); })[0];
    if (!e) return { ok: false, error: 'Entry ' + no + ' was not found.' };
    if (entries.some(function (x) { return salIsAuto_(x.type) && x.against === no; })) return { ok: false, error: 'Something has already been recovered against ' + no + ' — it stays. Add a "Deduction" or "Bonus" to correct it.' };
    ss.getSheetByName(SAL_LEDGER).deleteRow(e.row);
    logAudit_({ site: e.site, employeeId: e.id, employeeName: e.name, action: 'ADVANCE_DELETED', value: no + ' · ' + e.type + ' ' + salMoney_(e.amount), byUser: user.username, byRole: user.role });
  } finally {
    lock.releaseLock();
  }
  return advancesData(token);
}
