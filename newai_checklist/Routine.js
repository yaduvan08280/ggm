// =========================================================================
//  CHECKLIST (ROUTINE) TASKS — read from and saved to the Master tab
//
//  The app used to save into an "MM" tab. That tab was removed on 31 Oct 2026,
//  so every Done after 08:35 that day was thrown away while the app still said
//  "updated". Now:
//   - a Done / note is written straight into Master, on the row with that Task ID
//     (column D, unique), and copied to the same Task ID in Monthly Master so that
//     tab is right during the day too (it is rebuilt from Master every night);
//   - if a task cannot be saved the app is told so, nothing is reported as saved;
//   - the person's rows come from a copy of Master kept in the script cache, built
//     in one pass and patched on every save, so loading takes about a second;
//   - a W/M/Q/Y task can be marked from RT_EARLY_DAYS before its date, and only the
//     oldest open one of the same task (so next week's row is not ticked by mistake).
// =========================================================================

var RT_EARLY_DAYS = 6;      // a W/M/Q/Y task can be marked this many days before its date
var RT_AHEAD_DAYS = 40;     // upcoming W/M/Q/Y tasks are listed this far ahead
var RT_TTL = 21600;         // cache seconds (the copy is patched on saves and dropped on sheet edits)
var RT_CHUNK = 25000;       // characters per cache value: Hindi is 3 bytes a character, a value is max 100 KB
var RT_DAY = 86400000;

/** Same cleaning as _isNameMatch: "NEWAI - DEEPAK SHARMA (STORE)" → "DEEPAK SHARMA". */
function _rtKey(name) {
  return String(name || '').toUpperCase().replace(/^NEWAI\s*-\s*/, '').replace(/\(.*?\)/g, '').trim();
}

/** Cache keys a Master name is filed under: its clean name, plus its mobile if the name holds one. */
function _rtRowKeys(name) {
  var keys = [_rtKey(name)];
  var m = String(name || '').match(/\d{10}/);
  if (m) keys.push('M:' + m[0]);
  return keys;
}

/** Cache keys for a person: their name, Doer List names on the same mobile, and the mobile. */
function _rtUserKeys(names, mobile) {
  var keys = [], seen = {};
  names.concat(mobile ? ['M:' + ckDigits_(mobile)] : []).forEach(function (n) {
    var k = String(n).indexOf('M:') === 0 ? n : _rtKey(n);
    if (k && k !== 'M:' && !seen[k]) { seen[k] = true; keys.push(k); }
  });
  return keys;
}

/** The signed-in person, as the routine code needs them. */
function _rtUser(name, mobile) {
  var names = [String(name || '').trim()];
  var ph = ckDigits_(mobile);
  if (ph.length >= 10) ckDoerRows_().forEach(function (r) {
    if (ckDigits_(r.mobile) === ph && names.indexOf(r.name) === -1) names.push(r.name);
  });
  return { name: names[0], aliases: names.map(function (n) { return n.toLowerCase(); }), mobile: String(mobile || '').trim(), keys: _rtUserKeys(names, mobile) };
}

function _rtEpoch() {
  var c = _cache(), e = c.get('NEWAI_RT_EP');
  if (!e) { e = String(Date.now()); c.put('NEWAI_RT_EP', e, RT_TTL); }
  return e + '|' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd');   // a new day rebuilds
}

/** Drops the cached copy (sheet edited by hand, rows added, nightly rebuild). */
function _rtReset() {
  try { _cache().put('NEWAI_RT_EP', String(Date.now()), RT_TTL); } catch (e) {}
}

/** Master → { key: [record] }. record = [row, id, freq, title, planned dd/MM/yyyy, actual, status, remark, name]. */
function _rtBuild() {
  var groups = {};
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Master');
  if (!sh || sh.getLastRow() < 2) return groups;
  var tz = Session.getScriptTimeZone();
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 12).getValues();
  var now = new Date();
  var today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  var monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  var monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
  var ahead = today0 + RT_AHEAD_DAYS * RT_DAY;
  for (var i = 0; i < vals.length; i++) {
    var r = vals[i], name = String(r[0] || '').trim();
    if (!name) continue;
    var st = String(r[8] || '').trim(), stl = st.toLowerCase();
    if (stl === 'cancelled') continue;
    var d = parseServerDate(r[6]), ms = d ? d.getTime() : null;
    var freq = String(r[4] || 'NA').toUpperCase().trim();
    var daily = freq === 'D' || freq === 'DAILY';
    var open = stl !== 'done' && stl !== 'completed' && stl !== 'review';
    var thisMonth = ms !== null && ms >= monthStart && ms < monthEnd;
    // what the app shows: this month (stats + done list), anything in review,
    // and open W/M/Q/Y tasks that are overdue or due within RT_AHEAD_DAYS
    if (!(thisMonth || stl === 'review' || (open && !daily && (ms === null || ms < ahead)))) continue;
    var actual = r[7] instanceof Date ? Utilities.formatDate(r[7], tz, 'dd/MM/yyyy hh:mm a') : String(r[7] || '').trim();
    var rec = [i + 2, String(r[3] || '').trim(), freq, String(r[5] || ''),
               d ? Utilities.formatDate(d, tz, 'dd/MM/yyyy') : String(r[6] || '').trim(),
               actual, st, String(r[11] || '').trim(), name];
    _rtRowKeys(name).forEach(function (k) { (groups[k] = groups[k] || []).push(rec); });
  }
  return groups;
}

