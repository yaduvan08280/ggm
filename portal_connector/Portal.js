/**************************************************************************
 * GGM PORTAL CONNECTOR — shared core (identical in every connected app)
 *
 * The master copy lives in  Main Dashboard/portal_connector/Portal.js.
 * Edit that copy and copy it into every app folder; never edit one alone.
 * Everything app-specific is in that app's PortalApp.js → portalAdapter_().
 *
 * Script Properties (Apps Script editor → Project Settings → Script properties):
 *   PORTAL_SECRET   the secret shown by the hub: Portal Admin → Connect selected app
 *   PORTAL_APP_ID   this app's App ID in the hub's Apps tab (e.g. INDENT)
 *   PORTAL_HUB_URL  the hub's /exec link
 *   PORTAL_ONLY     written by the hub's Portal-only switch — do not type it
 *
 * While PORTAL_SECRET is empty the app behaves exactly as it did before.
 *
 * Emergency: if the hub is down while Portal-only is ON, set PORTAL_ONLY to
 * false here by hand and this one app opens with its own link again.
 **************************************************************************/

var PORTAL_CFG_ = {
  SESSION_TTL: 21600,   // cache sessions live 6 h and are renewed while in use
  TOUCH_EVERY: 1800,    // an active session is re-saved at most every 30 min
  PASS_REUSE: 120       // a launch pass may reload its own page for this long
};

/* ---------------------------------------------------------------- setup */

function portalProps_() { return PropertiesService.getScriptProperties(); }

/* SPEED: every request needs 5–7 of these values; read them all in one call and keep
   them for the rest of this execution (each getProperty is its own round trip). */
var PORTAL_P_ = null;
function portalP_(k) { if (!PORTAL_P_) PORTAL_P_ = portalProps_().getProperties(); return PORTAL_P_[k] || ''; }
function portalSetP_(k, v) { portalProps_().setProperty(k, v); if (PORTAL_P_) PORTAL_P_[k] = v; }

function portalSecret_() { return portalP_('PORTAL_SECRET'); }
function portalEnabled_() { return !!portalSecret_(); }
function portalOnly_() { return portalEnabled_() && portalP_('PORTAL_ONLY') === 'true'; }
function portalHubUrl_() { return portalP_('PORTAL_HUB_URL'); }
function portalAppId_() { return portalP_('PORTAL_APP_ID'); }
function portalNow_() { return Math.floor(Date.now() / 1000); }

function portalHubLink_() {
  var hub = portalHubUrl_();
  if (!hub) return '';
  return hub + (hub.indexOf('?') > -1 ? '&' : '?') + 'app=' + encodeURIComponent(portalAppId_());
}

/** What the page is told about the portal (never secret). */
function portalInfo_() {
  return {
    enabled: portalEnabled_(),
    portalOnly: portalOnly_(),
    hubLink: portalHubLink_(),
    appId: portalAppId_()
  };
}

/* --------------------------------------------------------------- tokens
   Same format as the hub: base64url(JSON) + "." + base64url(HMAC-SHA256). */

function portalB64_(s) { return String(s).replace(/=+$/, ''); }
function portalPad_(s) { return s + '==='.slice((s.length + 3) % 4); }

function portalSign_(payload, secret) {
  var body = portalB64_(Utilities.base64EncodeWebSafe(JSON.stringify(payload), Utilities.Charset.UTF_8));
  var sig = portalB64_(Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(body, secret)));
  return body + '.' + sig;
}

function portalRead_(token, secret) {
  if (!token || typeof token !== 'string' || !secret) return null;
  var parts = token.split('.');
  if (parts.length !== 2) return null;
  var expect = portalB64_(Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(parts[0], secret)));
  if (!portalEq_(expect, parts[1])) return null;
  var p;
  try {
    p = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(portalPad_(parts[0]))).getDataAsString('UTF-8'));
  } catch (e) { return null; }
  if (!p || !p.exp || p.exp < portalNow_()) return null;
  return p;
}

