/*******************************************************
 * Store.js — this app's own spreadsheet (Events, Notes, Photos, Lead State,
 * Activity, Settings), caching, and the board version stamp.
 *******************************************************/

var MEMO_ = {};

function appSs_() {
  if (MEMO_.ss) return MEMO_.ss;
  return (MEMO_.ss = GGM_APP.sheetId ? SpreadsheetApp.openById(GGM_APP.sheetId) : SpreadsheetApp.getActiveSpreadsheet());
}

/** The tab, created with its heading row when missing. */
function tab_(t) {
  var key = 'tab_' + t.name;
  if (MEMO_[key]) return MEMO_[key];
  var ss = appSs_(), sh = ss.getSheetByName(t.name);
  if (!sh) {
    sh = ss.insertSheet(t.name);
    sh.getRange(1, 1, 1, t.head.length).setValues([t.head]).setFontWeight('bold').setBackground('#232220').setFontColor('#F4F0E5');
    sh.setFrozenRows(1);
  }
  return (MEMO_[key] = sh);
}

/** All data rows of a tab (cached for this request). */
function rows_(t) {
  var key = 'rows_' + t.name;
  if (MEMO_[key]) return MEMO_[key];
  var sh = tab_(t), n = sh.getLastRow() - 1;
  return (MEMO_[key] = n > 0 ? sh.getRange(2, 1, n, t.head.length).getValues() : []);
}

function append_(t, row) {
  var sh = tab_(t);
  sh.appendRow(row);
  if (MEMO_['rows_' + t.name]) MEMO_['rows_' + t.name].push(row);
}

/* ---------------------------------------------------------------- cache */

function cache_() { return CacheService.getScriptCache(); }

/** Values over 100 KB are split into parts. */
function cachePut_(key, obj, secs) {
  var s = JSON.stringify(obj), parts = [], size = 90000;
  for (var i = 0; i < s.length; i += size) parts.push(s.slice(i, i + size));
  if (parts.length > 40) return;
  var map = {};
  map[key] = 'P' + parts.length;
  parts.forEach(function (p, i) { map[key + '_' + i] = p; });
  try { cache_().putAll(map, secs || 300); } catch (e) {}
}
function cacheGet_(key) {
  var c = cache_(), head = c.get(key);
  if (!head || head.charAt(0) !== 'P') return null;
  var n = Number(head.slice(1)), keys = [];
  for (var i = 0; i < n; i++) keys.push(key + '_' + i);
  var got = c.getAll(keys), s = '';
  for (var j = 0; j < n; j++) { if (got[keys[j]] == null) return null; s += got[keys[j]]; }
  try { return JSON.parse(s); } catch (e) { return null; }
}

/** Bumped by every write through the app and by any change in the FMS sheets (onChange trigger). */
function boardVer_() {
  return PropertiesService.getScriptProperties().getProperty('BOARD_VER') || '1';
}
/**
 * patch = { fid: [lead, …] } → the cached boards move to the new version with those leads replaced, so the
 * next page refresh is a cache hit (no full re-read of the sheets). patch === false → full rebuild next time.
 */
function bumpVer_(patch) {
  var p = PropertiesService.getScriptProperties(), old = p.getProperty('BOARD_VER') || '1', nv = String(Math.max(Date.now(), (Number(old) || 0) + 1));
  p.setProperty('BOARD_VER', nv);
  if (patch !== false) {
    FLOW_IDS.forEach(function (f) {
      var c = cacheGet_('bd2_' + f + '_' + old) || cacheGet_('bd2_' + f + '_last');
      if (!c) return;
      ((patch && patch[f]) || []).forEach(function (l) {
        if (!l) return;
        l.la = Date.now();
        var i = -1;
        for (var j = 0; j < c.leads.length; j++) if (c.leads[j].id === l.id) { i = j; break; }
        if (i > -1) c.leads[i] = l; else c.leads.push(l);
      });
      c.at = Date.now();
      cachePut_('bd2_' + f + '_' + nv, c, 21600);
      cachePut_('bd2_' + f + '_last', c, 21600);
    });
    var log = [];
    try { log = JSON.parse(cache_().get('recent_patches') || '[]'); } catch (e) {}
    Object.keys(patch || {}).forEach(function (f) { (patch[f] || []).forEach(function (l) { if (l) log.push({ f: f, id: l.id, t: Date.now() }); }); });
    try { cache_().put('recent_patches', JSON.stringify(log.slice(-60)), 3600); } catch (e) {}
  }
  MEMO_ = { ss: MEMO_.ss };
}
function patchOf_(fid, lead, fid2, lead2) { var o = {}; o[fid] = [lead]; if (fid2) o[fid2] = [lead2]; return o; }

/* ---------------------------------------------------------------- settings */

/** { key: value } — values are JSON. Missing keys fall back to the defaults in Config.js. */
function settings_() {
  if (MEMO_.settings) return MEMO_.settings;
  var c = cacheGet_('settings');
  if (!c) {
    c = {};
    rows_(TABS.SETTINGS).forEach(function (r) {
      var k = String(r[0]).trim();
      if (!k) return;
      try { c[k] = JSON.parse(r[1]); } catch (e) { c[k] = r[1]; }
    });
    cachePut_('settings', c, 600);
  }
  return (MEMO_.settings = c);
}

