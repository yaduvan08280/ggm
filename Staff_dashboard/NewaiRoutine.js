// =========================================================================
//  NEWAI CHECKLIST TASKS IN THE STAFF DASHBOARD
//
//  Newai people (doer name "NEWAI - …") and the peons work their Newai checklist
//  here. It used to be read from the Newai "Monthly Master" tab and saved only
//  there, but that tab is rebuilt from Master every night, so ticks were lost,
//  and since 31 Oct 2026 only peons saw Newai tasks at all. Now (the same rules
//  as the Newai Checklist app, newai_checklist/Routine.js):
//   - tasks come from the Newai Master tab, matched by the Newai Doer List name on
//     the same mobile as the doer name (so "SUNIL JAT" finds "SUNIL CHOUDHARY");
//   - a Done / note is saved on the Master row with that Task ID (column D) and
//     copied to the same Task ID in Monthly Master; anything not saved is reported;
//   - a W/M/Q/Y task can be marked from NW_EARLY_DAYS before its date, and only the
//     oldest open one of the same task;
//   - the rows are kept in the script cache (one read of Master for everyone,
//     patched on every save here, rebuilt every NW_TTL seconds or on a new day).
// =========================================================================

var NW_EARLY_DAYS = 6;      // a W/M/Q/Y task can be marked this many days before its date
var NW_AHEAD_DAYS = 40;     // upcoming W/M/Q/Y tasks are listed this far ahead
var NW_TTL = 1800;          // cache seconds: edits made outside this app show within this time
var NW_CHUNK = 25000;       // characters per cache value: Hindi is 3 bytes a character, a value is max 100 KB
var NW_DAY = 86400000;
var NW_TZ = 'Asia/Kolkata';

function _nwDigits(v) { var d = String(v || '').replace(/\D/g, ''); return d.length > 10 ? d.slice(-10) : d; }

/** "NEWAI - DEEPAK SHARMA (STORE) - 9799019943" → "DEEPAK SHARMA". */
function _nwKey(name) {
  return String(name || '').toUpperCase().replace(/^\s*(NEWAI|JPR|TONK|KCL)\s*-\s*/, '')
    .replace(/\(.*?\)/g, ' ').replace(/-?\s*\+?\d[\d\s]{9,}$/, ' ').replace(/\s+/g, ' ').trim();
}

/** Cache keys a Master name is filed under: its clean name, plus its mobile if the name holds one. */
function _nwRowKeys(name) {
  var keys = [_nwKey(name)];
  var m = String(name || '').match(/\d{10}/);
  if (m) keys.push('M:' + m[0]);
  return keys;
}

/** True for the people who work the Newai checklist here. */
function _nwWanted(doer, isPeon) { return isPeon || /^\s*NEWAI\s*-/i.test(String(doer || '')); }

/** The signed-in person's cache keys: their clean doer name, the Doer List names on their mobile, the mobile. */
function _nwUserKeys(doer, phone, doers) {
  var p = staffDoerParts_(doer, phone), mob = p.mobile || _nwDigits(phone);
  var names = [p.name || staffCleanName_(doer)];
  if (mob.length >= 10) (doers || []).forEach(function (r) { if (_nwDigits(r[1]) === mob) names.push(r[0]); });
  var keys = [], seen = {};
  names.map(_nwKey).concat(mob.length >= 10 ? ['M:' + mob] : []).forEach(function (k) {
    if (k && !seen[k]) { seen[k] = true; keys.push(k); }
  });
  return keys;
}

function _nwEpoch() {
  var c = _cache(), e = c.get('NW_RT_EP');
  if (!e) { e = String(Date.now()); c.put('NW_RT_EP', e, NW_TTL); }
  return e + '|' + Utilities.formatDate(new Date(), NW_TZ, 'yyyyMMdd');   // a new day rebuilds
}

function _nwReset() { try { _cache().put('NW_RT_EP', String(Date.now()), NW_TTL); } catch (e) {} }

/** Newai Master → { groups: { key: [record] }, doers: [[name, mobile]] }.
 *  record = [row, id, freq, title, planned dd/MM/yyyy, actual dd/MM/yyyy HH:mm:ss, status, remark, name]. */
