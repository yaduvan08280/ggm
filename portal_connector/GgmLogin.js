/**
 * GGM PORTAL LOGIN (v2) — the same file in every app that has moved to it.
 * Master copy: portal_connector/GgmLogin.js. Never edit it inside one app only.
 *
 * WHO MAY SIGN IN
 *   The tab "Portal Users <APP ID>" in this app's spreadsheet. GGM Portal writes it
 *   the moment the admin ticks / unticks the app for someone (and removes people
 *   who are switched off). Columns: Username · Name · Phone · Email · Role · Site ·
 *   Doer Name · Password Hash · Salt · Updated · Check.
 *   Every row is signed (Check) with the portal key, so a row typed or changed by
 *   hand does not work. Old user tabs of the app are never read or touched here.
 *
 * SETUP (once per app)
 *   1. Script properties → PORTAL_KEY = the hub's PEPPER (Portal Admin → Show app login key).
 *   2. The app's own file defines GGM_APP = { id, hub, sheetId?, counts?, meta? }.
 *   3. doGet:  var gate = ggmGate_(e); return ggmPage_(HtmlService…(page), gate)…
 *      doPost: return ggmHandlePost_(e) || ContentService.createTextOutput('Not found');
 *   4. Every function the page calls takes the token first: var me = ggmUser_(token);
 *      The page calls them through PORTAL.run instead of google.script.run (it adds
 *      the token and shows the sign-in card again when a sign-in has ended).
 *      Page start-up code that talks to the server goes inside PORTAL.ready(fn).
 */

var GGM_ = {
  SESSION_HOURS: 12,   // how long a phone stays signed in to this app
  TAB_CACHE: 20,       // seconds the users tab is cached; an unticked person is out within this
  MAX_FAILS: 5,        // wrong passwords before the username is locked
  LOCK_MINUTES: 10,
  PASS_REUSE: 300      // seconds a launch pass may be re-opened (same page reloading)
};
var GGM_HEAD = ['Username', 'Name', 'Phone', 'Email', 'Role', 'Site', 'Doer Name', 'Password Hash', 'Salt', 'Updated', 'Check'];
var GGM_MEMO_ = {};

/* ------------------------------------------------------------ pages call these */

/** Sign in with portal username, phone or email + portal password. */
function ggmLogin(id, pw) {
  id = String(id || '').trim();
  pw = String(pw || '');
  if (!id || !pw) throw new Error('Enter your username and password.');
  var cache = CacheService.getScriptCache();
  var failKey = 'ggm_fail_' + id.toLowerCase().slice(0, 200);
  var fails = Number(cache.get(failKey) || 0);
  if (fails >= GGM_.MAX_FAILS) throw new Error('Too many wrong attempts. Try again in ' + GGM_.LOCK_MINUTES + ' minutes.');

  var u = ggmFind_(id);
  var ok = !!(u && u.hash && ggmSafeEq_(ggmHash_(pw, u.salt), u.hash));
  if (!ok) {
    cache.put(failKey, String(fails + 1), GGM_.LOCK_MINUTES * 60);
    if (u && !u.hash) throw new Error('No password is set yet. Set one in GGM Portal ("First time here?").');
    throw new Error('Username or password is wrong.');   // also when the person is not ticked for this app
  }
  cache.remove(failKey);
  return { token: ggmNewToken_(u), user: ggmPublic_(u) };
}

/** The signed-in person for a saved token (the page calls this when it opens). */
function ggmMe(token) {
  return ggmPublic_(ggmUser_(token));
}

/* ------------------------------------------------------------ server-side guard */

/**
 * First line of every function the page calls. Returns the person, fresh from the
 * users tab (so a changed role / site / doer applies at once), or throws SESSION_EXPIRED.
 */
function ggmUser_(token) {
  var p = ggmRead_(token);
  if (!p || p.t !== 's' || p.a !== GGM_APP.id) throw new Error('SESSION_EXPIRED');
  var u = ggmRows_()[String(p.u).toLowerCase()];
  if (!u || !u.hash || u.hash.slice(0, 12) !== p.pv) throw new Error('SESSION_EXPIRED');   // removed, or password changed
  return u;
}

/** Menu / setup functions: only someone working in the editor or the sheet, never a page visitor. */
function ggmAssertEditor_() {
  var active = Session.getActiveUser().getEmail();
  if (!active || active !== Session.getEffectiveUser().getEmail()) throw new Error('Run this from the spreadsheet or the script editor.');
}