function _rtStore(groups, ep) {
  var c = _cache(), idx = {}, batch = {}, n = 0, i = 0;
  var flush = function () { if (n) { c.putAll(batch, RT_TTL); batch = {}; n = 0; } };
  Object.keys(groups).forEach(function (k) {
    var s = JSON.stringify(groups[k]), parts = Math.ceil(s.length / RT_CHUNK) || 1;
    idx[k] = i + ':' + parts;
    for (var p = 0; p < parts; p++) {
      batch['RT|' + ep + '|' + i + '|' + p] = s.substr(p * RT_CHUNK, RT_CHUNK);
      if (++n >= 20) flush();
    }
    i++;
  });
  flush();
  c.put('RT|' + ep + '|map', JSON.stringify(idx), RT_TTL);   // written last: only a complete copy is ever read
}

/** The records for these keys from the cache, or null when the copy is missing. */
function _rtFromCache(keys) {
  try {
    var c = _cache(), ep = _rtEpoch();
    var raw = c.get('RT|' + ep + '|map');
    if (!raw) return null;
    var idx = JSON.parse(raw), want = [];
    keys.forEach(function (k) {
      if (!idx[k]) return;
      var a = idx[k].split(':');
      for (var p = 0; p < +a[1]; p++) want.push('RT|' + ep + '|' + a[0] + '|' + p);
    });
    if (!want.length) return { recs: [], idx: idx, ep: ep };
    var got = c.getAll(want), out = [], seen = {};
    for (var w = 0, k2 = 0; k2 < keys.length; k2++) {
      if (!idx[keys[k2]]) continue;
      var parts = +idx[keys[k2]].split(':')[1], s = '';
      for (var q = 0; q < parts; q++, w++) {
        if (got[want[w]] == null) return null;   // part evicted: rebuild
        s += got[want[w]];
      }
      JSON.parse(s).forEach(function (rec) { if (!seen[rec[0]]) { seen[rec[0]] = true; out.push(rec); } });
    }
    return { recs: out, idx: idx, ep: ep };
  } catch (e) { return null; }
}

/** The person's records: from the cache, else one read of Master (stored for everyone). */
function _rtLoad(keys) {
  var hit = _rtFromCache(keys);
  if (hit) return hit.recs;
  var lock = LockService.getScriptLock(), locked = false;
  try { locked = lock.tryLock(30000); } catch (e) {}
  try {
    if (locked) { hit = _rtFromCache(keys); if (hit) return hit.recs; }
    var ep = _rtEpoch();                       // read before the sheet: an edit meanwhile starts a new copy
    var groups = _rtBuild();
    if (locked) { try { _rtStore(groups, ep); } catch (e) { console.error('_rtStore: ' + e); } }
    var out = [], seen = {};
    keys.forEach(function (k) {
      (groups[k] || []).forEach(function (rec) { if (!seen[rec[0]]) { seen[rec[0]] = true; out.push(rec); } });
    });
    return out;
  } finally { if (locked) lock.releaseLock(); }
}

/** A record shaped like a Master row (A..L), for the existing read loop. */
function _rtAsRow(rec) {
  var row = [rec[8], '', '', rec[1], rec[2], rec[3], rec[4], rec[5], rec[6], '', '', rec[7]];
  row.rowNum = rec[0];
  return row;
}

/** After a save: the same change in the cached copy (called while holding the script lock). */
function _rtPatch(name, row, actual, status, remark) {
  var keys = _rtRowKeys(name), hit = _rtFromCache(keys);
  if (!hit) return;
  var c = _cache();
  keys.forEach(function (k) {
    if (!hit.idx[k]) return;
    var a = hit.idx[k].split(':'), base = 'RT|' + hit.ep + '|' + a[0] + '|';
    var s = '';
    for (var p = 0; p < +a[1]; p++) { var part = c.get(base + p); if (part == null) { _rtReset(); return; } s += part; }
    var recs = JSON.parse(s), changed = false;
    recs.forEach(function (rec) {
      if (rec[0] !== row) return;
      if (actual !== null) rec[5] = actual;
      if (status !== null) rec[6] = status;
      if (remark !== null) rec[7] = remark;
      changed = true;
    });
    if (!changed) return;
    var out = JSON.stringify(recs), parts = Math.ceil(out.length / RT_CHUNK) || 1;
    if (parts !== +a[1]) { _rtReset(); return; }  // size of this person's block changed: rebuild on next load
    var map = {};
    for (var q = 0; q < parts; q++) map[base + q] = out.substr(q * RT_CHUNK, RT_CHUNK);
    c.putAll(map, RT_TTL);
  });
}

