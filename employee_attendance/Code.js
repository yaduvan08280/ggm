/*******************************************************
 * Code.gs — web app entry point + shared helpers.
 *******************************************************/

function doGet(e) {
  var t = HtmlService.createTemplateFromFile('Index');
  var boot = null;
  try { boot = attPortalBoot_(e); } catch (err) { boot = { error: String(err.message || err) }; }
  t.boot = safeJson_(boot);
  // GGM Portal's language choice and profile photos (GgmLogin.gs), same as the other apps
  t.portalTags = '<script>window.PORTAL_CFG=' + safeJson_({ app: GGM_APP.id, boot: boot && boot.lang ? { lang: boot.lang } : null }) +
    ';window.PORTAL={boot:' + safeJson_(boot && boot.me ? boot.me : null) + '};</script>' + portalPhotoTag_() + portalLangTag_();
  return t.evaluate()
    .setTitle(APP_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover')
    .addMetaTag('mobile-web-app-capable', 'yes')
    .addMetaTag('apple-mobile-web-app-capable', 'yes')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** JSON that is safe inside a <script> tag. */
function safeJson_(o) {
  var ls = new RegExp(String.fromCharCode(8232), 'g'), ps = new RegExp(String.fromCharCode(8233), 'g');
  return JSON.stringify(o === undefined ? null : o)
    .replace(/</g, '\\u003c').replace(ls, '\\u2028').replace(ps, '\\u2029');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/* ---------- small shared utilities ---------- */

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

/** A1 notation without burning an API call (getRange().getA1Notation() is a round trip). */
function colLetter_(col) {
  var s = '';
  while (col > 0) {
    var m = (col - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    col = (col - m - 1) / 26;
  }
  return s;
}

function a1_(row, col, numRows, numCols) {
  return colLetter_(col) + row + ':' + colLetter_(col + numCols - 1) + (row + numRows - 1);
}

/* ---------- calendar helpers ---------- */

function isLeapYear_(y) {
  return (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0);
}

function daysInYear_(y) {
  return isLeapYear_(y) ? 366 : 365;
}

function daysInMonth_(year, month) {
  return new Date(year, month, 0).getDate();
}

/** Cumulative days before the 1st of each month, index 0 = January. */
function monthOffsets_(year) {
  var lens = [31, isLeapYear_(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  var out = [];
  var run = 0;
  for (var i = 0; i < 12; i++) { out.push(run); run += lens[i]; }
  return { offsets: out, lengths: lens };
}

/** 1-based day of year. month is 1-12. */
function dayOfYear_(year, month, day) {
  return monthOffsets_(year).offsets[month - 1] + day;
}

/** { month: 1-12, day: 1-31 } from a 1-based day of year. */
function fromDayOfYear_(year, doy) {
  var m = monthOffsets_(year);
  for (var i = 11; i >= 0; i--) {
    if (doy > m.offsets[i]) return { month: i + 1, day: doy - m.offsets[i] };
  }
  return { month: 1, day: 1 };
}

/** Sheet column holding a given date. */
function dayCol_(year, month, day) {
  return FIRST_DAY_COL + dayOfYear_(year, month, day) - 1;
}

function yearTabName_(site, year) {
  return site + '_' + year;
}

/** Site name if the tab is a yearly attendance tab, else null. */
function siteFromYearTab_(name) {
  var m = String(name).match(/^(.+)_(\d{4})$/);
  if (!m) return null;
  if (SITES.indexOf(m[1]) === -1) return null;
  return { site: m[1], year: Number(m[2]) };
}

function todayParts_() {
  var now = new Date();
  var s = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
  var p = s.split('-');
  var year = Number(p[0]), month = Number(p[1]), day = Number(p[2]);
  return {
    year: year, month: month, day: day, iso: s, now: now,
    doy: dayOfYear_(year, month, day)
  };
}

/* ---------- day cell helpers ---------- */

/** 'FD' -> 'Full Day'. Anything unrecognised -> null. */
function statusFromCode_(v) {
  var s = String(v == null ? '' : v).trim().toUpperCase();
  return CODE_TO_STATUS[s] || null;
}

function codeFromStatus_(status) {
  return STATUS_TO_CODE[status] || '';
}

/** Cell background -> approval state. */
function approvalFromColor_(hex) {
  var h = String(hex || '').trim().toLowerCase();
  if (h === CLR_APPROVED) return APPROVAL_APPROVED;
  if (h === CLR_SENTBACK) return APPROVAL_SENTBACK;
  return APPROVAL_PENDING;   // red, white and grey all mean "not approved"
}

function isInactiveColor_(hex) {
  return String(hex || '').trim().toLowerCase() === CLR_INACTIVE;
}

function isTruthy_(v) {
  if (v === true) return true;
  var s = String(v).trim().toLowerCase();
  return s === 'true' || s === 'yes' || s === 'y' || s === '1';
}

function logAudit_(entry) {
  try {
    var sh = ss_().getSheetByName(SHEET_AUDIT);
    if (!sh) return;
    sh.appendRow([
      new Date(), entry.site || '', entry.date || '', entry.employeeId || '',
      entry.employeeName || '', entry.action || '', entry.value || '',
      entry.byUser || '', entry.byRole || ''
    ]);
  } catch (err) {
    // audit failures must never break the actual operation
  }
}