/* ------------------------------------------------------------ doGet */

/** Opened from a GGM Portal tile: ?pt=<launch pass> → signed in straight away. */
function ggmGate_(e) {
  var gate = { boot: null };
  var pt = e && e.parameter && e.parameter.pt;
  if (!pt) return gate;
  var c = ggmRead_(String(pt));
  if (!c || c.t !== 'l' || c.a !== GGM_APP.id || !c.j) return gate;   // old or foreign pass: normal sign-in card
  var cache = CacheService.getScriptCache();
  var seen = cache.get('ggm_pt_' + c.j);
  if (seen) { gate.boot = JSON.parse(seen); return gate; }            // same page reloading
  var u = ggmRows_()[String(c.u || '').toLowerCase()];
  if (!u || !u.hash) {
    gate.error = 'You are not in this app\'s user list yet. Ask the IT admin to tick it for you in GGM Portal.';
    return gate;
  }
  gate.boot = { token: ggmNewToken_(u), user: ggmPublic_(u) };
  cache.put('ggm_pt_' + c.j, JSON.stringify(gate.boot), GGM_.PASS_REUSE);
  return gate;
}

/** Adds window.PORTAL, the sign-in card and PORTAL.run to the page, right after <head>. */
function ggmPage_(out, gate) {
  var cfg = { app: GGM_APP.id, name: GGM_APP.name || GGM_APP.id, hub: GGM_APP.hub || '',
              boot: (gate && gate.boot) || null, error: (gate && gate.error) || '' };
  var bad = new RegExp('[' + String.fromCharCode(60, 8232, 8233) + ']', 'g');   // < and the two JS line separators
  var js = JSON.stringify(cfg).replace(bad, function (ch) { return String.fromCharCode(92) + 'u' + ('000' + ch.charCodeAt(0).toString(16)).slice(-4); });
  var tag = '<script>window.PORTAL_CFG=' + js + ';</script>' + GGM_CLIENT_ + portalPhotoTag_();   // + profile photos (below)
  var html = out.getContent();
  html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, function (m) { return m + tag; }) : tag + html;
  return HtmlService.createHtmlOutput(html);
}

/* ------------------------------------------------------------ doPost (GGM Portal → app) */