/** The Master row for a task the signed-in person owns: { row, vals } or { why }. */
function _rtFindRow(sh, id, qTitle, qDate, tz, user) {
  var row = -1;
  if (id && id.indexOf('ROW_') !== 0 && sh.getLastRow() > 1) {
    var f = sh.getRange(2, 4, sh.getLastRow() - 1, 1).createTextFinder(id).matchEntireCell(true).findNext();
    if (f) row = f.getRow();
  }
  if (row < 2) row = _findTargetRow(sh, 'routine', 'ROW_', qTitle, user.name.toUpperCase(), qDate, tz);
  if (row < 2) return { why: 'This task is no longer in the sheet. Refresh and try again.' };
  var v = sh.getRange(row, 1, 1, 12).getValues()[0];
  if (!_isNameMatch(v[0], user.name.toLowerCase(), user.aliases, user.mobile)) return { why: 'This task belongs to someone else.' };
  return { row: row, vals: v };
}

/** '' when the task may be marked done now, else why not. */
function _rtTooEarly(hit, user, tz) {
  var v = hit.vals, freq = String(v[4] || '').toUpperCase().trim();
  if (freq === 'D' || freq === 'DAILY') return '';
  var d = parseServerDate(v[6]);
  if (!d) return '';
  var now = new Date(), today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  var due0 = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  if (due0 - today0 > RT_EARLY_DAYS * RT_DAY) {
    return 'Too early: this task can be marked from ' + Utilities.formatDate(new Date(due0 - RT_EARLY_DAYS * RT_DAY), tz, 'dd/MM/yyyy') + '.';
  }
  var cached = _rtFromCache(user.keys);
  if (!cached) return '';
  var title = _cleanTaskName(v[5]), older = null;
  cached.recs.forEach(function (rec) {
    if (rec[0] === hit.row || _cleanTaskName(rec[3]) !== title) return;
    var st = String(rec[6] || '').toLowerCase();
    if (st === 'done' || st === 'completed' || st === 'review') return;
    var od = parseServerDate(rec[4]);
    if (od && od.getTime() < due0 && (!older || od.getTime() < older.getTime())) older = od;
  });
  return older ? 'Finish the one due ' + Utilities.formatDate(older, tz, 'dd/MM/yyyy') + ' first.' : '';
}

/** Same change on the Monthly Master row with this Task ID (that tab is rebuilt from Master nightly). */
function _rtMirror(ss, id, doneAt, status, remark) {
  try {
    var mm = ss.getSheetByName('Monthly Master');
    if (!mm || mm.getLastRow() < 2 || !id) return;
    var f = mm.getRange(2, 4, mm.getLastRow() - 1, 1).createTextFinder(id).matchEntireCell(true).findNext();
    if (!f) return;
    if (status) mm.getRange(f.getRow(), 8, 1, 2).setValues([[doneAt, status]]);
    if (remark !== null) mm.getRange(f.getRow(), 12).setValue(remark);
  } catch (e) { console.error('_rtMirror: ' + e); }
}

/**
 * Editor check, read-only (writes nothing to the sheet): builds the cached copy from the live
 * Master, loads every Doer List person the way the app does, times it, and finds one open task
 * of each person by Task ID the way a save does. Run it from the editor and read the log.
 */
function newaiSelfTest() {
  portalAssertEditor_();
  var tz = Session.getScriptTimeZone(), master = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Master');
  _rtReset();
  var t0 = Date.now(), lines = [], bad = 0;
  ckDoerRows_().forEach(function (p, i) {
    var t1 = Date.now(), u = _rtUser(p.name, p.mobile), recs = _rtLoad(u.keys), ms = Date.now() - t1;
    var open = recs.filter(function (r) { var s = String(r[6]).toLowerCase(); return s !== 'done' && s !== 'completed' && r[1]; })[0];
    var found = '';
    if (open) {
      var hit = _rtFindRow(master, String(open[1]).toUpperCase(), '', '', tz, u);
      found = hit.row === open[0] ? 'ID ' + open[1] + ' → row ' + hit.row + ' ok' : 'ID ' + open[1] + ' FAILED: ' + (hit.why || 'row ' + hit.row + ' ≠ ' + open[0]);
      if (hit.row !== open[0]) bad++;
    }
    lines.push((i ? '' : '[first load builds the copy] ') + p.name + ': ' + recs.length + ' rows, ' + ms + ' ms ' + found);
  });
  var t2 = Date.now(); _rtLoad(_rtUser(ckDoerRows_()[0].name, ckDoerRows_()[0].mobile).keys);
  lines.push('repeat load from cache: ' + (Date.now() - t2) + ' ms; whole run ' + (Date.now() - t0) + ' ms; lookups failed: ' + bad);
  console.log(lines.join('\n'));
  return lines.join('\n');
}
