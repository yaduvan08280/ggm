/*******************************************************
 * Fast.gs — the speed layer.
 *
 * Every screen used to re-read the Employees, Users and
 * Settings tabs and the day column of each site on every
 * call (and the supervisor screen polls every 30 seconds).
 * Now each is read once and kept in the script cache:
 *   - a write made through the app updates or drops the copy at once
 *   - a hand edit in the sheet shows within the CACHE_* seconds in Config.gs
 *******************************************************/

var MEMO_ = {};   // per request: the same tab is never read twice in one call

/** JSON from the script cache; values over 90 KB are stored in parts. */
function cacheGetJson_(key) {
  if (MEMO_.hasOwnProperty(key)) return MEMO_[key];
  var c = CacheService.getScriptCache();
  var raw = c.get(key);
  if (raw === null) return null;
  if (raw.indexOf('#parts:') === 0) {
    var n = Number(raw.slice(7)), ks = [];
    for (var i = 0; i < n; i++) ks.push(key + '#' + i);
    var got = c.getAll(ks), parts = [];
    for (var j = 0; j < n; j++) {
      if (got[ks[j]] == null) return null;
      parts.push(got[ks[j]]);
    }
    raw = parts.join('');
  }
  try { return (MEMO_[key] = JSON.parse(raw)); } catch (e) { return null; }
}

function cachePutJson_(key, obj, seconds) {
  MEMO_[key] = obj;
  var s = JSON.stringify(obj), c = CacheService.getScriptCache();
  try {
    if (s.length < 90000) { c.put(key, s, seconds); return; }
    var put = {}, n = 0;
    for (var i = 0; i < s.length; i += 90000) put[key + '#' + (n++)] = s.substr(i, 90000);
    put[key] = '#parts:' + n;
    c.putAll(put, seconds);
  } catch (e) { /* too big for the cache: it is simply read from the sheet next time */ }
}

function cacheDrop_(key) {
  delete MEMO_[key];
  try { CacheService.getScriptCache().remove(key); } catch (e) {}
}

/* ---------------- Settings tab ---------------- */

/** { site: { closingTime, refreshSeconds, lockLogin, allowResubmit, row } } */
function settingsAll_() {
  var hit = cacheGetJson_('ATT_SETTINGS');
  if (hit) return hit;
  var out = {};
  var sh = ss_().getSheetByName(SHEET_SETTINGS);
  if (sh && sh.getLastRow() >= 2) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 8).getValues().forEach(function (r, i) {
      var site = String(r[0]).trim();
      if (!site || out[site]) return;
      out[site] = {
        closingTime: normalizeTime_(r[1]) || DEFAULT_CLOSING_TIME,
        refreshSeconds: Number(r[2]) || DEFAULT_REFRESH_SEC,
        lockLogin: isTruthy_(r[3]),
        allowResubmit: isTruthy_(r[4]),
        fdHours: Number(r[5]) > 0 ? Number(r[5]) : DEFAULT_FD_HOURS,
        hdHours: Number(r[6]) > 0 ? Number(r[6]) : DEFAULT_HD_HOURS,
        autoAbsent: r[7] === '' || r[7] === null || isTruthy_(r[7]),   // H, blank = on
        row: i + 2
      };
    });
  }
  cachePutJson_('ATT_SETTINGS', out, CACHE_SETTINGS_SEC);
  return out;
}

/* ---------------- Employees tab ---------------- */

/** Every employee row: { id, name, site, supervisor, designation, active, row } */
function employeesAll_() {
  var hit = cacheGetJson_('ATT_EMP');
  if (hit) return hit;
  var out = [];
  var sh = ss_().getSheetByName(SHEET_EMPLOYEES);
  if (sh && sh.getLastRow() >= 2) {
    sh.getRange(2, 1, sh.getLastRow() - 1, EMP_COL_COUNT).getValues().forEach(function (r, i) {
      var id = String(r[EMP_COL_ID - 1] == null ? '' : r[EMP_COL_ID - 1]).trim();
      if (!id) return;
      out.push({
        id: id,
        name: String(r[EMP_COL_NAME - 1] == null ? '' : r[EMP_COL_NAME - 1]),
        site: String(r[EMP_COL_SITE - 1]).trim(),
        supervisor: String(r[EMP_COL_SUPERVISOR - 1] || '').trim(),
        designation: String(r[EMP_COL_DESIG - 1] || ''),
        active: isTruthy_(r[EMP_COL_ACTIVE - 1]),
        secondary: secondarySite_(r[EMP_COL_SECONDARY - 1], r[EMP_COL_SITE - 1]),
        row: i + 2
      });
    });
  }
  cachePutJson_('ATT_EMP', out, CACHE_EMP_SEC);
  return out;
}

