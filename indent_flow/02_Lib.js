/**********************************************************************
 * File: 02_Lib.gs  —  Low level helpers: sheet ORM, ids, dates, locks
 *********************************************************************/

var _SS_CACHE = null;

/** Per-execution row cache. Apps Script executions are single-threaded and
 *  short lived, so memoising sheet reads is safe as long as every write
 *  invalidates its tab. */
var _MEMO = {};
/** Drop a memoised sheet read.
 *
 *  Anything keyed with a leading '~' is a figure DERIVED from a sheet
 *  (the ledger totals, for instance) rather than the sheet itself. Those
 *  go on any write: handing a guard a total from before the movement it
 *  is guarding is exactly the class of bug that lets stock lie. */
function memoClear_(name) {
  if (!name) { _MEMO = {}; _HEAD = {}; _ROWKEY = {}; return; }
  delete _MEMO[name]; delete _ROWKEY[name];
  Object.keys(_MEMO).forEach(function (k) { if (k.charAt(0) === '~') delete _MEMO[k]; });
}

/* ------------------------------------------------------------------
 *  HOT TABS - kept between requests
 *  People, settings, sites, sections and vendors are small and are read
 *  on nearly every request (every request checks who is asking). They
 *  are kept in the script cache, keyed by a per-tab change stamp that
 *  every write through this file renews, so a change made in the app is
 *  seen at once. Something typed straight into the sheet is picked up
 *  within HOT_TTL seconds.
 *
 *  A row number from the cache is only trusted for a write if that row
 *  still holds the same record (see update_), so a row deleted or sorted
 *  by hand can never send a write to the wrong person.
 * ------------------------------------------------------------------ */
var HOT_TTL = 120;
var _HEAD = {};      // header row per tab, for this execution
var _ROWKEY = {};    // tab -> { row number: first-column value } for rows that came from the cache
var _STAMPS = {};    // tab -> change stamp, for this execution
var _TOUCHED = {};   // tabs written in this execution

function isHot_(name) {
  return [SH.USERS, SH.SETTINGS, SH.SITES, SH.SECTIONS, SH.VENDORS].indexOf(name) !== -1;
}

function newStamp_() { return String(Date.now()) + String(Math.floor(Math.random() * 1000)); }

/** The change stamp of a tab. A stamp the cache has lost is replaced by a
 *  brand-new one, never reset, so an old cached copy can never match again. */
function tabStamp_(name) {
  if (_STAMPS[name]) return _STAMPS[name];
  var v = null, cache = null;
  try { cache = CacheService.getScriptCache(); v = cache.get('ts_' + name); } catch (e) {}
  if (!v) {
    v = newStamp_();
    try { if (cache) cache.put('ts_' + name, v, 21600); } catch (e) {}
  }
  _STAMPS[name] = v;
  return v;
}

/** A write happened: renew the tab's stamp now, and again when the request
 *  ends (flushTabs_), so nothing read half-way through a request survives it. */
function touchTab_(name) {
  var first = !_TOUCHED[name];
  _TOUCHED[name] = true;
  // a cached tab renews on every write: a read between two writes of the same
  // request must never be cached under a stamp the second write keeps
  if (!first && !isHot_(name)) return;
  var v = newStamp_();
  _STAMPS[name] = v;
  try { CacheService.getScriptCache().put('ts_' + name, v, 21600); } catch (e) {}
}

function flushTabs_() {
  var names = Object.keys(_TOUCHED);
  if (!names.length) return;
  var put = {};
  names.forEach(function (n) { var v = newStamp_(); _STAMPS[n] = v; put['ts_' + n] = v; });
  _TOUCHED = {};
  try { CacheService.getScriptCache().putAll(put, 21600); } catch (e) {}
}