function setSetting_(key, value, who) {
  var sh = tab_(TABS.SETTINGS), rows = rows_(TABS.SETTINGS), json = JSON.stringify(value);
  if (json.length > 49000) throw new Error('This setting is too long to save.');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === key) {
      sh.getRange(i + 2, 2, 1, 3).setValues([[json, who || '', new Date()]]);
      rows[i][1] = json;
      cache_().remove('settings'); MEMO_.settings = null;
      return;
    }
  }
  append_(TABS.SETTINGS, [key, json, who || '', new Date()]);
  cache_().remove('settings'); MEMO_.settings = null;
}

function warnPct_() { var v = Number(settings_().warnPct); return v > 0 && v < 100 ? v : WARN_PCT; }
function industries_() { var v = settings_().industries; return Array.isArray(v) && v.length ? v : DEFAULT_INDUSTRIES; }
function scoreRules_() {
  var s = settings_().scores || {}, out = {};
  Object.keys(DEFAULT_SCORES).forEach(function (k) {
    out[k] = { pts: s[k] != null && !isNaN(s[k]) ? Number(s[k]) : DEFAULT_SCORES[k].pts, label: DEFAULT_SCORES[k].label };
  });
  return out;
}
/** Usernames → extra names they appear under in the sheets (comma separated). */
function aliases_() { var v = settings_().aliases; return v && typeof v === 'object' ? v : {}; }

/* ---------------------------------------------------------------- lead state */

/** { leadId: { key: value } } for one flow, newest value wins; value '' clears. */
function leadState_(fid) {
  var key = 'state_' + fid;
  if (MEMO_[key]) return MEMO_[key];
  var out = {};
  rows_(TABS.STATE).forEach(function (r) {
    if (String(r[0]) !== fid) return;
    var id = String(r[1]), k = String(r[2]);
    out[id] = out[id] || {};
    var v = r[3];
    if (v === '' || v == null) { delete out[id][k]; return; }
    try { v = JSON.parse(v); } catch (e) {}
    out[id][k] = v;
  });
  return (MEMO_[key] = out);
}

function setState_(fid, id, k, v, who) {
  append_(TABS.STATE, [fid, id, k, v === '' || v == null ? '' : JSON.stringify(v), new Date(), who || '']);
  MEMO_['state_' + fid] = null;
}

/* ---------------------------------------------------------------- events */

/** One line per thing that happened. detail = object (stored as JSON). */
function logEvent_(me, fid, id, step, action, value, extra) {
  extra = extra || {};
  append_(TABS.EVENTS, [new Date(), me ? me.username : 'system', me ? me.name : 'System', fid, id, step || '', action,
    value == null ? '' : String(value).slice(0, 500), extra.to || '', extra.onTime == null ? '' : (extra.onTime ? 'Yes' : 'No'),
    extra.late == null ? '' : Math.round(extra.late * 100) / 100, extra.ownerUser || '',
    extra.detail ? JSON.stringify(extra.detail).slice(0, 45000) : '']);
}

function eventObj_(r) {
  return { t: r[0] instanceof Date ? r[0].getTime() : new Date(r[0]).getTime(), u: String(r[1]), n: String(r[2]), f: String(r[3]),
           id: String(r[4]), st: String(r[5]), a: String(r[6]), v: String(r[7]), to: String(r[8]),
           ot: r[9] === 'Yes' ? true : r[9] === 'No' ? false : null, late: Number(r[10]) || 0, ou: String(r[11] || ''), d: r[12] ? safeJson_(r[12]) : null };
}
function safeJson_(s) { try { return JSON.parse(s); } catch (e) { return null; } }
function msOf_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.getTime();
  if (typeof v === 'number') return v;
  if (!v) return null;
  var t = new Date(v).getTime();
  return isNaN(t) ? null : t;
}

/* ---------------------------------------------------------------- activity (opens + screen time) */

function todayIso_() { return Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd'); }

/** opens / secs / actions to add to today's row for this person. */
function touchActivity_(me, secs, actions, opens) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(8000); } catch (e) { return; }
  try {
    var iso = todayIso_(), sh = tab_(TABS.ACTIVITY), key = 'act_' + iso + '_' + me.username.toLowerCase();
    var rowNo = Number(cache_().get(key) || 0);
    if (rowNo) {
      var chk = sh.getRange(rowNo, 1, 1, 2).getDisplayValues()[0];
      if (chk[0] !== iso || chk[1].toLowerCase() !== me.username.toLowerCase()) rowNo = 0;
    }
    if (!rowNo) {
      var n = sh.getLastRow() - 1;
      if (n > 0) {
        var from = Math.max(0, n - 400);
        var vals = sh.getRange(2 + from, 1, n - from, 2).getDisplayValues();
        for (var i = vals.length - 1; i >= 0; i--) {
          if (vals[i][0] === iso && vals[i][1].toLowerCase() === me.username.toLowerCase()) { rowNo = 2 + from + i; break; }
        }
      }
    }
    var now = new Date();
    if (!rowNo) {
      sh.appendRow([iso, me.username, me.name, opens || 0, Math.round(secs || 0), now, now, actions || 0]);
      sh.getRange(sh.getLastRow(), 1).setNumberFormat('@').setValue(iso);
      rowNo = sh.getLastRow();
    } else {
      var cur = sh.getRange(rowNo, 4, 1, 5).getValues()[0];
      sh.getRange(rowNo, 4, 1, 5).setValues([[Number(cur[0] || 0) + (opens || 0), Number(cur[1] || 0) + Math.round(secs || 0),
        cur[2] || now, now, Number(cur[4] || 0) + (actions || 0)]]);
    }
    cache_().put(key, String(rowNo), 21600);
  } finally { lock.releaseLock(); }
}