function _nwBuild() {
  var groups = {}, doers = [];
  var ss = SpreadsheetApp.openById(NEWAI_ROUTINE_SHEET_ID);
  var dl = ss.getSheetByName('Doer List');
  if (dl && dl.getLastRow() > 1) {
    doers = dl.getRange(2, 1, dl.getLastRow() - 1, 4).getValues()
      .filter(function (r) { return String(r[0] || '').trim(); })
      .map(function (r) { return [String(r[0]).trim(), _nwDigits(r[3])]; });
  }
  var sh = ss.getSheetByName('Master');
  if (!sh || sh.getLastRow() < 2) return { groups: groups, doers: doers };
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 12).getValues();
  var now = new Date();
  var today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  var monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  var monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
  var ahead = today0 + NW_AHEAD_DAYS * NW_DAY;
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
    // the same rows the Newai app shows: this month (stats + done list), anything in review,
    // and open W/M/Q/Y tasks that are overdue or due within NW_AHEAD_DAYS
    if (!(thisMonth || stl === 'review' || (open && !daily && (ms === null || ms < ahead)))) continue;
    var actual = r[7] instanceof Date ? Utilities.formatDate(r[7], NW_TZ, 'dd/MM/yyyy HH:mm:ss') : String(r[7] || '').trim();
    var rec = [i + 2, String(r[3] || '').trim(), freq, String(r[5] || ''),
               d ? Utilities.formatDate(d, NW_TZ, 'dd/MM/yyyy') : String(r[6] || '').trim(),
               actual, st, String(r[11] || '').trim(), name];
    _nwRowKeys(name).forEach(function (k) { (groups[k] = groups[k] || []).push(rec); });
  }
  return { groups: groups, doers: doers };
}

function _nwStore(built, ep) {
  var c = _cache(), idx = { '~doers': built.doers }, batch = {}, n = 0, i = 0;
  var flush = function () { if (n) { c.putAll(batch, NW_TTL); batch = {}; n = 0; } };
  Object.keys(built.groups).forEach(function (k) {
    var s = JSON.stringify(built.groups[k]), parts = Math.ceil(s.length / NW_CHUNK) || 1;
    idx[k] = i + ':' + parts;
    for (var p = 0; p < parts; p++) {
      batch['NW|' + ep + '|' + i + '|' + p] = s.substr(p * NW_CHUNK, NW_CHUNK);
      if (++n >= 20) flush();
    }
    i++;
  });
  flush();
  c.put('NW|' + ep + '|map', JSON.stringify(idx), NW_TTL);   // written last: only a complete copy is ever read
}

function _nwPick(keys, getGroup) {
  var out = [], seen = {};
  keys.forEach(function (k) {
    (getGroup(k) || []).forEach(function (rec) { if (!seen[rec[0]]) { seen[rec[0]] = true; out.push(rec); } });
  });
  return out;
}

/** { recs, keys, idx, ep } for this person from the cache, or null when the copy is missing. */
function _nwFromCache(doer, phone) {
  try {
    var c = _cache(), ep = _nwEpoch();
    var raw = c.get('NW|' + ep + '|map');
    if (!raw) return null;
    var idx = JSON.parse(raw), keys = _nwUserKeys(doer, phone, idx['~doers']), want = [];
    keys.forEach(function (k) {
      if (!idx[k]) return;
      var a = idx[k].split(':');
      for (var p = 0; p < +a[1]; p++) want.push('NW|' + ep + '|' + a[0] + '|' + p);
    });
    var got = want.length ? c.getAll(want) : {}, groups = {};
    for (var k2 = 0; k2 < keys.length; k2++) {
      if (!idx[keys[k2]]) continue;
      var a2 = idx[keys[k2]].split(':'), s = '';
      for (var q = 0; q < +a2[1]; q++) {
        var part = got['NW|' + ep + '|' + a2[0] + '|' + q];
        if (part == null) return null;   // part evicted: rebuild
        s += part;
      }
      groups[keys[k2]] = JSON.parse(s);
    }
    return { recs: _nwPick(keys, function (k) { return groups[k]; }), keys: keys, idx: idx, ep: ep };
  } catch (e) { return null; }
}

/** The person's Newai records: from the cache, else one read of the Newai Master (stored for everyone). */
function _nwLoad(doer, phone) {
  var hit = _nwFromCache(doer, phone);
  if (hit) return hit;
  var lock = LockService.getScriptLock(), locked = false;
  try { locked = lock.tryLock(30000); } catch (e) {}
  try {
    if (locked) { hit = _nwFromCache(doer, phone); if (hit) return hit; }
    var ep = _nwEpoch();                       // read before the sheet: a save meanwhile starts a new copy
    var built = _nwBuild();
    if (locked) { try { _nwStore(built, ep); } catch (e) { console.error('_nwStore: ' + e); } }
    var keys = _nwUserKeys(doer, phone, built.doers);
    return { recs: _nwPick(keys, function (k) { return built.groups[k]; }), keys: keys, idx: null, ep: ep };
  } finally { if (locked) lock.releaseLock(); }
}