/** Dates survive the trip through the cache as dates. */
function packDates_(k, v) { var o = this[k]; return (o instanceof Date) ? { $d: o.getTime() } : v; }
function unpackDates_(k, v) {
  return (v && typeof v === 'object' && v.$d !== undefined && Object.keys(v).length === 1) ? new Date(v.$d) : v;
}

/** Memoise a computation on the tabs it reads: any write to one of them
 *  retires it at once; `ttl` bounds what a hand edit in the sheet can leave stale. */
function tabCached_(tabs, key, ttl, fn) {
  var full = 'tc_' + key + '_' + tabs.map(tabStamp_).join('.');
  var cache = null;
  try {
    cache = CacheService.getScriptCache();
    var hit = cache.get(full);
    if (hit) return JSON.parse(hit, unpackDates_);
  } catch (e) {}
  var val = fn();
  try {
    var str = JSON.stringify(val, packDates_);
    if (cache && str.length < 95000) cache.put(full, str, ttl || 120);
  } catch (e) {}
  return val;
}

/* ------------------------------------------------------------------
 *  DATA VERSION
 *  Every write stamps a new version. The browser polls a tiny endpoint
 *  that returns nothing but this number, so it can tell in a few bytes
 *  whether anything it is showing has gone out of date — and any cached
 *  read payload is keyed by it, so a write invalidates the lot for free.
 * ------------------------------------------------------------------ */
var _DIRTY = false;
var _VERSION_MEMO = null;

function markDirty_() { _DIRTY = true; }

/** Sign-ins are not data: a session row coming or going must not make every
 *  open screen in the company reload itself. */
function markDirtyFor_(name) { if (name !== SH.SESSIONS) _DIRTY = true; }

function dataVersion_() {
  if (_VERSION_MEMO) return _VERSION_MEMO;
  var v = null;
  try { v = CacheService.getScriptCache().get('DATA_VERSION'); } catch (e) {}
  if (!v) {
    try { v = PropertiesService.getScriptProperties().getProperty('DATA_VERSION'); } catch (e) {}
  }
  if (!v) v = '1';
  _VERSION_MEMO = v;
  return v;
}

/** Stamp a new version only if this run actually changed something. */
function bumpIfDirty_() {
  flushTabs_();
  if (!_DIRTY) return dataVersion_();
  _DIRTY = false;
  return bumpVersion_();
}

/** Called once at the end of any request that wrote something.
 *  Strictly increasing: two writes inside the same millisecond must still
 *  produce two different versions, or a cached read could be served stale. */
function bumpVersion_() {
  var prev = Number(dataVersion_()) || 0;
  var now  = Date.now();
  var v = String(now > prev ? now : prev + 1);
  _VERSION_MEMO = v;
  try { CacheService.getScriptCache().put('DATA_VERSION', v, 21600); } catch (e) {}
  try { PropertiesService.getScriptProperties().setProperty('DATA_VERSION', v); } catch (e) {}
  return v;
}

/** Memoise an expensive read against the current data version. A write
 *  changes the version, which changes the key, which retires the entry. */
function cached_(key, ttlSec, fn) {
  var full = 'r_' + dataVersion_() + '_' + key;
  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (e) {}
  if (cache) {
    try {
      var hit = cache.get(full);
      if (hit) return JSON.parse(hit);
    } catch (e) { /* unreadable entry — fall through and recompute */ }
  }
  var val = fn();
  if (cache) {
    try {
      var str = JSON.stringify(val);
      if (str.length < 90000) cache.put(full, str, ttlSec || 25);
    } catch (e) { /* too big or unserialisable — simply do not cache it */ }
  }
  return val;
}

/** The bound spreadsheet (works both bound and standalone). */
function SS_() {
  if (_SS_CACHE) return _SS_CACHE;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
    if (!id) throw new Error('No spreadsheet bound. Run setupSystem() from a spreadsheet-bound project, ' +
                             'or set Script Property SPREADSHEET_ID.');
    ss = SpreadsheetApp.openById(id);
  }
  _SS_CACHE = ss;
  return ss;
}

