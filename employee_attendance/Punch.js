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
 * The machine's "Muster Report" works too: its day cells already hold the machine's
 * verdict (FD / HD / A), which is compared with the mark as it is. WO (week off) and
 * "-" say nothing about the day and are skipped, and so is today's column of a muster
 * report (the machine's verdict for today changes while people are still punching).
 *
 * The upload IS HR's check (13 Nov 2026): a mark that fits the punches turns green
 * (approved), one that does not turns purple (CLR_MISMATCH) - whatever colour either
 * had before. Purple waits for HR in the app ("Approve all" leaves it alone); after a
 * correction, uploading again turns it green. HR can still approve / send back by hand.
 * The text is set back to black (until 13 Nov 2026 a mismatch was red text).
 * A purple cell gets a note with what the report says (file, punches, mark, what fits);
 * our note is removed again once the mark fits. A note already on the cell (auto Absent, HR's own) is kept
 * below ours (punchNote_). Every list on the result screen comes
 * back (fit, different, punched-but-not-marked, people not on the attendance).
 * A blank (not marked) day on which the report shows the person punched in also turns
 * purple with a note ("Marked: nothing"); a blank day without punches is left alone, and
 * so are switched-off (grey) cells.
 * Hours per site: Settings F / G.
 *******************************************************/

var CLR_PUNCH_TEXT = '#000000';

var PUNCH_CODES = { FD: ['Full Day'], HD: ['Half Day'], A: ['Absent'], P: ['Full Day', 'Half Day'] };
var PUNCH_SKIP = 'SKIP';   // a muster day with no verdict (WO, "-")

/** "540,1085,2" (or a muster code FD / HD / A / P) → which statuses fit. */
function punchExpect_(p, cfg) {
  if (PUNCH_CODES[p]) return { fit: PUNCH_CODES[p], label: 'machine: ' + p };
  if (!p) return { fit: ['Absent'], label: 'no punch' };
  var x = String(p).split(','), first = Number(x[0]), last = Number(x[1]), count = Number(x[2]) || 1;
  if (count < 2 || last <= first) return { fit: ['Full Day', 'Half Day'], label: 'one punch ' + punchTime_(first) };
  var mins = last - first, label = punchTime_(first) + '–' + punchTime_(last % 1440) + ' (' + Math.floor(mins / 60) + 'h' + ('0' + (mins % 60)).slice(-2) + (count > 2 ? ', ' + count + ' punches' : '') + ')';
  if (mins >= cfg.fdHours * 60) return { fit: ['Full Day'], label: label };
  if (mins >= cfg.hdHours * 60) return { fit: ['Half Day'], label: label };
  return { fit: ['Half Day', 'Absent'], label: label };
}

/**
 * The punch note goes on top of whatever note the cell already has (17 Nov 2026: purple cells that the
 * 8 PM auto Absent had noted "Auto-marked Absent: …" got no punch note at all). An earlier punch note of
 * ours is replaced; the other text stays below PUNCH_NOTE_SEP. body '' takes our part off again.
 */
var PUNCH_NOTE = 'Punch report', PUNCH_NOTE_SEP = '\n- - -\n';
function punchNote_(old, body) {
  old = String(old || '');
  var rest = old;
  if (old.indexOf(PUNCH_NOTE) === 0) { var k = old.indexOf(PUNCH_NOTE_SEP); rest = k === -1 ? '' : old.slice(k + PUNCH_NOTE_SEP.length); }
  if (!body) return rest;
  return rest ? body + PUNCH_NOTE_SEP + rest : body;
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

  var out = { ok: true, compared: 0, different: 0, notMarked: 0, matched: 0, approved: 0, skipped: 0, list: [], fit: [], unmarked: [], sites: {}, file: String(payload.file || '') };
  var onTabs = {};
  var stamp = PUNCH_NOTE + ' (' + String(payload.file || 'file') + ', ' + Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm') + ', ' + user.username + ')';
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
        var vals = rng.getValues(), fonts = rng.getFontColors(), bgs = rng.getBackgrounds(), notes = rng.getNotes(), touchedF = false, touchedB = false, touchedN = false;
        for (var r = 0; r < n; r++) {
          var id = String(idNames[r][0] == null ? '' : idNames[r][0]).trim();
          if (!id || !report[id]) continue;
          onTabs[id] = true;
          days.forEach(function (d) {
            var c = d.doy - lo, status = statusFromCode_(vals[r][c]), punch = report[id][d.i] || '';
            if (punch === PUNCH_SKIP || (PUNCH_CODES[punch] && d.iso === t.iso)) { out.skipped++; return; }
            if (!status) {
              if (punch && punch !== 'A') {
                var ex0 = punchExpect_(punch, cfg), bg0 = String(bgs[r][c]).toLowerCase();
                if (bg0 !== CLR_INACTIVE) {
                  if (bg0 !== CLR_MISMATCH) { bgs[r][c] = CLR_MISMATCH; touchedB = true; }
                  var n0 = String(notes[r][c] || ''), w0 = punchNote_(n0, stamp + '\nPunches: ' + ex0.label + '\nMarked: nothing\nPunches fit: ' + ex0.fit.join(' or '));
                  if (n0 !== w0) { notes[r][c] = w0; touchedN = true; }
                }
                out.notMarked++;
                if (out.unmarked.length < 8000) out.unmarked.push({ s: site, id: id, n: String(idNames[r][1]), date: d.iso, punch: ex0.label });
              }
              return;
            }
            var exp = punchExpect_(punch, cfg), bad = exp.fit.indexOf(status) === -1;
            if (String(fonts[r][c]).toLowerCase() !== CLR_PUNCH_TEXT) { fonts[r][c] = CLR_PUNCH_TEXT; touchedF = true; }
            var bg = String(bgs[r][c]).toLowerCase();
            if (bg !== CLR_INACTIVE) {
              var want = bad ? CLR_MISMATCH : CLR_APPROVED;
              if (bg !== want) { bgs[r][c] = want; touchedB = true; if (!bad) out.approved++; }
            }
            var note = String(notes[r][c] || '');
            if (bad) {
              var want2 = punchNote_(note, stamp + '\nPunches: ' + exp.label + '\nMarked: ' + status + '\nPunches fit: ' + exp.fit.join(' or '));
              if (note !== want2) { notes[r][c] = want2; touchedN = true; }
            } else if (note.indexOf(PUNCH_NOTE) === 0) { notes[r][c] = punchNote_(note, ''); touchedN = true; }
            out.compared++; s.compared++;
            if (!bad) {
              out.matched++;
              if (out.fit.length < 8000) out.fit.push({ s: site, id: id, n: String(idNames[r][1]), date: d.iso, marked: status, punch: exp.label });
              return;
            }
            out.different++; s.different++;
            if (out.list.length < 3000) out.list.push({ s: site, id: id, n: String(idNames[r][1]), date: d.iso, marked: status, punch: exp.label, fit: exp.fit.join(' or ') });
          });
        }
        if (touchedF) rng.setFontColors(fonts);
        if (touchedN) rng.setNotes(notes);
        if (touchedB) { rng.setBackgrounds(bgs); if (year === t.year) dropDay_(site); }
      });
    });
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  out.missing = Object.keys(report).filter(function (id) { return !onTabs[id]; });
  out.notOnAttendance = out.missing.length;
  out.dateFrom = dates[0]; out.dateTo = dates[dates.length - 1];
  logAudit_({ action: 'PUNCH_UPLOAD', value: out.file + ' · ' + out.compared + ' compared · ' + out.matched + ' fit (green) · ' + out.different + ' different (purple)', byUser: user.username, byRole: user.role });
  return out;
}
