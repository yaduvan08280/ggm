/*******************************************************
 * Punch.gs — the biometric punch report against the marks.
 *
 * HR uploads the punching machine's "Daily Punch Report" (xlsx) in the app.
 * The phone reads it and sends, per employee and day, the first and last
 * punch (minutes after midnight) and how many punches there were. Here each
 * marked day cell on the site tabs is compared with that:
 *   no punch                       → should be Absent
 *   one punch (length unknown)     → should be Full or Half day
 *   first→last ≥ full-day hours    → should be Full day
 *   ≥ half-day hours               → should be Half day
 *   less                           → Half day or Absent
 * A mark that does not fit gets a bright red font; one that fits goes back to
 * black, so uploading again after a correction clears the red. Blank cells
 * (not marked) are left alone and only counted. Hours per site: Settings F / G.
 *******************************************************/

var CLR_PUNCH_DIFF = '#ff0000';
var CLR_PUNCH_OK = '#000000';

/** "540,1085,2" → which statuses fit those punches. */
function punchExpect_(p, cfg) {
  if (!p) return { fit: ['Absent'], label: 'no punch' };
  var x = String(p).split(','), first = Number(x[0]), last = Number(x[1]), count = Number(x[2]) || 1;
  if (count < 2 || last <= first) return { fit: ['Full Day', 'Half Day'], label: 'one punch ' + punchTime_(first) };
  var mins = last - first, label = punchTime_(first) + '–' + punchTime_(last) + ' (' + Math.floor(mins / 60) + 'h' + ('0' + (mins % 60)).slice(-2) + ')';
  if (mins >= cfg.fdHours * 60) return { fit: ['Full Day'], label: label };
  if (mins >= cfg.hdHours * 60) return { fit: ['Half Day'], label: label };
  return { fit: ['Half Day', 'Absent'], label: label };
}

function punchTime_(m) {
  var h = Math.floor(m / 60), mm = m % 60, ap = h >= 12 ? 'PM' : 'AM', h12 = h % 12 || 12;
  return h12 + ':' + ('0' + mm).slice(-2) + ' ' + ap;
}

/**
 * payload = { file, dates: ['yyyy-MM-dd', …], rows: [{ id, d: ['first,last,count' | '', … one per date] }] }
 * Only the uploader's sites and days up to today are touched.
 */
function uploadPunchReport(token, payload) {
  var user = requireRole_(token, ['HR', 'Admin']);
  payload = payload || {};
  var dates = (payload.dates || []).map(String), rows = payload.rows || [];
  if (!dates.length || !rows.length) return { ok: false, error: 'No dates or employees were found in that file.' };
  if (dates.length > 62 || rows.length > 5000) return { ok: false, error: 'That file is too big for one upload (more than 2 months or 5000 people).' };
  if (!dates.every(function (d) { return /^\d{4}-\d{2}-\d{2}$/.test(d); })) return { ok: false, error: 'Could not read the dates in the header row.' };

  var t = todayParts_(), sites = scopeSites_(user), ss = ss_();
  var report = {};
  rows.forEach(function (r) { var id = String(r.id == null ? '' : r.id).trim(); if (id) report[id] = r.d || []; });

  // which date columns, per year, are in the past or today
  var byYear = {};
  dates.forEach(function (d, i) {
    var p = d.split('-').map(Number);
    if (p[0] > t.year || (p[0] === t.year && dayOfYear_(p[0], p[1], p[2]) > t.doy)) return;
    (byYear[p[0]] = byYear[p[0]] || []).push({ i: i, doy: dayOfYear_(p[0], p[1], p[2]), iso: d });
  });

  var out = { ok: true, compared: 0, different: 0, notMarked: 0, matched: 0, list: [], sites: {}, file: String(payload.file || '') };
  var onTabs = {};
  var lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch (e) { return { ok: false, error: 'Server busy, try again.' }; }
  try {
    sites.forEach(function (site) {
      var cfg = getSiteSetting_(site), s = out.sites[site] = { compared: 0, different: 0 };
      Object.keys(byYear).forEach(function (y) {
        var year = Number(y), days = byYear[y];
        var sh = ss.getSheetByName(yearTabName_(site, year));
        if (!sh || sh.getLastRow() < FIRST_DATA_ROW) return;
        var n = sh.getLastRow() - FIRST_DATA_ROW + 1;
        var lo = Math.min.apply(null, days.map(function (d) { return d.doy; }));
        var hi = Math.max.apply(null, days.map(function (d) { return d.doy; }));
        var idNames = sh.getRange(FIRST_DATA_ROW, 1, n, 2).getValues();
        var rng = sh.getRange(FIRST_DATA_ROW, FIRST_DAY_COL + lo - 1, n, hi - lo + 1);
        var vals = rng.getValues(), fonts = rng.getFontColors(), touched = false;
        for (var r = 0; r < n; r++) {
          var id = String(idNames[r][0] == null ? '' : idNames[r][0]).trim();
          if (!id || !report[id]) continue;
          onTabs[id] = true;
          days.forEach(function (d) {
            var c = d.doy - lo, status = statusFromCode_(vals[r][c]), punch = report[id][d.i] || '';
            if (!status) { if (punch) out.notMarked++; return; }
            var exp = punchExpect_(punch, cfg), bad = exp.fit.indexOf(status) === -1;
            var want = bad ? CLR_PUNCH_DIFF : CLR_PUNCH_OK;
            if (String(fonts[r][c]).toLowerCase() !== want) { fonts[r][c] = want; touched = true; }
            out.compared++; s.compared++;
            if (!bad) { out.matched++; return; }
            out.different++; s.different++;
            if (out.list.length < 3000) out.list.push({ s: site, id: id, n: String(idNames[r][1]), date: d.iso, marked: status, punch: exp.label, fit: exp.fit.join(' or ') });
          });
        }
        if (touched) rng.setFontColors(fonts);
      });
    });
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  out.notOnAttendance = Object.keys(report).filter(function (id) { return !onTabs[id]; }).length;
  out.dateFrom = dates[0]; out.dateTo = dates[dates.length - 1];
  logAudit_({ action: 'PUNCH_UPLOAD', value: out.file + ' · ' + out.compared + ' compared · ' + out.different + ' different', byUser: user.username, byRole: user.role });
  return out;
}