/** Get (creating if needed) a tab with the schema header applied. */
function sheet_(name) {
  var ss = SS_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    var head = SCHEMA[name];
    if (head) {
      sh.getRange(1, 1, 1, head.length).setValues([head]);
      sh.setFrozenRows(1);
    }
  }
  return sh;
}

/** Header array of a tab (from the sheet itself, falling back to SCHEMA). */
function deleteRow_(name, rowNumber) {
  sheet_(name).deleteRow(rowNumber);
  memoClear_(name); markDirtyFor_(name); touchTab_(name);
}

function headRow_(h) {
  var out = [];
  for (var i = 0; i < h.length; i++) {
    var v = String(h[i] || '').trim();
    if (v) out.push(v); else out.push('_col' + (i + 1));
  }
  return out;
}

/** Header array of a tab, read once per execution. */
function headers_(name) {
  if (_HEAD[name]) return _HEAD[name];
  var sh = sheet_(name);
  if (sh.getLastColumn() === 0) return (SCHEMA[name] || []).slice();
  _HEAD[name] = headRow_(sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]);
  return _HEAD[name];
}

/** Read every data row of a tab as an array of plain objects.
 *  One read for the header and the data together. */
function readAll_(name) {
  if (_MEMO[name]) return _MEMO[name];
  var hot = isHot_(name), ckey = null, cache = null;
  if (hot) {
    try {
      cache = CacheService.getScriptCache();
      ckey = 'hot_' + name + '_' + tabStamp_(name);
      var hit = cache.get(ckey);
      if (hit) {
        var packed = JSON.parse(hit, unpackDates_);
        _HEAD[name] = _HEAD[name] || packed.head;
        var keys = {};
        packed.rows.forEach(function (o) { keys[o.__row] = String(o[packed.head[0]]); });
        _ROWKEY[name] = keys;
        _MEMO[name] = packed.rows;
        return packed.rows;
      }
    } catch (e) { /* unreadable entry: read the sheet */ }
  }
  var values = sheet_(name).getDataRange().getValues();
  var rows = [];
  if (values.length && String(values[0].join('')).trim()) {
    var head = headRow_(values[0]);
    _HEAD[name] = head;
    for (var r = 1; r < values.length; r++) {
      var o = {};
      var empty = true;
      for (var c = 0; c < head.length; c++) {
        o[head[c]] = values[r][c];
        if (values[r][c] !== '' && values[r][c] !== null) empty = false;
      }
      if (empty) continue;
      o.__row = r + 1;
      rows.push(o);
    }
    if (hot && cache) {
      try {
        var str = JSON.stringify({ head: head, rows: rows }, packDates_);
        if (str.length < 95000) cache.put(ckey, str, HOT_TTL);
      } catch (e) { /* too big: just not cached */ }
    }
  }
  _MEMO[name] = rows;
  return rows;
}

/** Read rows matching a predicate. */
function readWhere_(name, fn) {
  return readAll_(name).filter(fn);
}

/** Append one object; missing keys become ''. Returns the object with __row. */
function insert_(name, obj) {
  var sh = sheet_(name);
  var head = headers_(name);
  var row = head.map(function (h) { return obj[h] === undefined || obj[h] === null ? '' : obj[h]; });
  sh.appendRow(row);
  memoClear_(name); markDirtyFor_(name); touchTab_(name);
  obj.__row = sh.getLastRow();
  return obj;
}

/** Append many objects in one write (much faster than N appendRow calls). */
function insertMany_(name, objs) {
  if (!objs || !objs.length) return [];
  var sh = sheet_(name);
  var head = headers_(name);
  var matrix = objs.map(function (obj) {
    return head.map(function (h) { return obj[h] === undefined || obj[h] === null ? '' : obj[h]; });
  });
  var start = sh.getLastRow() + 1;
  sh.getRange(start, 1, matrix.length, head.length).setValues(matrix);
  memoClear_(name); markDirty_(); touchTab_(name);
  for (var i = 0; i < objs.length; i++) objs[i].__row = start + i;
  return objs;
}