/** ops: ping · counts (badges) · meta (dropdown values). Returns null for other requests. */
function ggmHandlePost_(e) {
  if (!e || !e.parameter || e.parameter.portal !== '1') return null;
  var out;
  try {
    var body = JSON.parse((e.postData && e.postData.contents) || '{}');
    var m = ggmRead_(body.p);
    if (!m || m.t !== 'h' || m.a !== GGM_APP.id || !m.j) throw new Error('Bad signature or expired request.');
    var cache = CacheService.getScriptCache();
    if (cache.get('ggm_h_' + m.j)) throw new Error('Request already used.');
    cache.put('ggm_h_' + m.j, '1', 600);
    var data = m.data || {}, res;
    if (m.op === 'ping') res = { app: GGM_APP.id, users: Object.keys(ggmRows_()).length, v: 2 };
    else if (m.op === 'counts') res = GGM_APP.counts ? GGM_APP.counts(data.users || []) : {};
    else if (m.op === 'meta') res = GGM_APP.meta ? GGM_APP.meta() : {};
    else throw new Error('Unknown request: ' + m.op);
    out = { ok: true, data: res };
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/* ------------------------------------------------------------ the users tab */

function ggmTabName_() { return 'Portal Users ' + GGM_APP.id; }

/** { usernameLc: person } — only rows whose signature is right. */
function ggmRows_() {
  if (GGM_MEMO_.rows) return GGM_MEMO_.rows;
  var cache = CacheService.getScriptCache();
  var key = 'ggm_tab_' + GGM_APP.id;
  var raw = cache.get(key);
  var rows;
  if (raw) rows = JSON.parse(raw);
  else {
    var ss = GGM_APP.sheetId ? SpreadsheetApp.openById(GGM_APP.sheetId) : SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(ggmTabName_());
    rows = sh && sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, GGM_HEAD.length).getDisplayValues() : [];
    var str = JSON.stringify(rows);
    if (str.length < 90000) cache.put(key, str, GGM_.TAB_CACHE);
  }
  var map = {};
  rows.forEach(function (r) {
    var uname = String(r[0]).trim();
    if (!uname || !ggmSafeEq_(ggmRowCheck_(r), String(r[10]))) return;   // hand-typed or edited row: ignored
    map[uname.toLowerCase()] = {
      username: uname, name: String(r[1] || uname), phone: String(r[2]), email: String(r[3]),
      role: String(r[4]), site: String(r[5]), doer: String(r[6]), hash: String(r[7]), salt: String(r[8])
    };
  });
  return (GGM_MEMO_.rows = map);
}

/** By username, phone (last 10 digits) or email. */
function ggmFind_(id) {
  var rows = ggmRows_(), lc = String(id).trim().toLowerCase(), ph = ggmDigits_(id);
  if (rows[lc]) return rows[lc];
  for (var k in rows) {
    var u = rows[k];
    if (ph.length >= 10 && ggmDigits_(u.phone) === ph) return u;
    if (lc.indexOf('@') > 0 && u.email.toLowerCase() === lc) return u;
  }
  return null;
}

function ggmPublic_(u) {
  return { username: u.username, name: u.name, role: u.role, site: u.site, doer: u.doer };
}

/* ------------------------------------------------------------ crypto (same as the hub) */

function ggmKey_() {
  if (GGM_MEMO_.key) return GGM_MEMO_.key;
  var k = PropertiesService.getScriptProperties().getProperty('PORTAL_KEY');
  if (!k) throw new Error('This app is not linked to GGM Portal yet (Script property PORTAL_KEY is missing).');
  return (GGM_MEMO_.key = k);
}

function ggmHash_(pw, salt) {
  var key = Utilities.newBlob(ggmKey_()).getBytes();
  var h = Utilities.computeHmacSha256Signature(Utilities.newBlob(String(salt) + ':' + pw).getBytes(), key);
  for (var i = 0; i < 150; i++) h = Utilities.computeHmacSha256Signature(h, key);
  return ggmHex_(h);
}

/** Row signature written by the hub: app id + the first 9 columns. */
function ggmRowCheck_(r) {
  var data = [GGM_APP.id].concat(r.slice(0, 9).map(function (v) { return String(v); }));
  return ggmHex_(Utilities.computeHmacSha256Signature('row|' + JSON.stringify(data), ggmKey_())).slice(0, 32);
}

function ggmNewToken_(u) {
  return ggmSign_({ t: 's', a: GGM_APP.id, u: u.username, pv: u.hash.slice(0, 12), exp: ggmNow_() + GGM_.SESSION_HOURS * 3600 });
}

function ggmSign_(payload) {
  var body = Utilities.base64EncodeWebSafe(JSON.stringify(payload), Utilities.Charset.UTF_8).replace(/=+$/, '');
  var sig = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(body, ggmKey_())).replace(/=+$/, '');
  return body + '.' + sig;
}

function ggmRead_(token) {
  if (!token || typeof token !== 'string') return null;
  var parts = token.split('.');
  if (parts.length !== 2) return null;
  var expect = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(parts[0], ggmKey_())).replace(/=+$/, '');
  if (!ggmSafeEq_(expect, parts[1])) return null;
  var p;
  try {
    p = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0] + '==='.slice((parts[0].length + 3) % 4))).getDataAsString('UTF-8'));
  } catch (e) { return null; }
  return p && p.exp && p.exp >= ggmNow_() ? p : null;
}