function portalEq_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  var x = 0;
  for (var i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

/** Only the identity fields travel between hub, app and page. */
function portalClaims_(p) {
  p = p || {};
  return {
    u: String(p.u || ''),    // portal username
    n: String(p.n || ''),    // display name
    lu: String(p.lu || ''),  // the id this app knows the person by
    r: String(p.r || ''),    // role in this app
    s: String(p.s || ''),    // site in this app
    d: String(p.d || ''),    // doer name (task apps)
    e: String(p.e || ''),    // email
    p: String(p.p || '')     // phone
  };
}

/* ------------------------------------------------------------ doGet gate */

/**
 * Call first thing in doGet(e).
 *   gate.block → return it (expired pass, or Portal-only and no pass)
 *   gate.boot  → a session was started from a launch pass; hand it to the page
 */
function portalGate_(e) {
  var gate = { boot: null, block: null, info: portalInfo_() };
  if (!gate.info.enabled) return gate;

  var pt = e && e.parameter && e.parameter.pt;
  if (pt) {
    var claims = portalRead_(String(pt), portalSecret_());
    if (!claims || claims.t !== 'l' || claims.a !== gate.info.appId) {
      // An old pass (e.g. the phone reloaded the app later): with Portal-only OFF just open
      // the app normally (saved sign-in or its login); with ON it must come from the portal.
      if (gate.info.portalOnly) gate.block = portalPage_('This link has expired', 'Open the app again from GGM Portal.', true);
      return gate;
    }
    var cache = CacheService.getScriptCache();
    var seen = cache.get('pt_' + claims.j);
    if (seen) {                           // same pass, same page reloading: same session
      gate.boot = JSON.parse(seen);
      return gate;
    }
    try {
      gate.boot = portalAdapter_().startSession(portalClaims_(claims), 'portal');
      cache.put('pt_' + claims.j, JSON.stringify(gate.boot), PORTAL_CFG_.PASS_REUSE);
    } catch (err) {
      gate.block = portalPage_('Could not open the app', String(err && err.message || err), true);
    }
    return gate;
  }

  if (gate.info.portalOnly) {
    gate.block = portalPage_('Open through GGM Portal',
      'This app is opened from GGM Portal, where you sign in once for all apps.', true);
  }
  return gate;
}

/** Adds window.PORTAL = { boot, info } to the page, right after <head>. */
function portalInject_(out, gate) {
  var data = { boot: (gate && gate.boot) || null, info: (gate && gate.info) || portalInfo_() };
  var bad = new RegExp('[' + String.fromCharCode(60, 8232, 8233) + ']', 'g');   // < and the two JS line separators
  var js = JSON.stringify(data).replace(bad, function (c) { return String.fromCharCode(92) + 'u' + ('000' + c.charCodeAt(0).toString(16)).slice(-4); });
  var tag = '<script>window.PORTAL=' + js + ';</script>' + portalPhotoTag_();   // + profile photos (below)
  var html = out.getContent();
  html = /<head[^>]*>/i.test(html)
    ? html.replace(/<head[^>]*>/i, function (m) { return m + tag; })
    : tag + html;
  return HtmlService.createHtmlOutput(html);
}

function portalPage_(title, text, withHubButton) {
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };
  var link = portalHubLink_();
  var html =
    '<!doctype html><html><head><meta charset="utf-8"><style>' +
    'body{margin:0;min-height:100vh;display:grid;place-items:center;background:#F4F1E9;font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1B1A17;padding:20px;box-sizing:border-box}' +
    '.c{max-width:380px;width:100%;background:#FCFAF5;border:1px solid #E8E3D6;border-radius:22px;padding:26px;box-shadow:0 8px 24px -12px rgba(27,26,23,.18)}' +
    '.m{width:36px;height:36px;border-radius:10px;background:#F2C14E;margin-bottom:14px}' +
    'h1{font-size:20px;margin:0 0 6px;letter-spacing:-.02em}p{margin:0 0 18px;color:#6C685D}' +
    'a{display:block;text-align:center;background:#232220;color:#F6F2E7;text-decoration:none;padding:12px;border-radius:22px;font-weight:600}' +
    '</style></head><body><div class="c"><div class="m"></div><h1>' + esc(title) + '</h1><p>' + esc(text) + '</p>' +
    (withHubButton && link ? '<a href="' + esc(link) + '" target="_top">Go to GGM Portal</a>' : '') +
    '</div></body></html>';
  return HtmlService.createHtmlOutput(html)
    .setTitle(title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* ------------------------------------------------- hub → app (doPost) */

/** Call first thing in doPost(e). Returns a response, or null if not for the portal. */
function portalHandlePost_(e) {
  if (!e || !e.parameter || e.parameter.portal !== '1') return null;
  var out;
  try {
    if (!portalEnabled_()) throw new Error('This app is not connected yet (PORTAL_SECRET is empty).');
    var body = JSON.parse((e.postData && e.postData.contents) || '{}');
    var msg = portalRead_(body.p, portalSecret_());
    if (!msg || msg.t !== 'h') throw new Error('Bad signature or expired request. Check PORTAL_SECRET.');
    if (msg.a !== portalAppId_()) throw new Error('This app is "' + portalAppId_() + '", not "' + msg.a + '". Check PORTAL_APP_ID.');
    portalLearnHubUrl_(msg.hub);
    out = { ok: true, data: portalRunOp_(msg.op, msg.data || {}) };
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function portalRunOp_(op, data) {
  var ad = portalAdapter_();
  switch (op) {
    case 'ping':
      return { app: portalAppId_(), portalOnly: portalOnly_(), time: new Date().toISOString() };

    case 'meta':
      return ad.meta ? ad.meta() : {};

    case 'provision':                    // data.users = [ wanted user, … ]
      return (data.users || []).map(function (w) {
        try {
          var msg = ad.provision ? ad.provision(w) : 'nothing to write';
          if (!w.active) {
            if (ad.endSessions) ad.endSessions({ user: w });
            portalRevokeUser_(w.username);
          }
          return { username: w.username, ok: true, msg: msg || 'ok' };
        } catch (err) {
          return { username: w.username, ok: false, msg: String(err && err.message || err) };
        }
      });

    case 'counts':                       // data.users = [ {u, lu, r, s, d}, … ]
      return ad.counts ? ad.counts(data.users || []) : {};

    case 'listUsers':
      return ad.listUsers ? ad.listUsers() : [];

    case 'mode':
      var on = !!data.portalOnly;
      portalSetP_('PORTAL_ONLY', on ? 'true' : 'false');
      if (on) {
        portalBumpEpoch_();
        if (ad.endSessions) ad.endSessions({ direct: true });
      }
      return { portalOnly: on };

    default:
      throw new Error('Unknown request: ' + op);
  }
}

/* ------------------------------------------------- app → hub */

/* The hub sends its live address with every signed request; keep PORTAL_HUB_URL in step with it.
   (Every app was once given the editor's test address, which answers 404 to everyone else.) */
function portalLearnHubUrl_(url) {
  url = String(url || '');
  if (!/^https:\/\/script\.google\.com\/(a\/[A-Za-z0-9.-]+\/)?macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url)) return;
  if (url !== portalHubUrl_()) portalSetP_('PORTAL_HUB_URL', url);
}

function portalCallHub_(op, data) {
  var url = portalHubUrl_();
  if (!url) throw new Error('PORTAL_HUB_URL is not set in this app.');
  var p = portalSign_({
    t: 'a', a: portalAppId_(), op: op, data: data || {},
    j: Utilities.getUuid(), exp: portalNow_() + 120
  }, portalSecret_());
  var res = UrlFetchApp.fetch(url + (url.indexOf('?') > -1 ? '&' : '?') + 'portal=1', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ app: portalAppId_(), p: p }),
    muteHttpExceptions: true,
    followRedirects: true
  });
  var j;
  try { j = JSON.parse(res.getContentText()); }
  catch (e) { throw new Error('GGM Portal did not answer (HTTP ' + res.getResponseCode() + '). Try again.'); }
  if (!j.ok) throw new Error(j.error || 'GGM Portal refused the request.');
  return j.data;
}