/** A record shaped like a Monthly Master row (A..M), for processRoutineData. */
function _nwAsRow(rec) {
  return [rec[8], '', '', rec[1] || ('ROW_' + rec[0]), rec[2], rec[3], rec[4], rec[5], rec[6], '', '', rec[7], ''];
}

/** After a save: the same change in the cached copy (called while holding the script lock). */
function _nwPatch(name, row, actual, status, remark) {
  try {
    var c = _cache(), ep = _nwEpoch(), raw = c.get('NW|' + ep + '|map');
    if (!raw) return;
    var idx = JSON.parse(raw);
    _nwRowKeys(name).forEach(function (k) {
      if (!idx[k]) return;
      var a = idx[k].split(':'), base = 'NW|' + ep + '|' + a[0] + '|', s = '';
      for (var p = 0; p < +a[1]; p++) { var part = c.get(base + p); if (part == null) { _nwReset(); return; } s += part; }
      var recs = JSON.parse(s), changed = false;
      recs.forEach(function (rec) {
        if (rec[0] !== row) return;
        if (actual !== null) rec[5] = actual;
        if (status !== null) rec[6] = status;
        if (remark !== null) rec[7] = remark;
        changed = true;
      });
      if (!changed) return;
      var out = JSON.stringify(recs), parts = Math.ceil(out.length / NW_CHUNK) || 1;
      if (parts !== +a[1]) { _nwReset(); return; }  // size of this person's block changed: rebuild on next load
      var map = {};
      for (var q = 0; q < parts; q++) map[base + q] = out.substr(q * NW_CHUNK, NW_CHUNK);
      c.putAll(map, NW_TTL);
    });
  } catch (e) { _nwReset(); }
}

function _nwClean(s) { return String(s || '').toUpperCase().replace(/[\s\.\,\-\_\(\)\[\]\:\;]/g, ''); }

/** '' when a W/M/Q/Y task may be marked done now, else why not. */
function _nwTooEarly(vals, row, mine) {
  var freq = String(vals[4] || '').toUpperCase().trim();
  if (freq === 'D' || freq === 'DAILY') return '';
  var d = parseServerDate(vals[6]);
  if (!d) return '';
  var now = new Date(), today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  var due0 = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  if (due0 - today0 > NW_EARLY_DAYS * NW_DAY) {
    return 'Too early: this task can be marked from ' + Utilities.formatDate(new Date(due0 - NW_EARLY_DAYS * NW_DAY), NW_TZ, 'dd/MM/yyyy') + '.';
  }
  var title = _nwClean(vals[5]), older = null;
  (mine || []).forEach(function (rec) {
    if (rec[0] === row || _nwClean(rec[3]) !== title) return;
    var st = String(rec[6] || '').toLowerCase();
    if (st === 'done' || st === 'completed' || st === 'review') return;
    var od = parseServerDate(rec[4]);
    if (od && od.getTime() < due0 && (!older || od.getTime() < older.getTime())) older = od;
  });
  return older ? 'Finish the one due ' + Utilities.formatDate(older, NW_TZ, 'dd/MM/yyyy') + ' first.' : '';
}

/**
 * Saves Newai checklist tasks for the signed-in person (call while holding the script lock).
 * items: [{ id: Task ID or "ROW_n" (without "NEWAI_"), done: bool, remark: text, files: links }]
 * → { saved: n, missed: [{ taskId, why }], fileUrl }
 */