/** Patch specific fields of an existing row (identified by obj.__row). */
function update_(name, rowNumber, patch) {
  var sh = sheet_(name);
  var head = headers_(name);
  var current = sh.getRange(rowNumber, 1, 1, head.length).getValues()[0];
  // A row number that came from the cache must still hold the same record.
  var want = _ROWKEY[name] && _ROWKEY[name][rowNumber];
  if (want !== undefined && String(current[0]) !== want) {
    memoClear_(name); touchTab_(name);
    throw new Error('The sheet was changed by hand a moment ago. Please try again.');
  }
  var changed = false;
  for (var k in patch) {
    var idx = head.indexOf(k);
    if (idx === -1) continue;
    current[idx] = (patch[k] === undefined || patch[k] === null) ? '' : patch[k];
    changed = true;
  }
  if (changed) {
    sh.getRange(rowNumber, 1, 1, head.length).setValues([current]);
    memoClear_(name); markDirty_(); touchTab_(name);
  }
  return changed;
}

/** Find the first row object where field === value. */
function findBy_(name, field, value) {
  var rows = readAll_(name);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][field]) === String(value)) return rows[i];
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* IDs                                                                 */
/* ------------------------------------------------------------------ */

/** Sequential, zero-padded id, e.g. nextId_('Indents','Indent_ID','IND',3) -> IND-004 */
function nextId_(sheetName, field, prefix, pad) {
  var rows = readAll_(sheetName);
  var max = 0;
  for (var i = 0; i < rows.length; i++) {
    var v = String(rows[i][field] || '');
    var m = v.match(/(\d+)\s*$/);
    if (m) { var n = parseInt(m[1], 10); if (n > max) max = n; }
  }
  var s = String(max + 1);
  while (s.length < (pad || 3)) s = '0' + s;
  return prefix + '-' + s;
}

function uuid_() {
  return Utilities.getUuid();
}

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

function now_() { return new Date(); }

/** Add calendar hours (24x7 — no working-hour maths, as chosen). */
function addHours_(date, hours) {
  return new Date(date.getTime() + Math.round(Number(hours || 0) * 3600 * 1000));
}

function minutesBetween_(a, b) {
  if (!a || !b) return '';
  return Math.round((toDate_(b).getTime() - toDate_(a).getTime()) / 60000);
}

/** Anything -> Date (or null). Handles Date, ISO string, dd/mm/yyyy hh:mm. */
function toDate_(v) {
  if (v === '' || v === null || v === undefined) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === 'number') return new Date(v);
  var s = String(v).trim();
  if (!s) return null;
  var d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  var m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})[ T]?(\d{1,2})?:?(\d{2})?/);
  if (m) {
    return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0));
  }
  return null;
}

/** ISO string for transport to the browser (never send raw Date objects). */
function iso_(v) {
  var d = toDate_(v);
  return d ? d.toISOString() : '';
}

function fmt_(v) {
  var d = toDate_(v);
  if (!d) return '';
  return Utilities.formatDate(d, APP.TIMEZONE, 'dd-MMM-yyyy HH:mm');
}

/* ------------------------------------------------------------------ */
/* Misc                                                                */
/* ------------------------------------------------------------------ */

function sha256_(text) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8);
  var hex = '';
  for (var i = 0; i < raw.length; i++) {
    var b = raw[i]; if (b < 0) b += 256;
    var s = b.toString(16); if (s.length === 1) s = '0' + s;
    hex += s;
  }
  return hex;
}

function hashPin_(userId, pin) {
  return sha256_(String(userId).toUpperCase() + '::' + String(pin) + '::gg-indent-salt');
}