/**
 * Login through the app's own link while Portal-only is OFF: the portal
 * username/phone + password are checked by the hub (and the app's tick).
 * Returns whatever the adapter's startSession returns.
 */
function portalRemoteLogin_(id, pw) {
  if (portalOnly_()) throw new Error('This app is opened from GGM Portal only.');
  id = String(id || '').trim();
  pw = String(pw || '');
  if (!id || !pw) throw new Error('Enter your username (or phone) and password.');
  var claims = portalCallHub_('verify', { id: id, pw: pw });
  return portalAdapter_().startSession(portalClaims_(claims), 'direct');
}

/* ------------------------------------------------- editor-only tools */

/** Setup / menu / maintenance functions: allowed for someone working in the editor or
    the sheet, refused for a web-app visitor (who could otherwise call any public
    function from the browser console). Do NOT put this in trigger handlers. */
function portalAssertEditor_() {
  var active = Session.getActiveUser().getEmail();
  if (!active || active !== Session.getEffectiveUser().getEmail()) {
    throw new Error('Run this from the Apps Script editor or the spreadsheet menu.');
  }
}

/* ------------------------------------------------- cache sessions
   For apps that had no server-side session of their own. */

function portalEpoch_() { return portalP_('PORTAL_EPOCH') || '0'; }
function portalBumpEpoch_() { portalSetP_('PORTAL_EPOCH', String(Number(portalEpoch_()) + 1)); }

function portalRevoked_() {
  try { return JSON.parse(portalP_('PORTAL_REVOKED') || '{}'); } catch (e) { return {}; }
}

function portalRevokeUser_(username) {
  if (!username) return;
  var map = portalRevoked_();
  var now = portalNow_();
  // A cache session untouched for SESSION_TTL is gone, and a touched one is checked
  // against this list, so older entries can never matter (keeps under the 9 KB limit).
  Object.keys(map).forEach(function (k) { if (now - map[k] > PORTAL_CFG_.SESSION_TTL) delete map[k]; });
  map[String(username).toLowerCase()] = now;
  portalSetP_('PORTAL_REVOKED', JSON.stringify(map));
}