function _nwSave(sess, items) {
  var out = { saved: 0, missed: [] };
  if (!items.length) return out;
  var ss = SpreadsheetApp.openById(NEWAI_ROUTINE_SHEET_ID);
  var sh = ss.getSheetByName('Master'), mm = ss.getSheetByName('Monthly Master');
  var mine = _nwLoad(sess.full, sess.phone), keys = mine.keys;
  var stamp = Utilities.formatDate(new Date(), NW_TZ, 'dd/MM/yyyy HH:mm:ss');
  var findId = function (s, id) {
    if (!s || s.getLastRow() < 2 || !id) return -1;
    var f = s.getRange(2, 4, s.getLastRow() - 1, 1).createTextFinder(id).matchEntireCell(true).findNext();
    return f ? f.getRow() : -1;
  };
  items.forEach(function (it) {
    var tid = 'NEWAI_' + it.id;
    if (!sh) { out.missed.push({ taskId: tid, why: 'The Newai Master tab is missing.' }); return; }
    var row = /^ROW_\d+$/.test(it.id) ? parseInt(it.id.slice(4), 10) : findId(sh, it.id);
    if (row < 2 || row > sh.getLastRow()) { out.missed.push({ taskId: tid, why: 'This task is no longer in the sheet. Refresh and try again.' }); return; }
    var v = sh.getRange(row, 1, 1, 12).getValues()[0];
    if (!_nwRowKeys(v[0]).some(function (k) { return keys.indexOf(k) > -1; })) {
      out.missed.push({ taskId: tid, why: 'This task belongs to someone else.' }); return;
    }
    if (it.done) {
      var early = _nwTooEarly(v, row, mine.recs);
      if (early) { out.missed.push({ taskId: tid, why: early }); return; }
      sh.getRange(row, 8, 1, 2).setValues([[stamp, 'Done']]);
      // later items of the same batch see it done ("overdue one, then next week's" in one tap)
      mine.recs.forEach(function (rec) { if (rec[0] === row) rec[6] = 'Done'; });
    }
    // the Newai checklist keeps notes and file links together in column L
    var add = [it.remark, it.files].filter(function (x) { return x; }), remark = null;
    if (add.length) {
      var old = String(v[11] || '').trim();
      remark = (old ? old + '\n' : '') + add.join('\n');
      sh.getRange(row, 12).setValue(remark);
    }
    try {
      var mr = findId(mm, String(v[3] || '').trim());
      if (mr > 1) {
        if (it.done) mm.getRange(mr, 8, 1, 2).setValues([[stamp, 'Done']]);
        if (remark !== null) mm.getRange(mr, 12).setValue(remark);
      }
    } catch (e) { console.error('Newai Monthly Master copy: ' + e); }
    _nwPatch(v[0], row, it.done ? stamp : null, it.done ? 'Done' : null, remark);
    out.saved++;
  });
  if (out.saved) SpreadsheetApp.flush();
  return out;
}

/**
 * Editor check, read-only (writes nothing to any sheet): builds the copy from the live Newai
 * Master, then loads every Staff Dashboard person whose doer name starts with NEWAI (from the
 * Delegated Doer List), and finds one open task of each by
 * Task ID the way a save does. Run it from the editor and read the log. It returns nothing
 * (only the editor's execution log shows the result), so calling it from a page shows nothing.
 */
function staffNewaiSelfTest() {
  _nwReset();
  var t0 = Date.now(); _nwLoad('NEWAI - SELFTEST', ''); var build = Date.now() - t0;
  var lines = ['First load (one read of the Newai Master): ' + build + ' ms'];
  var sh = SpreadsheetApp.openById(NEWAI_ROUTINE_SHEET_ID).getSheetByName('Master');
  var del = SpreadsheetApp.openById(DELEGATED_SHEET_ID).getSheetByName('Doer List');
  var people = del.getRange(2, 1, del.getLastRow() - 1, 4).getValues()
    .filter(function (r) { return /^\s*NEWAI\s*-/i.test(String(r[3] || '')); })
    .map(function (r) { return [String(r[3]).trim(), String(r[1] || '')]; });
  var bad = 0;
  people.forEach(function (p) {
    var t1 = Date.now(), got = _nwLoad(p[0], p[1]), ms = Date.now() - t1;
    var rows = got.recs.map(_nwAsRow);
    var open = got.recs.filter(function (r) { var s = String(r[6]).toLowerCase(); return s !== 'done' && s !== 'completed' && r[1]; });
    var today = Utilities.formatDate(new Date(), NW_TZ, 'dd/MM/yyyy');
    var dueToday = open.filter(function (r) { return r[4] === today; }).length;
    var check = '';
    if (open[0]) {
      var f = sh.getRange(2, 4, sh.getLastRow() - 1, 1).createTextFinder(open[0][1]).matchEntireCell(true).findNext();
      var ok = f && f.getRow() === open[0][0];
      if (!ok) bad++;
      check = ' | ID ' + open[0][1] + (ok ? ' → row ' + open[0][0] + ' ok' : ' FAILED');
    }
    lines.push(p[0] + ' [keys ' + got.keys.join(', ') + ']: ' + rows.length + ' rows, ' + open.length + ' open, ' + dueToday + ' due today, ' + ms + ' ms' + check);
  });
  lines.push(people.length + ' Newai people checked, ' + bad + ' failed lookups.');
  console.log(lines.join('\n'));
}