/** A Secondary Site cell as one of SITES: '' when blank, not a site, or the main site itself. */
function secondarySite_(value, site) {
  var v = String(value || '').trim().toLowerCase();
  var hit = SITES.filter(function (x) { return x.toLowerCase() === v; })[0] || '';
  return hit === String(site || '').trim() ? '' : hit;
}

/** Active people whose secondary site is this one (their main site's sheet holds their marks). */
function visitorsAt_(site) {
  return employeesAll_().filter(function (e) { return e.active && e.secondary === site && SITES.indexOf(e.site) > -1; });
}

function dropEmployees_() {
  cacheDrop_('ATT_EMP');
  Object.keys(MEMO_).forEach(function (k) { if (k.indexOf('empSite_') === 0) delete MEMO_[k]; });
}

/* ---------------- today's column of one site ---------------- */

function dayKey_(site, iso) { return 'ATT_DAY_' + site + '_' + iso; }

/**
 * Today's rows for one site: [{ row, id, name, status, approval, inactive }].
 * One sheet read per site per CACHE_DAY_SEC, however many people are polling.
 */
function dayRows_(site) {
  var t = todayParts_();
  var key = dayKey_(site, t.iso);
  var hit = cacheGetJson_(key);
  if (hit) return hit;
  var ctx = todaySheet_(ss_(), site);
  var rows = readDayRows_(readDayBlock_(ctx.sh, ctx.col), true);
  cachePutJson_(key, rows, CACHE_DAY_SEC);
  return rows;
}

function dropDay_(site) { cacheDrop_(dayKey_(site, todayParts_().iso)); }

/** After a write: change the cached copy in place, so the next poll is still instant. */
function patchDay_(site, employeeId, status, approval) {
  var key = dayKey_(site, todayParts_().iso);
  var rows = cacheGetJson_(key);
  if (!rows) return;
  var id = String(employeeId).trim(), hit = false;
  rows.forEach(function (r) {
    if (r.id !== id) return;
    r.status = status; r.approval = approval; hit = true;
  });
  if (hit) cachePutJson_(key, rows, CACHE_DAY_SEC); else cacheDrop_(key);
}

/** After a status change today: move one day between that person's month totals (Record tab copy). */
function patchRecord_(site, employeeId, oldStatus, newStatus) {
  var t = todayParts_(), key = 'ATT_REC_' + site + '_' + t.year + '_' + t.month;
  var rows = cacheGetJson_(key);
  if (!rows) return;
  var k = { 'Full Day': 'f', 'Half Day': 'h', 'Absent': 'a' }, id = String(employeeId).trim();
  rows.forEach(function (r) {
    if (r.id !== id) return;
    if (k[oldStatus]) r[k[oldStatus]] = Math.max(0, r[k[oldStatus]] - 1);
    if (k[newStatus]) r[k[newStatus]]++;
    r.u = r.off ? 0 : Math.max(0, t.day - r.f - r.h - r.a);
  });
  cachePutJson_(key, rows, 300);
}

/** Sheet row of an employee on today's tab — from the cached copy, checked against the sheet. */
function rowOf_(sh, site, employeeId) {
  var id = String(employeeId).trim();
  var cached = (cacheGetJson_(dayKey_(site, todayParts_().iso)) || []).filter(function (r) { return r.id === id; })[0];
  if (cached && String(sh.getRange(cached.row, 1).getValue()).trim() === id) return cached.row;
  return empRowMap_(sh)[id] || 0;
}