/** src: 'portal' (launch pass) · 'direct' (own link, hub-checked) · 'legacy' (old login, portal off) */
function portalNewSession_(claims, src) {
  var tok = 'S' + Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  var rec = portalClaims_(claims);
  rec.src = src;
  rec.iat = portalNow_();
  rec.t = rec.iat;
  rec.ep = portalEpoch_();
  CacheService.getScriptCache().put('ps_' + tok, JSON.stringify(rec), PORTAL_CFG_.SESSION_TTL);
  return tok;
}

/** The session behind a token, or throws Error('SESSION_EXPIRED'). */
function portalCheck_(token) {
  token = String(token || '');
  var cache = CacheService.getScriptCache();
  var raw = token ? cache.get('ps_' + token) : null;
  if (!raw) throw new Error('SESSION_EXPIRED');
  var rec = JSON.parse(raw);
  if (!portalSessionAllowed_(rec)) {
    cache.remove('ps_' + token);
    throw new Error('SESSION_EXPIRED');
  }
  if (portalNow_() - rec.t > PORTAL_CFG_.TOUCH_EVERY) {
    rec.t = portalNow_();
    cache.put('ps_' + token, JSON.stringify(rec), PORTAL_CFG_.SESSION_TTL);
  }
  return rec;
}

function portalEndSession_(token) {
  if (token) CacheService.getScriptCache().remove('ps_' + String(token));
}

function portalSessionAllowed_(rec) {
  if (!portalEnabled_()) return rec.src === 'legacy';
  // Old site / mobile logins keep working while Portal-only is OFF (links already handed out stay usable);
  // switching Portal-only ON ends them.
  if (rec.src === 'legacy') return !portalOnly_() && rec.ep === portalEpoch_();
  if (rec.src !== 'portal') {
    if (portalOnly_()) return false;
    if (rec.ep !== portalEpoch_()) return false;
  }
  var rv = portalRevoked_()[String(rec.u || '').toLowerCase()];
  if (rv && rv >= rec.iat) return false;
  return true;
}

/* ------------------------------------------------------- profile photos
   People add a photo in GGM Portal (account menu). This app fetches the photos
   from the hub over the signed channel and the page script below puts them in
   every element marked  data-ggm-photo="<username or name>"  ("@me" = whoever
   opened the app from the portal; "a|b" tries a, then b). Tapping a photo shows it full size, unless the
   element also has data-ggm-zoom="off" (e.g. an avatar that opens a menu). */

/** Called by the page: { ver, list } or { ver, same: true } when nothing changed. */
function portalPhotos(ver) {
  if (!portalEnabled_()) return { ver: '', list: [] };
  var got = portalBigGet_('ggm_photos');
  if (!got) {
    var r = portalCallHub_('photos', {}) || {};
    got = { ver: String(r.ver || ''), list: r.list || [] };
    portalBigPut_('ggm_photos', got, 300);
  }
  if (ver && String(ver) === got.ver) return { ver: got.ver, same: true };
  return got;
}

/** Called by the page when a photo is tapped: the sharp, full-size copy. */
function portalPhoto(username, ver) {
  if (!portalEnabled_()) return '';
  var u = String(username || '').trim().toLowerCase();
  if (!u) return '';
  var cache = CacheService.getScriptCache();
  var key = 'ggm_ph_' + String(ver || '').slice(-8) + '_' + Utilities.base64EncodeWebSafe(u).slice(0, 180);
  var hit = cache.get(key);
  if (hit !== null) return hit;
  var p = String((portalCallHub_('photo', { u: u }) || {}).p || '');
  try { if (p.length < 95000) cache.put(key, p, 1800); } catch (e) {}
  return p;
}

/* Cache values over 100 KB are split across several keys. */
function portalBigPut_(key, obj, secs) {
  try {
    var s = JSON.stringify(obj), put = {}, n = 0;
    for (var i = 0; i < s.length; i += 90000) put[key + '_' + (n++)] = s.substr(i, 90000);
    put[key + '_n'] = String(n);
    CacheService.getScriptCache().putAll(put, secs);
  } catch (e) {}
}
function portalBigGet_(key) {
  try {
    var cache = CacheService.getScriptCache();
    var n = parseInt(cache.get(key + '_n'), 10);
    if (!(n > 0)) return null;
    var keys = [];
    for (var i = 0; i < n; i++) keys.push(key + '_' + i);
    var got = cache.getAll(keys), parts = [];
    for (var j = 0; j < keys.length; j++) { if (got[keys[j]] == null) return null; parts.push(got[keys[j]]); }
    return JSON.parse(parts.join(''));
  } catch (e) { return null; }
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