/** Run fn while holding the document lock (prevents double-writes).
 *  Re-entrant. Telegram messages asked for inside are sent after the lock
 *  is released, so a slow network never holds up everybody else's writes;
 *  if fn fails, they are dropped along with its changes. */
var _LOCK_DEPTH = 0;
var _NOTIFY_Q = [];
var _AFTER_Q = [];
/** Run fn once the write lock is released (at once when not inside one). Slow
 *  outside work - another spreadsheet, the network - never holds everyone up. */
function afterLock_(fn) {
  if (_LOCK_DEPTH > 0) { _AFTER_Q.push(fn); return; }
  try { fn(); } catch (e) { try { console.error('[afterLock] ' + e); } catch (ignored) {} }
}
function withLock_(fn) {
  if (_LOCK_DEPTH > 0) return fn();
  var lock = LockService.getScriptLock();
  var got = false, out, failed = true;
  try {
    got = lock.tryLock(20000);
    if (!got) throw new Error('System busy, please retry in a moment.');
    _LOCK_DEPTH = 1;
    out = fn();
    failed = false;
  } finally {
    _LOCK_DEPTH = 0;
    if (got) { try { lock.releaseLock(); } catch (e) {} }
    var q = _NOTIFY_Q; _NOTIFY_Q = [];
    var aq = _AFTER_Q; _AFTER_Q = [];
    if (!failed) {
      q.forEach(function (args) { try { notify_.apply(null, args); } catch (e) {} });
      aq.forEach(function (fn) { try { fn(); } catch (e) { try { console.error('[afterLock] ' + e); } catch (ignored) {} } });
    }
  }
  return out;
}

function ok_(data)      { return { ok: true,  data: data === undefined ? null : data }; }
function err_(message)  { return { ok: false, error: String(message && message.message ? message.message : message) }; }

function stageByKey_(key) {
  for (var i = 0; i < STAGES.length; i++) if (STAGES[i].key === key) return STAGES[i];
  return null;
}
function stageByNo_(no) {
  for (var i = 0; i < STAGES.length; i++) if (STAGES[i].no === Number(no)) return STAGES[i];
  return null;
}

/** TAT hours for a stage, honouring the editable Settings override. */
function tatFor_(key) {
  var raw = getSetting_('STAGE_TAT_JSON');
  if (raw) {
    try {
      var map = JSON.parse(raw);
      if (map && map[key] !== undefined && map[key] !== null && map[key] !== '') return Number(map[key]);
    } catch (e) { /* fall through to default */ }
  }
  var s = stageByKey_(key);
  return s ? s.tat : 24;
}

function getSetting_(key) {
  var rows = readAll_(SH.SETTINGS);
  for (var i = 0; i < rows.length; i++) if (String(rows[i].Key) === String(key)) return rows[i].Value;
  return null;
}

function setSetting_(key, value, description) {
  var rows = readAll_(SH.SETTINGS);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].Key) === String(key)) { update_(SH.SETTINGS, rows[i].__row, { Value: value }); return; }
  }
  insert_(SH.SETTINGS, { Key: key, Value: value, Description: description || '' });
}

function truthy_(v) {
  var s = String(v).trim().toUpperCase();
  return s === 'TRUE' || s === 'YES' || s === '1' || s === 'Y';
}

function safeStr_(v) { return v === null || v === undefined ? '' : String(v).trim(); }
function num_(v, d)  { var n = Number(v); return isNaN(n) ? (d === undefined ? 0 : d) : n; }
/** Number, but an empty cell stays empty instead of becoming 0. */
function blankNum_(v){
  if (v === '' || v === null || v === undefined) return '';
  var n = Number(v);
  return isNaN(n) ? '' : n;
}

/** Copy the second object's keys onto the first and return it. Used where
 *  a patch is built in two halves and both are written in one update. */
function extend_(a, b) {
  Object.keys(b || {}).forEach(function (k) { a[k] = b[k]; });
  return a;
}