function ggmNow_() { return Math.floor(Date.now() / 1000); }
function ggmDigits_(v) { var d = String(v || '').replace(/\D/g, ''); return d.length > 10 ? d.slice(-10) : d; }
function ggmHex_(bytes) { return bytes.map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join(''); }
function ggmSafeEq_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  var x = 0;
  for (var i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

/* ------------------------------------------------------------ the page side */

var GGM_CLIENT_ = '<style>' +
  '#ggm-login{position:fixed;inset:0;z-index:2147483000;display:none;place-items:center;background:#F4F1E9;padding:20px;box-sizing:border-box;font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1B1A17}' +
  '#ggm-login.on{display:grid}' +
  '#ggm-login .c{width:100%;max-width:360px;background:#FCFAF5;border:1px solid #E8E3D6;border-radius:22px;padding:26px;box-shadow:0 8px 24px -12px rgba(27,26,23,.18);box-sizing:border-box}' +
  '#ggm-login .m{width:36px;height:36px;border-radius:10px;background:#F2C14E;margin-bottom:14px}' +
  '#ggm-login h1{font-size:19px;margin:0 0 4px}#ggm-login p{margin:0 0 16px;color:#6C685D;font-size:13.5px}' +
  '#ggm-login input{display:block;width:100%;box-sizing:border-box;margin:0 0 10px;padding:12px 14px;border:1px solid #D6D0C0;border-radius:12px;font:inherit;background:#fff;color:#1B1A17}' +
  '#ggm-login button{width:100%;padding:12px;border:0;border-radius:22px;background:#232220;color:#F6F2E7;font:600 15px system-ui,sans-serif;cursor:pointer}' +
  '#ggm-login button:disabled{opacity:.6}#ggm-login .e{color:#CF4F33;font-size:13px;min-height:18px;margin:2px 0 8px}' +
  '#ggm-login a{display:block;text-align:center;margin-top:14px;color:#6C685D;font-size:13px}' +
  '</style><script>(function(){' +
  'var C=window.PORTAL_CFG,K="ggm_"+C.app+"_token",P=window.PORTAL={user:null,token:null},Q=[],started=false,last=null;' +
  'function ls(f){try{return f()}catch(e){return null}}' +
  'P.token=C.boot?C.boot.token:ls(function(){return localStorage.getItem(K)});' +
  'if(C.boot)ls(function(){localStorage.setItem(K,C.boot.token)});' +
  'function dead(e){return /SESSION_EXPIRED/.test(String(e&&e.message||e))}' +
  'function wrap(r,hasFail){return new Proxy(r,{get:function(t,k){var v=t[k];if(typeof v!=="function")return v;' +
  'if(k==="withFailureHandler")return function(fn){return wrap(v.call(t,function(e,o){if(dead(e))return P.signOut("Your sign-in has ended. Please sign in again.");if(fn)fn(e,o)}),true)};' +
  'if(k==="withSuccessHandler"||k==="withUserObject")return function(){return wrap(v.apply(t,arguments),hasFail)};' +
  'return function(){var a=[P.token].concat([].slice.call(arguments));var rr=hasFail?t:t.withFailureHandler(function(e){if(dead(e))P.signOut("Your sign-in has ended. Please sign in again.");else{console.error(e);alert(String(e&&e.message||e))}});return rr[k].apply(rr,a)}}})}' +
  'Object.defineProperty(P,"run",{get:function(){return wrap(google.script.run,false)}});' +
  'P.ready=function(fn){Q.push(fn);if(started)fn(P.user)};' +
  'function go(u){var was=last;last=u.username;P.user=u;card(false);if(started&&was===u.username)return;started=true;' +
  'Q.forEach(function(fn){try{fn(u)}catch(e){console.error(e)}})}' +
  'P.signOut=function(msg){ls(function(){localStorage.removeItem(K)});P.token=null;P.user=null;card(true,msg||"")};' +
  'function el(id){return document.getElementById(id)}' +
  'function card(show,msg){var d=el("ggm-login");if(!d)return;d.className=show?"on":"";if(show){el("ggm-e").textContent=msg||"";el("ggm-b").disabled=false;setTimeout(function(){el("ggm-id").focus()},50)}}' +
  'function build(){var d=document.createElement("div");d.id="ggm-login";' +
  'd.innerHTML=\'<form class="c" id="ggm-f" autocomplete="on"><div class="m"></div><h1></h1><p>Sign in with your GGM Portal username or phone and password.</p>\'+' +
  '\'<input id="ggm-id" name="username" autocomplete="username" placeholder="Username or phone" required>\'+' +
  '\'<input id="ggm-pw" name="password" type="password" autocomplete="current-password" placeholder="Password" required>\'+' +
  '\'<div class="e" id="ggm-e"></div><button id="ggm-b" type="submit">Sign in</button><a id="ggm-hub" target="_top">Open GGM Portal</a></form>\';' +
  'document.body.appendChild(d);d.querySelector("h1").textContent=C.name;var h=el("ggm-hub");if(C.hub)h.href=C.hub;else h.style.display="none";' +
  'el("ggm-f").addEventListener("submit",function(ev){ev.preventDefault();var b=el("ggm-b");b.disabled=true;el("ggm-e").textContent="";' +
  'google.script.run.withSuccessHandler(function(r){P.token=r.token;ls(function(){localStorage.setItem(K,r.token)});el("ggm-pw").value="";go(r.user)})' +
  '.withFailureHandler(function(e){b.disabled=false;el("ggm-e").textContent=String(e&&e.message||e)}).ggmLogin(el("ggm-id").value,el("ggm-pw").value)})}' +
  'function start(){build();if(C.boot)return go(C.boot.user);if(!P.token)return card(true,C.error);' +
  'google.script.run.withSuccessHandler(go).withFailureHandler(function(e){P.signOut(dead(e)?"":String(e&&e.message||e))}).ggmMe(P.token)}' +
  'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start);else start();' +
  '})();</script>';

/* ------------------------------------------------------- profile photos
   GGM Portal writes "Portal Photos <APP ID>" into this app's sheet (Username, Name,
   Other names, Thumb, Photo; F1 = version), so no call back to the hub is needed.
   The page script below is an exact copy of the one in Portal.js: it puts each photo
   into elements marked data-ggm-photo="<username or name>" and shows it big on tap. */

function ggmPhotoSheet_() {
  var ss = GGM_APP.sheetId ? SpreadsheetApp.openById(GGM_APP.sheetId) : SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName('Portal Photos ' + GGM_APP.id);
}

/** Called by the page: { ver, list } or { ver, same: true }. */
function portalPhotos(ver) {
  var cache = CacheService.getScriptCache(), key = 'ggm_photos_' + GGM_APP.id;
  var got = null;
  try { var n = parseInt(cache.get(key + '_n'), 10); if (n > 0) { var ks = []; for (var i = 0; i < n; i++) ks.push(key + '_' + i);
    var all = cache.getAll(ks), parts = []; for (var j = 0; j < n; j++) { if (all[ks[j]] == null) { parts = null; break; } parts.push(all[ks[j]]); }
    if (parts) got = JSON.parse(parts.join('')); } } catch (e) { got = null; }
  if (!got) {
    var sh = ggmPhotoSheet_(), list = [], v = '';
    if (sh && sh.getLastRow() > 1) {
      v = String(sh.getRange(1, 6).getValue() || '');
      sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues().forEach(function (r) {
        var u = String(r[0] || '').trim(), t = String(r[3] || '');
        if (u && /^data:image\//.test(t)) list.push({ u: u, n: String(r[1] || u), a: String(r[2] || '').split('|').filter(String), t: t });
      });
    }
    got = { ver: v, list: list };
    try { var s = JSON.stringify(got), put = {}, c = 0;
      for (var k = 0; k < s.length; k += 90000) put[key + '_' + (c++)] = s.substr(k, 90000);
      put[key + '_n'] = String(c); cache.putAll(put, 300); } catch (e) {}
  }
  if (ver && String(ver) === got.ver) return { ver: got.ver, same: true };
  return got;
}

/** Called by the page when a photo is tapped: the sharp copy. */
function portalPhoto(username, ver) {
  var u = String(username || '').trim().toLowerCase();
  if (!u) return '';
  var cache = CacheService.getScriptCache();
  var key = 'ggm_ph_' + String(ver || '').slice(-8) + '_' + Utilities.base64EncodeWebSafe(u).slice(0, 180);
  var hit = cache.get(key);
  if (hit !== null) return hit;
  var sh = ggmPhotoSheet_(), p = '';
  if (sh && sh.getLastRow() > 1) {
    var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues();
    for (var i = 0; i < rows.length; i++) if (String(rows[i][0]).trim().toLowerCase() === u) { p = String(rows[i][4] || rows[i][3] || ''); break; }
  }
  try { if (p.length < 95000) cache.put(key, p, 1800); } catch (e) {}
  return p;
}

/** The page script, injected with window.PORTAL. Runs in the browser, never on the server. */
function portalPhotoTag_() {
  return '<script>(' + portalPhotoKit_.toString() + ')();' + String.fromCharCode(60) + '/script>';
}
function portalPhotoKit_() {
  if (window.GGMPhotos) return;
  var KEY = 'ggm_photos_v1', FRESH = 3 * 60000;
  var ver = '', list = [], byKey = {}, big = {}, pending = false, timer = 0, shownU = '';
  var me = (window.PORTAL && window.PORTAL.boot) || null;

  function norm(s) { return String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9\u0900-\u097F]+/g, ' ').trim(); }
  function index(l) {
    list = l || []; byKey = {};
    list.forEach(function (p) {
      [p.u, p.n].concat(p.a || []).forEach(function (k) { var n = norm(k); if (n && !byKey[n]) byKey[n] = p; });
    });
  }
  /* Username or full name first; a bare first name only when exactly one person has it. */
  function find(key) {
    if (String(key).indexOf('|') > -1) {           // "username|Full Name": first one that has a photo
      var ks = String(key).split('|');
      for (var k = 0; k < ks.length; k++) { var hit = find(ks[k]); if (hit) return hit; }
      return null;
    }
    if (key === '@me') return me ? (find(me.username || me.u || '') || find(me.name || '')) : null;
    var n = norm(key);
    if (!n) return null;
    if (byKey[n]) return byKey[n];
    if (n.indexOf(' ') < 0) {
      var hits = list.filter(function (p) {
        return [p.n].concat(p.a || []).some(function (x) { return norm(x).split(' ')[0] === n; });
      });
      if (hits.length === 1) return hits[0];
    }
    return null;
  }

  function paint() {
    timer = 0;
    var els = document.querySelectorAll('[data-ggm-photo]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i], p = find(el.getAttribute('data-ggm-photo')), t = (p && p.t) || '';
      // skip when already painted (and the page has not since reset the element's background)
      if (el.__ggmT === t && (!t || el.style.backgroundImage.indexOf(t.slice(-40)) > -1)) continue;
      el.__ggmT = t; el.__ggmP = t ? p : null;
      if (t) { el.style.setProperty('background-image', 'url("' + t + '")', 'important'); el.classList.add('ggm-ph'); }
      else { el.style.removeProperty('background-image'); el.classList.remove('ggm-ph'); }
    }
  }
  function soon() { if (!timer) timer = setTimeout(paint, 40); }

  function css() {
    if (document.getElementById('ggm-ph-css')) return;
    var st = document.createElement('style');
    st.id = 'ggm-ph-css';
    st.textContent =
      '.ggm-ph{background-size:cover!important;background-position:center!important;background-repeat:no-repeat!important;color:transparent!important;text-shadow:none!important}' +
      '.ggm-ph>*{visibility:hidden!important}' +
      '.ggm-ph:not([data-ggm-zoom="off"]){cursor:zoom-in}' +
      '#ggm-lb{position:fixed;inset:0;z-index:2147483000;background:rgba(12,11,10,.88);display:none;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;cursor:zoom-out}' +
      '#ggm-lb img{width:min(86vw,480px);height:auto;max-height:74vh;object-fit:contain;border-radius:22px;background:#222;box-shadow:0 20px 60px rgba(0,0,0,.5)}' +
      '#ggm-lb div{color:#fff;font:700 15px/1.3 system-ui,sans-serif;text-align:center}';
    (document.head || document.documentElement).appendChild(st);
  }

  function close() { var lb = document.getElementById('ggm-lb'); if (lb) lb.style.display = 'none'; shownU = ''; }
  function show(p) {
    var lb = document.getElementById('ggm-lb');
    if (!lb) {
      lb = document.createElement('div'); lb.id = 'ggm-lb';
      lb.appendChild(document.createElement('img')); lb.appendChild(document.createElement('div'));
      lb.addEventListener('click', close);
      document.body.appendChild(lb);
    }
    var img = lb.querySelector('img');
    img.src = big[p.u] || p.t;
    lb.querySelector('div').textContent = p.n || p.u;
    lb.style.display = 'flex'; shownU = p.u;
    if (big[p.u] || !(window.google && google.script && google.script.run)) return;
    google.script.run.withSuccessHandler(function (src) {
      if (!src) return;
      big[p.u] = src;
      if (shownU === p.u) img.src = src;
    }).withFailureHandler(function () {}).portalPhoto(p.u, ver);
  }

  function load(force) {
    var c = null;
    try { c = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
    if (c && c.list) {
      if (!list.length) { ver = c.ver || ''; index(c.list); soon(); }
      if (!force && Date.now() - (c.at || 0) < FRESH) return;
    }
    if (pending || !(window.google && google.script && google.script.run)) return;
    pending = true;
    google.script.run.withSuccessHandler(function (r) {
      pending = false;
      if (!r) return;
      if (!r.same) { ver = String(r.ver || ''); index(r.list || []); big = {}; }
      try { localStorage.setItem(KEY, JSON.stringify({ ver: ver, at: Date.now(), list: list })); } catch (e) {}
      paint();
    }).withFailureHandler(function () { pending = false; }).portalPhotos(ver);
  }

  // A tap on a photo shows it big, and does not also trigger the card or tile around it.
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('.ggm-ph') : null;
    if (!el || !el.__ggmP || el.getAttribute('data-ggm-zoom') === 'off') return;
    e.preventDefault(); e.stopPropagation();
    show(el.__ggmP);
  }, true);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') load(false); });

  new MutationObserver(soon).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-ggm-photo'] });
  window.GGMPhotos = { refresh: function () { load(true); }, find: find, paint: paint };
  function start() { css(); load(false); soon(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
}
