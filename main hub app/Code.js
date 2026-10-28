/**************************************************************************
 * GGM PORTAL — HUB  (master login + app launcher + user control)
 *
 * Put this in an Apps Script project that is BOUND to the master control
 * sheet (open the sheet → Extensions → Apps Script). Files in the project:
 *   Code.gs    ← this file
 *   Index.html ← the portal screen
 *
 * Deploy → New deployment → Web app
 *   Execute as: Me        Who has access: Anyone
 * Later changes: Manage deployments → edit → New version (keeps the same URL).
 *
 * Sheet tabs (created by "Portal Admin → Set up / repair tabs"):
 *   Users       one row per person: login, name, phone, email, active, admin
 *   Apps        one row per app / dashboard: ID, name, icon, URL, type, fields
 *   Access      per user: one ✓ per app, plus Role / Site / Doer name where the app has them
 *   App Logins  only for exceptions: a person's id inside an app differs
 *   Settings    Portal-only switch state and a few options (script-written)
 *   Sync        result of pushing each user into each app (script-written)
 *   Lists       dropdown values reported by each app (hidden, script-written)
 *   Badges      last pending counts (hidden, script-written)
 *   Import      one-time list of users already inside the apps
 *   Log         logins, app opens, syncs, switch changes
 *
 * DO NOT reorder the columns of Users / Apps / App Logins. Add extra
 * columns only at the far right.
 **************************************************************************/

const PORTAL_CFG = {
  TITLE: 'GGM Portal',
  SESSION_HOURS: 168,    // how long a phone stays signed in to the portal (1 week; a password change still signs it out)
  LAUNCH_SECONDS: 90,    // life of the one-time pass handed to an app when a tile is tapped
  MAX_FAILS: 5,          // wrong passwords in a row before the login is locked
  LOCK_MINUTES: 10,
  LOG_OPENS: true,       // write every app open to the Log tab
  LOG_MAX_ROWS: 20000,   // oldest log rows are trimmed past this
  OTP_MINUTES: 10,       // life of an emailed reset code
  OTP_TRIES: 5,          // wrong codes before the code is thrown away
  OTP_RESEND_SECONDS: 60,
  OTP_PER_HOUR: 5,
  MIN_PASSWORD: 6,
  BADGE_CACHE_SECONDS: 1800
};

const TABS = {
  USERS:    { name: 'Users',      head: ['Username', 'Name', 'Phone', 'Active', 'Set Password', 'Password Hash', 'Salt', 'Last Login', 'Notes', 'Email', 'Password Set', 'Created', 'Portal Admin', 'Designation'] },
  APPS:     { name: 'Apps',       head: ['App ID', 'Name', 'Icon', 'Color', 'URL', 'Active', 'Order', 'Match By', 'Notes', 'Type', 'Fields', 'Badges', 'Sheet ID'] },
  ACCESS:   { name: 'Access',     head: ['USER', ''], built: true },   // two header rows, built by syncAccess_()
  DESIGNATIONS: { name: 'Designations', head: ['DESIGNATION'], built: true },   // built by syncDesignations_()
  SHEETS:   { name: 'Sheets',     head: ['Name', 'Link', 'Site', 'Designation'], built: true },   // + one ✓ column per user
  FORMS:    { name: 'Forms',      head: ['Name', 'Link', 'Site', 'Designation'], built: true },
  DLINKS:   { name: 'Designation Links', head: ['DESIGNATION'], built: true },   // designations × sheets / forms
  LOGINS:   { name: 'App Logins', head: ['Username', 'App ID', 'Local Username', 'App Role', 'Notes'] },
  SETTINGS: { name: 'Settings',   head: ['Setting', 'Value', 'Changed By', 'Changed At'] },
  SYNC:     { name: 'Sync',       head: ['Username', 'App', 'Local ID', 'Wanted', 'Status', 'Message', 'Last Sync', 'Hash'] },
  LISTS:    { name: 'Lists',      head: ['(dropdown values written by "Refresh dropdowns from apps")'] },
  BADGES:   { name: 'Badges',     head: ['App', 'Counts (JSON)', 'Updated', 'Error'] },
  IMPORT:   { name: 'Import',     head: ['Source App', 'Local ID', 'Name', 'Phone', 'Email', 'Role', 'Site', 'Suggested Username', 'Match'] },
  LOG:      { name: 'Log',        head: ['Time', 'Username', 'Action', 'App ID', 'Detail'] }
};

// Column positions (0-based) — must match the heads above
const U = { USER: 0, NAME: 1, PHONE: 2, ACTIVE: 3, SETPW: 4, HASH: 5, SALT: 6, LAST: 7, NOTES: 8, EMAIL: 9, PWSET: 10, CREATED: 11, ADMIN: 12, DESIG: 13 };
const A = { ID: 0, NAME: 1, ICON: 2, COLOR: 3, URL: 4, ACTIVE: 5, ORDER: 6, MATCH: 7, NOTES: 8, TYPE: 9, FIELDS: 10, BADGES: 11, SHEET: 12 };
const L = { USER: 0, APP: 1, LOCAL: 2, ROLE: 3 };

const FIELD_LABEL = { role: 'Role', site: 'Site', doer: 'Doer name' };

/** What the number on a tile means, per App ID. Anything else says "pending". */
const BADGE_WORDS = {
  INDENT: 'waiting on you', FUEL: 'due', ASSETS: 'to receive', STAFF: 'pending',
  MAINADMIN: 'to review', LEVANTO: 'need attention', NEWAI_TASKS: 'pending', TONK_TASKS: 'pending', JAIPUR_TASKS: 'pending',
  DELEGATION: 'to follow up',
  // the App IDs used in the live Apps tab
  PURCHASE: 'waiting on you', 'STAFF DASHBOARD': 'pending', 'MAIN ADMIN': 'to review',
  'JAIPUR CHECKLIST': 'pending', 'NEWAI CHECKLIST': 'pending', 'TONK CHECKLIST': 'pending'
};

/** Apps rows written by Set up when the Apps tab is still empty. Paste each app's /exec link into URL. */
const DEFAULT_APPS = [
  // App ID, Name, Icon, Color, URL, Active, Order, Match By, Notes, Type, Fields, Badges, Sheet ID
  // Sheet ID filled = the app uses the v2 login: its people are written to "Portal Users <ID>" in that sheet.
  ['INDENT', 'Indent Flow', '📦', '#4F46E5', '', true, 1, 'Username', 'folder indent_flow', 'CONNECTED', 'role,site', true, ''],
  ['FUEL', 'Fuel & Car Tasks', '⛽', '#0E7490', '', true, 2, 'Email', 'folder fuel_and_car_tasks · username used if no email', 'CONNECTED', '', true, ''],
  ['ASSETS', 'GGM Assets', '🚜', '#B45309', '', true, 3, 'Username', 'folder assets', 'CONNECTED', 'role,site', true, ''],
  ['STAFF', 'Staff Dashboard', '✅', '#15803D', '', true, 4, 'Doer name', 'folder Staff_Dashboard (script 1tJHy…)', 'CONNECTED', 'doer', true, ''],
  ['MAINADMIN', 'Main Admin Dashboard', '🛡️', '#7C3AED', '', true, 5, 'Username', 'folder main_admin_dashboard (script 12hlS…)', 'CONNECTED', '', true, ''],
  ['NEWAI_TASKS', 'Newai Checklist', '📋', '#0369A1', '', true, 6, 'Doer name', 'folder newai_checklist · Newai routine sheet Doer List', 'CONNECTED', 'doer', true, ''],
  ['TONK_TASKS', 'Tonk Checklist', '🗂️', '#BE185D', '', true, 7, 'Doer name', 'folder tonk_checklist · Role = DRIVER or STAFF screen', 'CONNECTED', 'role,doer', true, ''],
  ['JAIPUR_TASKS', 'Jaipur Checklist', '📝', '#0F766E', '', true, 8, 'Doer name', 'folder jaipur_checklist · Role USER (needs doer) or ADMIN', 'CONNECTED', 'role,doer', true, ''],
  ['DELEGATION', 'Task Delegation', '📌', '#1D4ED8', '', true, 12, 'Username', 'folder task delegation · v2 login (Portal Users tab in the Delegated sheet)', 'CONNECTED', '', true, '1tEUckPww1GiD-PgP7yxMxt70W1Q-ueoUGXdI8_-Aq8A'],
  ['MINES', 'Mines Dashboard', 'mine', '#57534E', 'https://script.google.com/macros/s/AKfycbwFb2igRK_NkLwrWbjohB8mCFZGwTM2g1BE7k3uTYwkQ5UWR6e034M2AYCLsEECFLiegg/exec', true, 9, 'Username', 'public link', 'LINK', '', false, ''],
  ['COLLECTION', 'Collection Dashboard', 'wallet', '#9A3412', 'https://script.google.com/macros/s/AKfycbxo81rUG8fcE8IhD_iYFTc2haI1y37QIKCulwYlIfy62yIx_tz34VOaCYWg8X8NdnXu/exec', true, 10, 'Username', 'public link', 'LINK', '', false, ''],
  ['LEVANTO', 'Levanto Production', 'factory', '#1F2937', 'https://script.google.com/macros/s/AKfycbw2Gu-OCMbkCj3oDa5prBNQc_9UR3kFfK8c0aRnA2Hbdvh0hjC7nnDz03WbVe-jSZQ/exec', true, 11, 'Username', 'public link · badge read from its sheet', 'LINK', '', true, '']
];

/** Default Settings rows, created by Set up if missing. */
const DEFAULT_SETTINGS = [
  ['PORTAL_ONLY', 'OFF'],
  ['LEVANTO_APP_ID', 'LEVANTO'],
  ['LEVANTO_SHEET_ID', '1Cy3Li1uXx_wkCcrk893WKK2DLRttKTjrsnafb5DsJbY'],
  ['LEVANTO_ALERTS_TAB', 'Grade Alerts'],
  ['LEVANTO_OPEN_HEADER', ''],       // blank = guess; the column that is empty (or = OPEN_VALUE) while unanswered
  ['LEVANTO_OPEN_VALUE', ''],        // blank = "cell is empty"
  ['LEVANTO_TIME_HEADER', ''],       // blank = guess; when the alert was raised
  ['LEVANTO_WINDOW_HOURS', '3']      // only alerts younger than this count; 0 = any age
];


/* ======================================================================
 * WEB APP
 * ==================================================================== */

function doGet(e) {
  const t = HtmlService.createTemplateFromFile('Index');
  t.title = PORTAL_CFG.TITLE;
  // ?app=INDENT opens that app straight after sign-in (used by Telegram buttons and the apps' "Go to portal")
  t.startApp = String((e && e.parameter && e.parameter.app) || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  return t.evaluate()
    .setTitle(PORTAL_CFG.TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/** Apps call the hub here (signed with their own secret): verify a login, list users. */
function doPost(e) {
  let out;
  try {
    if (!e || !e.parameter || e.parameter.portal !== '1') throw new Error('Not a portal request.');
    const body = JSON.parse((e.postData && e.postData.contents) || '{}');
    // spaces stay: live App IDs such as "MAIN ADMIN" have one, and their secret is stored under that exact name
    const appId = String(body.app || '').replace(/[^A-Za-z0-9 _-]/g, '').trim();
    const secret = prop_('APP_SECRET_' + appId);
    if (!secret) throw new Error('App "' + appId + '" is not connected to the portal.');
    const msg = readToken_(body.p, secret);
    if (!msg || msg.t !== 'a' || msg.a !== appId) throw new Error('Bad signature or expired request.');
    out = { ok: true, data: handleAppRequest_(appId, msg.op, msg.data || {}) };
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function handleAppRequest_(appId, op, data) {
  if (op === 'verify') return verifyForApp_(appId, data.id, data.pw);
  if (op === 'directory') return directory_(String(data.app || ''));
  if (op === 'photos') return appPhotos_(data);   // profile photos (Photos.js)
  if (op === 'photo') return appPhoto_(data);
  throw new Error('Unknown request: ' + op);
}

/* ---- Functions the portal page calls (google.script.run) ------------ */

/** Sign in with username OR phone OR email + password. Returns a session + the app list. */
function login(id, pw) {
  const user = checkPassword_(id, pw);
  sheet_(TABS.USERS).getRange(user.row, U.LAST + 1).setValue(new Date());
  log_(user.username, 'LOGIN', '', '');
  return { session: newSession_(user), home: buildHome_(user) };
}

/** Re-open the portal with a saved session (called when the page loads). */
function getHome(session) {
  return buildHome_(requireSession_(session));
}

/** Tile tapped (or the portal pre-loading the person's most-used app) → check access again → app URL with a one-time pass. */
function launchApp(session, appId, why) {
  const user = requireSession_(session);
  appId = String(appId || '');

  const app = getApps_().filter(function (a) { return a.id === appId; })[0];
  if (!app || !app.active || !app.url) throw new Error('This app is not available right now.');
  const acc = getAccess_(user.username)[appId];
  if (!acc || !acc.on) {
    log_(user.username, 'DENIED', appId, 'not assigned');
    throw new Error('You do not have access to ' + app.name + '.');
  }

  if (app.type === 'LINK') {                    // public dashboards: nothing to sign
    if (PORTAL_CFG.LOG_OPENS) log_(user.username, 'OPEN', appId, 'link');
    return { url: app.url };
  }

  const secret = appKey_(app);
  if (!secret) throw new Error(app.name + ' is not connected to the portal yet. Contact the IT admin.');

  const pass = signToken_(Object.assign(claimsFor_(user, app, acc), {
    t: 'l',                 // launch pass
    a: appId,               // only valid for this app
    j: Utilities.getUuid(), // unique id, lets the app refuse a re-used pass
    exp: now_() + PORTAL_CFG.LAUNCH_SECONDS
  }), secret);

  if (PORTAL_CFG.LOG_OPENS) log_(user.username, 'OPEN', appId, why === 'preload' ? 'preloaded' : '');
  return { url: app.url + (app.url.indexOf('?') > -1 ? '&' : '?') + 'pt=' + encodeURIComponent(pass) };
}

/** Change own password from the portal. Signs out every other phone of this user. */
function changePassword(session, oldPw, newPw) {
  const user = requireSession_(session);
  oldPw = String(oldPw || '');
  newPw = String(newPw || '');
  if (!safeEq_(hashPassword_(oldPw, user.salt), user.hash)) throw new Error('Current password is wrong.');
  if (newPw.length < PORTAL_CFG.MIN_PASSWORD) throw new Error('New password must be at least ' + PORTAL_CFG.MIN_PASSWORD + ' characters.');
  const hash = setPassword_(user, newPw);
  log_(user.username, 'PASSWORD_CHANGED', '', 'by user');
  user.hash = hash;
  return { session: newSession_(user) };
}

/** After closing an app: fresh pending count for that one app and person. */
function refreshBadge(session, appId) {
  const user = requireSession_(session);
  const app = getApps_().filter(function (a) { return a.id === appId; })[0];
  if (!app || !app.badges) return null;
  const acc = getAccess_(user.username)[appId];
  if (!acc || !acc.on) return null;
  try {
    let n;
    if (app.id === levantoAppId_()) n = levantoCount_();
    else {
      const res = callApp_(app, 'counts', { users: [badgeUser_(user, app, acc)] });
      n = res ? res[user.username] : null;
    }
    if (typeof n === 'number') {
      const all = readBadges_(app.id) || {};
      if (app.id === levantoAppId_()) all['*'] = n; else all[user.username] = n;
      writeBadgeCache_(app.id, all, undefined, true);
      return n;
    }
  } catch (e) { /* the old number stays */ }
  return null;
}


/* ======================================================================
 * PASSWORD RESET BY EMAIL CODE (also used for first-time set)
 * ==================================================================== */

/** Step 1: email a 6-digit code. Returns the masked address. */
function otpStart(id) {
  const user = findUser_(String(id || '').trim());
  if (!user) throw new Error('We could not find that username or phone.');
  if (!user.active) throw new Error('This account is switched off. Contact the IT admin.');
  if (!user.email) throw new Error('No email address is saved for this account. Ask the IT admin to set your password.');

  const cache = CacheService.getScriptCache();
  const key = user.username.toLowerCase();
  if (cache.get('otpcd_' + key)) throw new Error('A code was just sent. Wait a minute before asking again.');
  const sent = Number(cache.get('otph_' + key) || 0);
  if (sent >= PORTAL_CFG.OTP_PER_HOUR) throw new Error('Too many codes asked for. Try again in an hour.');

  const code = String(parseInt(Utilities.getUuid().replace(/-/g, '').slice(0, 10), 16) % 1000000);
  const six = ('000000' + code).slice(-6);
  cache.put('otp_' + key, JSON.stringify({ h: otpHash_(six, key), n: 0 }), PORTAL_CFG.OTP_MINUTES * 60);
  cache.put('otpcd_' + key, '1', PORTAL_CFG.OTP_RESEND_SECONDS);
  cache.put('otph_' + key, String(sent + 1), 3600);

  MailApp.sendEmail({
    to: user.email,
    name: PORTAL_CFG.TITLE,
    subject: PORTAL_CFG.TITLE + ' — your code is ' + six,
    htmlBody:
      '<div style="font-family:Arial,Helvetica,sans-serif;max-width:460px;margin:0 auto;padding:24px;color:#1B1A17">' +
      '<div style="font-size:12px;letter-spacing:2px;color:#9A968B;font-weight:700">GGM PORTAL</div>' +
      '<h2 style="margin:8px 0 4px">Set your password</h2>' +
      '<p style="color:#6C685D;font-size:14px;line-height:1.6">Hi ' + esc_(user.name) + ', use this code to set a new password for <b>' + esc_(user.username) + '</b>.</p>' +
      '<div style="margin:22px 0;padding:18px;background:#FBEFCB;border:1px solid #EED9A2;border-radius:12px;text-align:center;font-size:34px;font-weight:800;letter-spacing:10px">' + six + '</div>' +
      '<p style="color:#6C685D;font-size:13px">The code expires in ' + PORTAL_CFG.OTP_MINUTES + ' minutes. If you did not ask for it, ignore this email: your password stays the same.</p></div>'
  });
  log_(user.username, 'OTP_SENT', '', maskEmail_(user.email));
  return { masked: maskEmail_(user.email) };
}

/** Step 2: check the code without using it up (wrong tries still count). */
function otpCheck(id, code) {
  otpVerify_(id, code, false);
  return true;
}

/** Step 3: code + new password → saved, signed in. */
function otpFinish(id, code, newPw) {
  newPw = String(newPw || '');
  if (newPw.length < PORTAL_CFG.MIN_PASSWORD) throw new Error('Password must be at least ' + PORTAL_CFG.MIN_PASSWORD + ' characters.');
  const user = otpVerify_(id, code, true);
  const hash = setPassword_(user, newPw);
  sheet_(TABS.USERS).getRange(user.row, U.LAST + 1).setValue(new Date());
  log_(user.username, 'PASSWORD_RESET', '', 'via email code');
  user.hash = hash;
  return { session: newSession_(user), home: buildHome_(user) };
}

function otpVerify_(id, code, consume) {
  const user = findUser_(String(id || '').trim());
  if (!user || !user.active) throw new Error('That code is not valid. Ask for a new one.');
  const key = user.username.toLowerCase();
  const cache = CacheService.getScriptCache();
  const raw = cache.get('otp_' + key);
  if (!raw) throw new Error('That code has expired. Ask for a new one.');
  const rec = JSON.parse(raw);
  if (!safeEq_(otpHash_(String(code || '').replace(/\D/g, ''), key), rec.h)) {
    rec.n++;
    if (rec.n >= PORTAL_CFG.OTP_TRIES) cache.remove('otp_' + key);
    else cache.put('otp_' + key, JSON.stringify(rec), PORTAL_CFG.OTP_MINUTES * 60);
    log_(user.username, 'OTP_FAIL', '', 'try ' + rec.n);
    throw new Error(rec.n >= PORTAL_CFG.OTP_TRIES ? 'Too many wrong codes. Ask for a new one.' : 'That code is not correct.');
  }
  if (consume) cache.remove('otp_' + key);
  return user;
}

function otpHash_(code, key) {
  return toHex_(Utilities.computeHmacSha256Signature(Utilities.newBlob(key + ':' + code).getBytes(), Utilities.newBlob(pepper_()).getBytes()));
}

function maskEmail_(email) {
  const m = String(email).split('@');
  if (m.length !== 2) return '•••';
  return m[0].charAt(0) + '•••••@' + m[1];
}


/* ======================================================================
 * ADMIN SCREEN (Portal Admin users only) — the Portal-only switch
 * ==================================================================== */

function getAdminState(session) {
  requireAdmin_(session);
  return adminState_();
}

function setPortalOnly(session, on) {
  const admin = requireAdmin_(session);
  on = !!on;
  setSettings_([['PORTAL_ONLY', on ? 'ON' : 'OFF', admin.username]].concat(
    httpApps_().map(function (a) { return ['MODE · ' + a.id, 'PENDING', '']; })));
  pushMode_();
  log_(admin.username, on ? 'MODE_ON' : 'MODE_OFF', '', 'Portal-only switched ' + (on ? 'ON' : 'OFF'));
  return adminState_();
}

function adminState_() {
  const s = settingsMap_();
  const rows = settingsRows_();
  const who = rows.filter(function (r) { return r.key === 'PORTAL_ONLY'; })[0] || {};
  return {
    portalOnly: String(s.PORTAL_ONLY || 'OFF').toUpperCase() === 'ON',
    changedBy: who.by || '',
    changedAt: who.at ? Utilities.formatDate(new Date(who.at), Session.getScriptTimeZone(), 'dd MMM yyyy, HH:mm') : '',
    // every app that should be gated — an unconnected one stays open with its own link, so say so
    apps: getApps_().filter(function (a) { return a.type === 'CONNECTED' && a.active && a.url; }).map(function (a) {
      if (a.sheetId) return { id: a.id, name: a.name, state: 'OK PORTAL LOGIN' };   // v2: only portal people can sign in, always
      const connected = !!prop_('APP_SECRET_' + a.id);
      return { id: a.id, name: a.name, state: connected ? String(s['MODE · ' + a.id] || 'PENDING') : 'NOT CONNECTED' };
    })
  };
}

/** Sends the switch position to every connected app; failures stay PENDING and are retried each minute. */
function pushMode_() {
  const on = String(settingsMap_().PORTAL_ONLY || 'OFF').toUpperCase() === 'ON';
  const apps = httpApps_().filter(function (a) { return String(settingsMap_()['MODE · ' + a.id] || '') !== 'OK ' + (on ? 'ON' : 'OFF'); });
  if (!apps.length) return;
  const results = callAppsParallel_(apps.map(function (a) { return { app: a, op: 'mode', data: { portalOnly: on } }; }));
  setSettings_(results.map(function (r, i) {
    return ['MODE · ' + apps[i].id, r.ok ? 'OK ' + (on ? 'ON' : 'OFF') : 'PENDING', '', r.ok ? '' : r.error];
  }));
}


/* ======================================================================
 * SESSION + TOKENS
 * ==================================================================== */

function checkPassword_(id, pw) {
  id = String(id || '').trim();
  pw = String(pw || '');
  if (!id || !pw) throw new Error('Enter your username and password.');

  const cache = CacheService.getScriptCache();
  const failKey = 'fail_' + id.toLowerCase();
  const fails = Number(cache.get(failKey) || 0);
  if (fails >= PORTAL_CFG.MAX_FAILS) {
    throw new Error('Too many wrong attempts. Try again in ' + PORTAL_CFG.LOCK_MINUTES + ' minutes.');
  }

  const user = findUser_(id);
  const pwOk = !!(user && user.hash && safeEq_(hashPassword_(pw, user.salt), user.hash));

  if (!pwOk) {
    cache.put(failKey, String(fails + 1), PORTAL_CFG.LOCK_MINUTES * 60);
    log_(id, 'LOGIN_FAIL', '', user ? (user.hash ? 'wrong password' : 'no password set yet') : 'unknown user');
    if (user && !user.hash) throw new Error('No password is set yet. Use "First time here?" to set one.');
    throw new Error('Username or password is wrong.'); // same message either way
  }
  if (!user.active) {
    log_(user.username, 'LOGIN_BLOCKED', '', 'user inactive');
    throw new Error('This account is switched off. Contact the IT admin.');
  }
  cache.remove(failKey);
  return user;
}

function newSession_(user) {
  return signToken_({
    t: 's',
    u: user.username,
    pv: user.hash.slice(0, 12),  // changing the password kills old sessions
    exp: now_() + PORTAL_CFG.SESSION_HOURS * 3600
  }, hubSecret_());
}

/** Valid session + user still exists + still active + same password → user. */
function requireSession_(session) {
  const p = readToken_(session, hubSecret_());
  if (!p || p.t !== 's') throw new Error('SESSION_EXPIRED');
  const user = findUser_(p.u, true);
  if (!user || !user.active || !user.hash || user.hash.slice(0, 12) !== p.pv) throw new Error('SESSION_EXPIRED');
  return user;
}

function requireAdmin_(session) {
  const user = requireSession_(session);
  if (!user.admin) throw new Error('Only Portal Admin accounts can do this.');
  return user;
}

function setPassword_(user, newPw) {
  const salt = randomHex_(24);
  const hash = hashPassword_(newPw, salt);
  const sh = sheet_(TABS.USERS);
  sh.getRange(user.row, U.HASH + 1, 1, 2).setValues([[hash, salt]]);
  sh.getRange(user.row, U.PWSET + 1).setValue(true);
  forgetTabs_();
  syncDirectSafe_();                                    // the new password works in v2 apps at once
  return hash;
}

/** token = base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload, secret)) */
function signToken_(payload, secret) {
  const body = b64url_(Utilities.base64EncodeWebSafe(JSON.stringify(payload), Utilities.Charset.UTF_8));
  const sig = b64url_(Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(body, secret)));
  return body + '.' + sig;
}

function readToken_(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const expect = b64url_(Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(parts[0], secret)));
  if (!safeEq_(expect, parts[1])) return null;
  let p;
  try {
    p = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(pad64_(parts[0]))).getDataAsString('UTF-8'));
  } catch (e) { return null; }
  if (!p || !p.exp || p.exp < now_()) return null;
  return p;
}

function hashPassword_(pw, salt) {
  const key = Utilities.newBlob(pepper_()).getBytes();
  let h = Utilities.computeHmacSha256Signature(Utilities.newBlob(String(salt) + ':' + pw).getBytes(), key);
  for (let i = 0; i < 150; i++) h = Utilities.computeHmacSha256Signature(h, key); // slows down guessing
  return toHex_(h);
}

/** What an app is told about a person (inside a launch pass or a verify answer). */
function claimsFor_(user, app, acc) {
  const map = getLocalLogin_(user.username, app.id);
  return {
    u: user.username,
    n: user.name,
    lu: localIdFor_(user, app, acc, map),
    r: map.role || acc.role || '',
    s: acc.site || '',
    d: acc.doer || '',
    e: user.email || '',
    p: user.phone || ''
  };
}

/** The id this app knows the person by. */
function localIdFor_(user, app, acc, map) {
  if (map && map.local) return map.local;
  switch (app.matchBy) {
    case 'phone': return user.phone || user.username;
    case 'email': return user.email || user.username;
    case 'doer name': return acc.doer || user.name;
    default: return user.username;
  }
}

/** An app's login form (Portal-only OFF) asks the hub to check a password. */
function verifyForApp_(appId, id, pw) {
  const app = getApps_().filter(function (a) { return a.id === appId; })[0];
  if (!app || !app.active) throw new Error('This app is switched off in GGM Portal.');
  if (String(settingsMap_().PORTAL_ONLY || 'OFF').toUpperCase() === 'ON') throw new Error('This app is opened from GGM Portal only.');
  const user = checkPassword_(id, pw);
  const acc = getAccess_(user.username)[appId];
  if (!acc || !acc.on) {
    log_(user.username, 'DENIED', appId, 'direct login, not assigned');
    throw new Error('You do not have access to ' + app.name + '. Ask the IT admin.');
  }
  log_(user.username, 'APP_LOGIN', appId, 'direct link, verified by hub');
  return claimsFor_(user, app, acc);
}

/** Active users who have an app ticked (Main Admin uses this for "Assign to"). */
function directory_(appId) {
  const app = getApps_().filter(function (a) { return a.id === appId; })[0];
  if (!app) throw new Error('Unknown app ' + appId);
  const access = accessMap_();
  return allUsers_()
    .filter(function (u) { const a = access[u.username.toLowerCase()]; return u.active && a && a[appId] && a[appId].on; })
    .map(function (u) {
      const acc = access[u.username.toLowerCase()][appId];
      return { u: u.username, n: u.name, d: acc.doer || '', lu: localIdFor_(u, app, acc, getLocalLogin_(u.username, appId)) };
    });
}


/* ======================================================================
 * SHEET READS
 * ==================================================================== */

let MEMO_ = {};    // per-request cache so one call never reads a tab twice
let BOOK_ = null;  // SPEED: the spreadsheet is opened once per request, not once per tab

function book_() {
  if (BOOK_) return BOOK_;
  const id = prop_('MASTER_ID');
  BOOK_ = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  return BOOK_;
}

/* SPEED: the small tabs are kept in the script cache for a short while, so a
   tile tap does not read every sheet each time. Any edit in the sheet
   (onPortalEdit) and every write made by this script clears it at once, so an
   unticked box still takes effect immediately. */
const TAB_CACHE_SECONDS = 60;
const CACHED_TABS = ['Users', 'Apps', 'Access', 'App Logins', 'Settings', 'Lists', 'Designations', 'Sheets', 'Forms', 'Designation Links'];
function forgetTabs_() {
  MEMO_ = {};
  try { CacheService.getScriptCache().removeAll(CACHED_TABS.map(function (n) { return 'tab_' + n; })); } catch (e) {}
}

function sheet_(tab) {
  const sh = book_().getSheetByName(tab.name);
  if (!sh) throw new Error('Tab "' + tab.name + '" is missing. Run Portal Admin → Set up / repair tabs.');
  return sh;
}

function values_(tab) {
  if (MEMO_[tab.name]) return MEMO_[tab.name];
  const cacheable = CACHED_TABS.indexOf(tab.name) > -1;
  const cache = CacheService.getScriptCache();
  if (cacheable && !MEMO_.__prefetched) {
    // SPEED: one cache call brings every small tab a request is going to need
    MEMO_.__prefetched = true;
    try {
      const hits = cache.getAll(CACHED_TABS.map(function (n) { return 'tab_' + n; }));
      Object.keys(hits).forEach(function (k) { MEMO_[k.slice(4)] = JSON.parse(hits[k]); });
    } catch (e) {}
    if (MEMO_[tab.name]) return MEMO_[tab.name];
  }
  const v = sheet_(tab).getDataRange().getValues();
  MEMO_[tab.name] = v;
  if (cacheable) {
    try {
      const str = JSON.stringify(v);
      if (str.length < 90000) cache.put('tab_' + tab.name, str, TAB_CACHE_SECONDS);
    } catch (e) {}
  }
  return v;
}

function userFromRow_(r, i) {
  const uname = String(r[U.USER]).trim();
  return {
    row: i + 1,
    username: uname,
    name: String(r[U.NAME] || uname).trim(),
    phone: digits_(r[U.PHONE]),
    active: isOn_(r[U.ACTIVE]),
    hash: String(r[U.HASH] || ''),
    salt: String(r[U.SALT] || ''),
    email: String(r[U.EMAIL] || '').trim(),
    admin: isOn_(r[U.ADMIN]),
    designation: String(r[U.DESIG] || '').trim()
  };
}

/** Find by username, or (unless usernameOnly) by phone or email. */
function findUser_(id, usernameOnly) {
  const idLc = String(id).trim().toLowerCase();
  if (!idLc) return null;
  const idPhone = digits_(id);
  const rows = values_(TABS.USERS);
  const hits = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const uname = String(r[U.USER]).trim();
    if (!uname) continue;
    const byName = uname.toLowerCase() === idLc;
    const byPhone = !usernameOnly && idPhone.length >= 10 && digits_(r[U.PHONE]) === idPhone;
    const byEmail = !usernameOnly && idLc.indexOf('@') > 0 && String(r[U.EMAIL] || '').trim().toLowerCase() === idLc;
    if (byName || byPhone || byEmail) {
      if (usernameOnly) return userFromRow_(r, i);
      hits.push(i);
    }
  }
  // Two people behind one username / phone / email: never guess which one is signing in.
  if (hits.length > 1) {
    const what = idLc.indexOf('@') > 0 ? 'email' : idPhone.length >= 10 && !/[a-z]/i.test(id) ? 'phone number' : 'username';
    log_(String(id), 'LOGIN_AMBIGUOUS', '', what + ' on Users rows ' + hits.map(function (i) { return i + 1; }).join(', '));
    throw new Error('This ' + what + ' belongs to more than one person in GGM Portal. Ask the IT admin to fix it.');
  }
  return hits.length ? userFromRow_(rows[hits[0]], hits[0]) : null;
}

/* ---- No duplicate people: username, phone and email must each be unique in Users ---- */

const UNIQUE_USER_COLS = [
  { col: U.USER,  label: 'Username', key: function (v) { return String(v == null ? '' : v).trim().toLowerCase(); } },
  { col: U.PHONE, label: 'Phone',    key: function (v) { return digits_(v); } },
  { col: U.EMAIL, label: 'Email',    key: function (v) { return String(v == null ? '' : v).trim().toLowerCase(); } }
];

/** Every username / phone / email that is on more than one row: [{ label, value, rows: [sheet rows] }]. */
function duplicateUsers_(rows) {
  const out = [];
  UNIQUE_USER_COLS.forEach(function (u) {
    const seen = {};
    for (let i = 1; i < rows.length; i++) {
      const k = u.key(rows[i][u.col]);
      if (k) (seen[k] = seen[k] || []).push(i + 1);
    }
    Object.keys(seen).forEach(function (k) { if (seen[k].length > 1) out.push({ label: u.label, value: k, rows: seen[k] }); });
  });
  return out;
}

/**
 * Edit guard (installable onEdit): a username / phone / email that another row already has is
 * undone (a typed cell goes back to what it was) or cleared (pasted cells). The sheet's own rule
 * stops typing; this also catches pastes, which can get past a sheet rule.
 */
function guardUniqueUsers_(e) {
  const r = e.range, sh = r.getSheet();
  const top = Math.max(2, r.getRow()), bottom = r.getRow() + r.getNumRows() - 1;
  const left = r.getColumn(), right = left + r.getNumColumns() - 1;
  const cols = UNIQUE_USER_COLS.filter(function (u) { return u.col + 1 >= left && u.col + 1 <= right; });
  if (!cols.length || bottom < 2) return false;
  const rows = sh.getDataRange().getValues();
  const single = r.getNumRows() === 1 && r.getNumColumns() === 1;
  const notes = [];
  cols.forEach(function (u) {
    for (let row = top; row <= bottom && row <= rows.length; row++) {
      const k = u.key(rows[row - 1][u.col]);
      if (!k) continue;
      for (let j = 1; j < rows.length; j++) {
        if (j === row - 1 || u.key(rows[j][u.col]) !== k) continue;
        const back = single && e.oldValue !== undefined && u.key(e.oldValue) !== k ? e.oldValue : '';
        sh.getRange(row, u.col + 1).setValue(back);
        rows[row - 1][u.col] = back;
        notes.push(u.label + ' "' + k + '" on row ' + row + ' is already used on row ' + (j + 1) + '.');
        break;
      }
    }
  });
  if (!notes.length) return false;
  forgetTabs_();
  log_('', 'DUPLICATE_BLOCKED', '', notes.join(' '));
  SpreadsheetApp.getActive().toast(notes.join('\n') + '\nNot saved: every person needs their own username, phone and email.', 'Duplicate user', 12);
  return true;
}

/** Sheet rules on Users: typing a duplicate username / phone / email is refused; any duplicate is painted red. */
function applyUniqueUserRules_() {
  const sh = sheet_(TABS.USERS);
  const n = Math.max(sh.getMaxRows() - 1, 999);
  const L = function (c) { return colLetter_(c + 1); };
  const uL = L(U.USER), pL = L(U.PHONE), eL = L(U.EMAIL);
  const digits = function (ref) { return 'RIGHT(REGEXREPLACE(TO_TEXT(' + ref + '),"\\D",""),10)'; };
  const rules = [
    [U.USER, '=SUMPRODUCT(--(LOWER(TRIM($' + uL + '$2:$' + uL + '))=LOWER(TRIM(' + uL + '2))))<=1',
      'Usernames must be unique: another person already has this one.'],
    [U.PHONE, '=OR(' + digits(pL + '2') + '="",SUMPRODUCT(--(' + digits('$' + pL + '$2:$' + pL) + '=' + digits(pL + '2') + '))<=1)',
      'Phone numbers must be unique: another person already has this one (the last 10 digits are compared).'],
    [U.EMAIL, '=OR(TRIM(' + eL + '2)="",SUMPRODUCT(--(LOWER(TRIM($' + eL + '$2:$' + eL + '))=LOWER(TRIM(' + eL + '2))))<=1)',
      'Emails must be unique: another person already has this one.']
  ];
  rules.forEach(function (x) {
    sh.getRange(2, x[0] + 1, n, 1).setDataValidation(SpreadsheetApp.newDataValidation()
      .requireFormulaSatisfied(x[1]).setAllowInvalid(false).setHelpText(x[2]).build());
  });
  // Red fill for duplicates that got in some other way (cheap COUNTIF so the sheet stays fast).
  const red = [U.USER, U.PHONE, U.EMAIL].map(function (c) {
    const l = L(c);
    return SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND(' + l + '2<>"",COUNTIF($' + l + '$2:$' + l + ',' + l + '2)>1)')
      .setBackground('#F8D7D0').setFontColor('#9B2C1A')
      .setRanges([sh.getRange(2, c + 1, n, 1)]).build();
  });
  const mine = red.map(function (x) { return x.getBooleanCondition().getCriteriaValues()[0]; });
  const keep = sh.getConditionalFormatRules().filter(function (rule) {
    const b = rule.getBooleanCondition();
    return !(b && mine.indexOf(String(b.getCriteriaValues()[0])) > -1);
  });
  sh.setConditionalFormatRules(keep.concat(red));
}

/** Menu: switch the rules on and list any duplicates already in Users. */
function adminCheckDuplicates() {
  assertAdmin_();
  applyUniqueUserRules_();
  const d = duplicateUsers_(sheet_(TABS.USERS).getDataRange().getValues());
  SpreadsheetApp.getUi().alert('Duplicate users', d.length
    ? 'Fix these (each person needs their own):\n\n' + d.map(function (x) { return x.label + ' "' + x.value + '": rows ' + x.rows.join(', '); }).join('\n') +
      '\n\nThey are painted red in Users. Until fixed, signing in with them is refused.'
    : 'No duplicates. New ones are now refused when typed or pasted.', SpreadsheetApp.getUi().ButtonSet.OK);
}

function allUsers_() {
  const rows = values_(TABS.USERS);
  const out = [];
  for (let i = 1; i < rows.length; i++) if (String(rows[i][U.USER]).trim()) out.push(userFromRow_(rows[i], i));
  return out;
}

function getApps_() {
  return values_(TABS.APPS).slice(1)
    .filter(function (r) { return String(r[A.ID]).trim(); })
    .map(function (r, i) {
      const type = String(r[A.TYPE] || 'CONNECTED').trim().toUpperCase();
      return {
        id: String(r[A.ID]).trim(),
        name: String(r[A.NAME] || r[A.ID]).trim(),
        icon: typeof r[A.ICON] === 'string' ? r[A.ICON].trim() : '',   // a picture pasted into the cell is not text: ignored
        color: String(r[A.COLOR] || '').trim(),
        url: String(r[A.URL] || '').trim(),
        active: isOn_(r[A.ACTIVE]),
        order: r[A.ORDER] === '' ? 999 + i : Number(r[A.ORDER]),
        matchBy: String(r[A.MATCH] || 'Username').trim().toLowerCase(),
        type: type === 'LINK' ? 'LINK' : 'CONNECTED',
        fields: String(r[A.FIELDS] || '').toLowerCase().split(/[,\s]+/).filter(function (f) { return FIELD_LABEL[f]; }),
        badges: isOn_(r[A.BADGES]),
        sheetId: String(r[A.SHEET] || '').trim()   // v2 login: people written straight into this sheet
      };
    });
}

/** Key the hub signs passes / requests with: v2 apps share the PEPPER (their PORTAL_KEY), v1 apps have their own secret. */
function appKey_(app) {
  return app.sheetId ? pepper_() : prop_('APP_SECRET_' + app.id);
}

/** CONNECTED + active + has a key: the apps the hub talks to (badges, dropdowns). */
function connectedApps_() {
  return getApps_().filter(function (a) {
    return a.type === 'CONNECTED' && a.active && a.url && appKey_(a);
  });
}

/** v1 apps only (Portal.js): users pushed over the web, Portal-only switch. */
function httpApps_() {
  return connectedApps_().filter(function (a) { return !a.sheetId; });
}

/** v2 apps (GgmLogin.js): users written straight into their sheet. Inactive ones get an empty tab. */
function directApps_() {
  return getApps_().filter(function (a) { return a.type === 'CONNECTED' && a.sheetId; });
}

/* ---- Access grid ------------------------------------------------------
   Row 1: USER | app IDs across their columns | SYNC
   Row 2: Username | Name | ✓ | Role | Site | Doer name … | Status          */

function accessLayout_(rows) {
  const out = { apps: {}, dataStart: 2, status: -1, old: false };
  if (!rows.length) return out;
  const r1 = rows[0].map(function (h) { return String(h).trim(); });
  if (r1[0] === 'Username') {                 // the first version: one header row of App IDs
    out.old = true; out.dataStart = 1;
    for (let c = 2; c < r1.length; c++) if (r1[c]) out.apps[r1[c]] = { tick: c };
    return out;
  }
  const r2 = (rows[1] || []).map(function (h) { return String(h).trim().toLowerCase(); });
  let cur = '';
  for (let c = 2; c < r1.length; c++) {
    if (r1[c]) cur = r1[c];
    if (!cur) continue;
    if (cur === 'SYNC') { out.status = c; continue; }
    const a = out.apps[cur] = out.apps[cur] || {};
    const lab = r2[c] || '';
    if (lab === '✓') a.tick = c;
    else if (lab === 'role') a.role = c;
    else if (lab === 'site') a.site = c;
    else if (lab.indexOf('doer') === 0) a.doer = c;
  }
  return out;
}

/** { usernameLc: { APPID: { on, role, site, doer } } } */
function accessMap_() {
  if (MEMO_.__access) return MEMO_.__access;
  const rows = values_(TABS.ACCESS);
  const lay = accessLayout_(rows);
  const map = {};
  for (let i = lay.dataStart; i < rows.length; i++) {
    const u = String(rows[i][0]).trim().toLowerCase();
    if (!u) continue;
    const m = map[u] = {};
    Object.keys(lay.apps).forEach(function (id) {
      const c = lay.apps[id];
      m[id] = {
        on: c.tick !== undefined && isOn_(rows[i][c.tick]),
        role: c.role !== undefined ? String(rows[i][c.role] || '').trim() : '',
        site: c.site !== undefined ? String(rows[i][c.site] || '').trim() : '',
        doer: c.doer !== undefined ? String(rows[i][c.doer] || '').trim() : ''
      };
    });
  }
  return (MEMO_.__access = map);
}

function getAccess_(username) {
  return accessMap_()[String(username).toLowerCase()] || {};
}

function getLocalLogin_(username, appId) {
  const lc = username.toLowerCase();
  const rows = values_(TABS.LOGINS);
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (String(r[L.USER]).trim().toLowerCase() === lc && String(r[L.APP]).trim() === appId) {
      return { local: String(r[L.LOCAL] || '').trim(), role: String(r[L.ROLE] || '').trim() };
    }
  }
  return {};
}

function buildHome_(user) {
  const access = getAccess_(user.username);
  const badges = readAllBadges_();
  const apps = getApps_()
    .filter(function (a) { return a.active && a.url && access[a.id] && access[a.id].on; })
    .sort(function (x, y) { return x.order - y.order; })
    .map(function (a) {
      return {
        id: a.id, name: a.name, icon: a.icon, color: a.color,
        kind: a.type === 'LINK' ? 'dashboard' : 'app',
        url: a.type === 'LINK' ? a.url : undefined,   // public dashboards only (so they open with no extra call); app links never reach the phone
        badge: a.badges ? badgeFrom_(badges[a.id], user.username) : null,
        badgeWord: BADGE_WORDS[a.id] || 'pending',
        site: access[a.id].site || ''
      };
    });
  let me = null;   // the home screen must open even if photos cannot be read
  try { me = photoList_().filter(function (p) { return p.u.toLowerCase() === user.username.toLowerCase(); })[0]; } catch (e) {}
  return { user: { username: user.username, name: user.name, admin: user.admin, designation: user.designation, photo: me ? me.t : '' }, apps: apps,
           sheets: linkItemsFor_('sheet', user.username), forms: linkItemsFor_('form', user.username) };
}

/* ---- Settings tab ---------------------------------------------------- */

function settingsRows_() {
  let rows;
  try { rows = values_(TABS.SETTINGS); } catch (e) { return []; }
  return rows.slice(1).filter(function (r) { return String(r[0]).trim(); }).map(function (r) {
    return { key: String(r[0]).trim(), value: String(r[1] === undefined ? '' : r[1]).trim(), by: String(r[2] || ''), at: r[3] || '' };
  });
}

function settingsMap_() {
  const m = {};
  settingsRows_().forEach(function (r) { m[r.key] = r.value; });
  return m;
}

/** pairs: [[key, value, by, note?], …] — one read and one write for all of them. */
function setSettings_(pairs) {
  const sh = sheet_(TABS.SETTINGS);
  const rows = sh.getDataRange().getValues();
  const where = {};
  for (let i = 1; i < rows.length; i++) where[String(rows[i][0]).trim()] = i;
  const notes = [];
  pairs.forEach(function (p) {
    let i = where[p[0]];
    if (i === undefined) { i = rows.length; rows.push(['', '', '', '']); where[p[0]] = i; }
    rows[i] = [p[0], p[1], p[2] || '', new Date()].concat(rows[i].slice(4));
    if (p[3] !== undefined) notes.push([i + 1, p[3] || '']);
  });
  const w = Math.max.apply(null, rows.map(function (r) { return r.length; }));
  sh.getRange(1, 1, rows.length, w).setValues(rows.map(function (r) { return r.concat(new Array(w - r.length).fill('')); }));
  notes.forEach(function (n) { sh.getRange(n[0], 2).setNote(n[1]); });
  forgetTabs_();
}

function setSetting_(key, value, by, note) {
  const sh = sheet_(TABS.SETTINGS);
  const rows = sh.getDataRange().getValues();
  let row = -1;
  for (let i = 1; i < rows.length; i++) if (String(rows[i][0]).trim() === key) { row = i + 1; break; }
  const vals = [[key, value, by || '', new Date()]];
  if (row === -1) sh.appendRow(vals[0]);
  else sh.getRange(row, 1, 1, 4).setValues(vals);
  if (note !== undefined) sh.getRange(row === -1 ? sh.getLastRow() : row, 2).setNote(note || '');
  forgetTabs_();
}

/* ---- Lists tab (dropdown values reported by each app) ---------------- */

function listsMap_() {
  let rows;
  try { rows = values_(TABS.LISTS); } catch (e) { return {}; }
  const m = {};
  if (!rows.length) return m;
  rows[0].forEach(function (h, c) {
    h = String(h).trim();
    if (!h || h.charAt(0) === '(') return;
    m[h] = { col: c, values: rows.slice(1).map(function (r) { return String(r[c] === undefined ? '' : r[c]).trim(); }).filter(Boolean) };
  });
  return m;
}


/* ======================================================================
 * TALKING TO APPS
 * ==================================================================== */

/** The portal's live /exec link. Google's getService().getUrl() gave the editor's test address
 *  (404 for everyone else), which is what every app had been given; Settings → HUB_URL overrides. */
const HUB_URL_DEFAULT = 'https://script.google.com/macros/s/AKfycbyWO02yOI3G9IcE1QjCMEvvJostJZL7_2o8DSYIMEswCtI9Ub8sI9uBTdMp_Zd0WSXvSQ/exec';
function hubUrl_() {
  let v = '';
  try { v = String(settingsMap_().HUB_URL || '').trim(); } catch (e) {}
  return /^https:\/\/script\.google\.com\/.*\/exec$/.test(v) ? v : HUB_URL_DEFAULT;
}

function appRequest_(app, op, data) {
  const secret = appKey_(app);
  if (!secret) throw new Error(app.id + ' has no secret yet (Connect selected app).');
  // hub: the portal's live address rides along, so an app with a stale PORTAL_HUB_URL corrects itself
  const p = signToken_({ t: 'h', a: app.id, op: op, data: data || {}, hub: hubUrl_(), j: Utilities.getUuid(), exp: now_() + 120 }, secret);
  return {
    url: app.url + (app.url.indexOf('?') > -1 ? '&' : '?') + 'portal=1',
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ p: p }),
    muteHttpExceptions: true,
    followRedirects: true
  };
}

function parseAppResponse_(res) {
  let j;
  try { j = JSON.parse(res.getContentText()); }
  catch (e) { return { ok: false, error: 'No answer from the app (HTTP ' + res.getResponseCode() + '). Is Portal.js deployed as a New version?' }; }
  return j && typeof j.ok === 'boolean' ? j : { ok: false, error: 'Unexpected answer from the app.' };
}

function callApp_(app, op, data) {
  let r;
  for (let tries = 0; tries < 2; tries++) {
    const q = appRequest_(app, op, data);        // a fresh one-time request each try
    const url = q.url;
    delete q.url;
    r = parseAppResponse_(UrlFetchApp.fetch(url, q));
    if (r.ok || !/^No answer/.test(r.error)) break;   // Google's reply relay sometimes gives a 404 / blank page: try once more
  }
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

/** jobs: [{ app, op, data }] → [{ ok, data | error }] in the same order. */
function callAppsParallel_(jobs) {
  if (!jobs.length) return [];
  const reqs = [], idx = [], out = new Array(jobs.length);
  jobs.forEach(function (j, i) {
    try { reqs.push(appRequest_(j.app, j.op, j.data)); idx.push(i); }
    catch (e) { out[i] = { ok: false, error: e.message }; }
  });
  let res = [];
  try { res = reqs.length ? UrlFetchApp.fetchAll(reqs) : []; }
  catch (e) { idx.forEach(function (i) { out[i] = { ok: false, error: String(e.message || e) }; }); return out; }
  res.forEach(function (r, k) { out[idx[k]] = parseAppResponse_(r); });
  return out;
}


/* ======================================================================
 * SYNC — push users into apps (every minute, and menu → Sync now)
 * ==================================================================== */

function syncUsers_() {
  const apps = httpApps_();
  if (!apps.length) return { pushed: 0, blocked: 0 };
  const lists = listsMap_();
  const access = accessMap_();
  const users = allUsers_();
  const sh = sheet_(TABS.SYNC);
  const syncRows = sh.getDataRange().getValues();
  const width = TABS.SYNC.head.length;
  const before = JSON.stringify(syncRows.slice(1).map(function (r) { return r.slice(0, width); }));   // rows are edited in place below
  const current = {};
  users.forEach(function (u) { current[u.username.toLowerCase()] = true; });
  const known = {};                         // "user|APP" → row array
  for (let i = 1; i < syncRows.length; i++) {
    const k = String(syncRows[i][0]).trim().toLowerCase() + '|' + String(syncRows[i][1]).trim();
    if (String(syncRows[i][0]).trim()) known[k] = syncRows[i];
  }

  const jobs = [];                          // per app: [{ key, wanted, hash, localId }]
  let blocked = 0;
  apps.forEach(function (app) {
    const batch = [];
    const siteRoles = (lists[app.id + '_SITEROLES'] || { values: [] }).values.map(function (v) { return v.toUpperCase(); });
    const owners = {};                      // id inside the app → hub usernames (two rows must never drive one account)
    users.forEach(function (u) {
      const acc = (access[u.username.toLowerCase()] || {})[app.id] || { on: false };
      if (!acc.on && !known[u.username.toLowerCase() + '|' + app.id]) return;
      const lid = String(localIdFor_(u, app, acc, getLocalLogin_(u.username, app.id))).toLowerCase();
      (owners[lid] = owners[lid] || []).push(u.username);
    });
    users.forEach(function (u) {
      const acc = (access[u.username.toLowerCase()] || {})[app.id] || { on: false };
      const key = u.username.toLowerCase() + '|' + app.id;
      const prev = known[key];
      if (!acc.on && !prev) return;         // never had this app: nothing to tell it
      const map = getLocalLogin_(u.username, app.id);
      const wanted = {
        username: u.username, name: u.name, phone: u.phone, email: u.email,
        localId: localIdFor_(u, app, acc, map),
        role: map.role || acc.role || '', site: acc.site || '', doer: acc.doer || '',
        active: !!(u.active && acc.on)
      };
      const twins = (owners[String(wanted.localId).toLowerCase()] || []).filter(function (n) { return n !== u.username; });
      const problem = twins.length ? app.id + ' id "' + wanted.localId + '" is also used by ' + twins.join(', ') + '. Fix App Logins / Email / Doer name.'
        : wanted.active ? missingField_(app, wanted, siteRoles) : '';
      const hash = hashOf_(wanted);
      const row = prev || [u.username, app.id, '', '', '', '', '', ''];
      row[0] = u.username; row[1] = app.id; row[2] = wanted.localId;
      row[3] = describeWanted_(wanted);
      if (problem) {
        row[4] = 'BLOCKED'; row[5] = problem; blocked++;
        known[key] = row;
        return;
      }
      known[key] = row;
      if (String(row[7]) === hash && String(row[4]) === 'OK') return;   // already in step
      batch.push({ key: key, wanted: wanted, hash: hash });
    });
    // Rows deleted from Users (instead of unticking Active): switch them off in the app once.
    Object.keys(known).forEach(function (key) {
      const row = known[key];
      if (String(row[1]) !== app.id || current[key.split('|')[0]] || row[4] === 'REMOVED') return;
      batch.push({ key: key, removed: true, hash: '',
        wanted: { username: String(row[0]), name: '', phone: '', email: '', localId: String(row[2]), role: '', site: '', doer: '', active: false } });
    });
    for (let i = 0; i < batch.length; i += 25) jobs.push({ app: app, items: batch.slice(i, i + 25) });
  });

  let pushed = 0;
  for (let i = 0; i < jobs.length; i += 10) {
    const chunk = jobs.slice(i, i + 10);
    const results = callAppsParallel_(chunk.map(function (j) {
      return { app: j.app, op: 'provision', data: { users: j.items.map(function (x) { return x.wanted; }) } };
    }));
    results.forEach(function (r, k) {
      const job = chunk[k];
      job.items.forEach(function (item, n) {
        const row = known[item.key];
        const was = row[4];
        const one = r.ok && r.data ? r.data[n] : null;
        if (one && one.ok) {
          row[4] = item.removed ? 'REMOVED' : 'OK';
          row[5] = item.removed ? 'deleted from Users: switched off in the app' : one.msg;
          row[7] = item.hash; pushed++;
        } else { row[4] = 'ERROR'; row[5] = one ? one.msg : (r.error || 'no answer'); }
        row[6] = new Date();
        // failures are retried every minute; log only the first one, not 1,440 a day
        if ((!r.ok || !one || !one.ok) && was !== 'ERROR') log_(item.wanted.username, 'SYNC_FAIL', job.app.id, row[5]);
      });
    });
  }

  const out = Object.keys(known).map(function (k) { return known[k]; })
    .sort(function (a, b) { return String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1])); });
  const rows = out.map(function (r) { return r.slice(0, width); });
  if (JSON.stringify(rows) !== before) {     // nothing changed: no write (this runs every minute)
    while (rows.length < syncRows.length - 1) rows.push(new Array(width).fill(''));   // one write, no clear-then-write gap
    if (rows.length) sh.getRange(2, 1, rows.length, width).setValues(rows);
  }
  writeAccessStatus_(out);
  return { pushed: pushed, blocked: blocked };
}

function missingField_(app, w, siteRoles) {
  if (app.fields.indexOf('role') > -1 && !w.role) return 'Pick a role for ' + app.id + '.';
  if (app.fields.indexOf('site') > -1 && siteRoles.indexOf(String(w.role).toUpperCase()) > -1 && !w.site) {
    return app.id + ': role ' + w.role + ' must belong to one site.';
  }
  if (app.fields.indexOf('doer') > -1 && !w.doer && String(w.role).toUpperCase() !== 'ADMIN') return 'Pick the doer name for ' + app.id + '.';   // an ADMIN works on everyone's tasks
  if (app.matchBy === 'email' && !w.localId) return app.id + ' needs an email or a Local Username.';
  return '';
}

function describeWanted_(w) {
  return [w.role, w.site, w.doer, w.active ? 'active' : 'inactive'].filter(Boolean).join(' · ');
}

function hashOf_(o) {
  return toHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(o), Utilities.Charset.UTF_8));
}

/** The SYNC column of the Access grid: "✓ 3/3", "✗ fix 1", "⏳ 1 pending". */
function writeAccessStatus_(syncRows) {
  // SPEED: runs every minute — compare against the cached grid (every rebuild / sheet edit
  // clears that cache), and only touch the sheet when a status really changed.
  const rows = values_(TABS.ACCESS);
  const lay = accessLayout_(rows);
  if (lay.old || lay.status < 0) return;
  const by = {};
  syncRows.forEach(function (r) {
    const k = String(r[0]).toLowerCase();
    const s = by[k] = by[k] || { ok: 0, bad: 0, wait: 0, total: 0 };
    if ((String(r[3]).indexOf('inactive') > -1 && r[4] === 'OK') || r[4] === 'REMOVED') return;    // switched-off apps are not counted
    s.total++;
    if (r[4] === 'OK') s.ok++; else if (r[4] === 'BLOCKED' || r[4] === 'ERROR') s.bad++; else s.wait++;
  });
  const col = [];
  for (let i = lay.dataStart; i < rows.length; i++) {
    const s = by[String(rows[i][0]).trim().toLowerCase()];
    col.push([!s || !s.total ? '' : s.bad ? '✗ fix ' + s.bad : s.wait ? '⏳ ' + s.wait + ' pending' : '✓ ' + s.ok + '/' + s.total]);
  }
  const now = rows.slice(lay.dataStart).map(function (r) { return [r[lay.status] === undefined ? '' : r[lay.status]]; });
  if (col.length && JSON.stringify(col) !== JSON.stringify(now)) {
    sheet_(TABS.ACCESS).getRange(lay.dataStart + 1, lay.status + 1, col.length, 1).setValues(col);
    forgetTabs_();
  }
}


/* ======================================================================
 * V2 LOGIN — people written straight into each app's own sheet
 *   Apps with a Sheet ID get a tab "Portal Users <APP ID>" in that sheet.
 *   It is rewritten the moment Users / Access / Apps / App Logins is edited
 *   and when a password changes: only people who are active AND ticked for
 *   the app are in it, so unticking removes the row. Every row is signed
 *   (Check), so a row typed or changed by hand does not work. The app's own
 *   old user tabs and data are never touched.
 * ==================================================================== */

const APP_TAB_HEAD = ['Username', 'Name', 'Phone', 'Email', 'Role', 'Site', 'Doer Name', 'Password Hash', 'Salt', 'Updated', 'Check'];

function appTabName_(app) { return 'Portal Users ' + app.id; }

/** Same signature as ggmRowCheck_() in GgmLogin.js: app id + the first 9 columns. */
function appRowCheck_(appId, r) {
  const data = [appId].concat(r.slice(0, 9).map(function (v) { return String(v); }));
  return toHex_(Utilities.computeHmacSha256Signature('row|' + JSON.stringify(data), pepper_())).slice(0, 32);
}

/** What one v2 app should hold: its rows, and one Sync-tab line per ticked person. */
function directPlan_(app, users, access, lists) {
  const siteRoles = (lists[app.id + '_SITEROLES'] || { values: [] }).values.map(function (v) { return v.toUpperCase(); });
  const rows = [], status = [], seen = {};
  users.forEach(function (u) { const k = u.username.toLowerCase(); seen[k] = (seen[k] || 0) + 1; });
  users.forEach(function (u) {
    const acc = (access[u.username.toLowerCase()] || {})[app.id];
    if (!acc || !acc.on) return;                                   // not ticked: not in the tab
    const map = getLocalLogin_(u.username, app.id);
    const w = { username: u.username, localId: u.username, role: map.role || acc.role || '', site: acc.site || '', doer: acc.doer || '', active: u.active };
    const line = [u.username, app.id, u.username, describeWanted_(w), 'OK', '', '', ''];
    status.push(line);
    if (!u.active) { line[5] = 'switched off: not in the app'; return; }
    const problem = seen[u.username.toLowerCase()] > 1
      ? 'Username "' + u.username + '" is on ' + seen[u.username.toLowerCase()] + ' rows of Users. Give each person their own username.'
      : missingField_(app, w, siteRoles);
    if (problem) { line[4] = 'BLOCKED'; line[5] = problem; return; }
    const r = [u.username, u.name, u.phone, u.email, w.role, w.site, w.doer, u.hash, u.salt, '', ''];
    r[10] = appRowCheck_(app.id, r);
    rows.push(r);
    line[5] = 'in ' + appTabName_(app) + (u.hash ? '' : ' · no password set yet');
  });
  return { rows: rows, status: status };
}

/** Writes every v2 app whose people changed (force: all of them). Call inside the script lock. */
function syncDirect_(force) {
  const apps = directApps_();
  if (!apps.length) return '';
  const users = allUsers_(), access = accessMap_(), lists = listsMap_();
  const lines = {}, notes = [];
  apps.forEach(function (app) {
    const plan = app.active ? directPlan_(app, users, access, lists) : { rows: [], status: [] };   // switched-off app: nobody signs in
    const key = 'DIRECT_' + app.id;
    const sig = hashOf_([app.sheetId, plan.rows]);
    if (force || prop_(key) !== sig) {
      try {
        writeAppTab_(app, plan.rows);
        props_().setProperty(key, sig); if (PROPS_) PROPS_[key] = sig;
        notes.push(app.id + ': ' + plan.rows.length + ' people');
      } catch (e) {
        const err = String((e && e.message) || e);
        props_().deleteProperty(key); if (PROPS_) delete PROPS_[key];   // retried next minute
        notes.push(app.id + ': ' + err);
        plan.status.forEach(function (l) { if (l[4] === 'OK' && l[3].indexOf('inactive') < 0) { l[4] = 'ERROR'; l[5] = 'could not write ' + appTabName_(app) + ': ' + err; } });
        const c = CacheService.getScriptCache();
        if (!c.get('direct_err_' + app.id)) { c.put('direct_err_' + app.id, '1', 21600); log_('', 'SYNC_FAIL', app.id, err); }
      }
    }
    lines[app.id] = plan.status;
  });
  mergeSyncRows_(lines);
  return notes.join('\n');
}

/** Called after edits and password changes: never lets a v2 write failure break the caller. */
function syncDirectSafe_() {
  try { withLock_(function () { syncDirect_(false); }); } catch (e) { console.error('syncDirect_: ' + e); }
}

/** Rewrites the app's "Portal Users <ID>" tab in one write; keeps "Updated" for rows that did not change. */
function writeAppTab_(app, rows) {
  const ss = SpreadsheetApp.openById(app.sheetId);
  const name = appTabName_(app), W = APP_TAB_HEAD.length;
  let sh = ss.getSheetByName(name);
  const fresh = !sh;
  if (fresh) sh = ss.insertSheet(name);
  const last = sh.getLastRow();
  const old = last > 1 ? sh.getRange(2, 1, last - 1, W).getDisplayValues() : [];
  const oldBy = {};
  old.forEach(function (r) { if (r[0]) oldBy[String(r[0]).toLowerCase()] = r; });
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');
  const grid = [APP_TAB_HEAD.slice()].concat(rows.map(function (r) {
    const o = oldBy[String(r[0]).toLowerCase()], c = r.slice();
    c[9] = o && o[10] === c[10] ? o[9] : stamp;
    return c;
  }));
  while (grid.length < old.length + 1) grid.push(new Array(W).fill(''));   // clears people who were removed
  if (sh.getMaxColumns() < W) sh.insertColumnsAfter(sh.getMaxColumns(), W - sh.getMaxColumns());
  if (sh.getMaxRows() < grid.length) sh.insertRowsAfter(sh.getMaxRows(), grid.length - sh.getMaxRows());
  const rng = sh.getRange(1, 1, grid.length, W);
  rng.setNumberFormat('@');                                       // phones, hashes, salts stay exact text
  rng.setValues(grid);
  if (fresh) {
    sh.getRange(1, 1, 1, W).setFontWeight('bold').setBackground('#E8EAF6');
    sh.setFrozenRows(1);
    sh.hideColumns(8, 2);                                         // Password Hash, Salt
    sh.hideColumns(11);                                           // Check
    sh.getRange(1, 1).setNote('Written by GGM Portal. Do not edit: hand changes are ignored and overwritten. ' +
      'Add / remove people by ticking this app in the portal sheet (Access tab).');
  }
  if (!sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).length) {
    const pr = sh.protect().setDescription('Written by GGM Portal');
    pr.addEditor(Session.getEffectiveUser());
    pr.removeEditors(pr.getEditors());
    if (pr.canDomainEdit()) pr.setDomainEdit(false);
  }
}

/** Replaces the v2 apps' lines in the Sync tab (v1 lines stay) and refreshes the Access SYNC column. */
function mergeSyncRows_(byApp) {
  const sh = sheet_(TABS.SYNC), width = TABS.SYNC.head.length;
  const old = sh.getDataRange().getValues().slice(1)
    .map(function (r) { r = r.slice(0, width); while (r.length < width) r.push(''); return r; });
  const filled = old.filter(function (r) { return String(r[0]).trim(); });
  const prev = {}, out = [];
  filled.forEach(function (r) {
    if (byApp[String(r[1]).trim()]) prev[String(r[0]).toLowerCase() + '|' + String(r[1]).trim()] = r;
    else out.push(r);
  });
  const now = new Date();
  Object.keys(byApp).forEach(function (id) {
    byApp[id].forEach(function (l) {
      const p = prev[l[0].toLowerCase() + '|' + id];
      l[6] = p && p[3] === l[3] && p[4] === l[4] && p[5] === l[5] ? p[6] : now;   // time of the last real change
      out.push(l);
    });
  });
  out.sort(function (a, b) { return String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1])); });
  if (JSON.stringify(out) !== JSON.stringify(filled)) {
    const rows = out.slice();
    while (rows.length < old.length) rows.push(new Array(width).fill(''));
    if (rows.length) sh.getRange(2, 1, rows.length, width).setValues(rows);
  }
  writeAccessStatus_(out);
}

/* ======================================================================
 * DESIGNATIONS, SHEETS AND FORMS
 *   Designations       one row per designation: per app a ✓ (+ the Role that designation gets)
 *   Sheets / Forms     Name · Link · Site · Designation, then one ✓ column per user
 *   Designation Links  designations × sheets / forms (✓ = everyone with that designation gets it)
 * Picking a designation in Users ticks that designation's apps, roles, sheets and forms for the
 * person (and removes what only the old designation gave). Ticking / unticking in Designations or
 * Designation Links applies to everyone with that designation. Everything stays editable by hand.
 * ==================================================================== */

const LINK_KINDS = { sheet: TABS.SHEETS, form: TABS.FORMS };
const LK = { NAME: 0, LINK: 1, SITE: 2, DESIG: 3, USERS: 4 };   // Sheets / Forms columns; users from col E
const LINK_DATA_START = 2;                                       // 2 header rows

/* ---- the three grids ------------------------------------------------ */

/** Designations: col A names, then per app ✓ (+ Role when the app has roles). */
function desigLayout_(rows) {
  const out = { apps: {}, dataStart: 2 };
  const r1 = (rows[0] || []).map(function (h) { return String(h).trim(); });
  const r2 = (rows[1] || []).map(function (h) { return String(h).trim().toLowerCase(); });
  let cur = '';
  for (let c = 1; c < r1.length; c++) {
    if (r1[c]) cur = r1[c];
    if (!cur) continue;
    const a = out.apps[cur] = out.apps[cur] || {};
    if (r2[c] === '✓') a.tick = c; else if (r2[c] === 'role') a.role = c;
  }
  return out;
}

/** { designationLc: { name, apps: { APP: { on, role } } } } */
function designationMap_() {
  if (MEMO_.__desig) return MEMO_.__desig;
  const rows = values_(TABS.DESIGNATIONS), lay = desigLayout_(rows), map = {};
  for (let i = lay.dataStart; i < rows.length; i++) {
    const n = String(rows[i][0] || '').trim();
    if (!n) continue;
    const apps = {};
    Object.keys(lay.apps).forEach(function (id) {
      const c = lay.apps[id];
      apps[id] = { on: c.tick !== undefined && isOn_(rows[i][c.tick]), role: c.role !== undefined ? String(rows[i][c.role] || '').trim() : '' };
    });
    map[n.toLowerCase()] = { name: n, apps: apps };
  }
  return (MEMO_.__desig = map);
}

function designationNames_() {
  return Object.keys(designationMap_()).map(function (k) { return designationMap_()[k].name; });
}

/** Rebuilds the Designations header from the Apps tab, keeping every name, tick and role. */
function syncDesignationsLocked_() {
  forgetTabs_();
  const sh = sheet_(TABS.DESIGNATIONS);
  const old = sh.getDataRange().getValues();
  const keep = designationMap_();
  const names = [];
  for (let i = 2; i < old.length; i++) { const n = String(old[i][0] || '').trim(); if (n && names.indexOf(n) < 0) names.push(n); }
  const apps = getApps_().filter(function (a) { return a.active; });
  const lists = listsMap_();
  const h1 = ['DESIGNATION'], h2 = ['Designation'], cols = [];
  apps.forEach(function (a) {
    cols.push({ app: a, field: 'tick', col: h1.length }); h1.push(a.id); h2.push('✓');
    if (a.fields.indexOf('role') > -1) { cols.push({ app: a, field: 'role', col: h1.length }); h1.push(''); h2.push('Role'); }
  });
  const width = h1.length;
  const body = names.map(function (n) {
    const d = keep[n.toLowerCase()] || { apps: {} };
    return [n].concat(cols.map(function (c) { const v = d.apps[c.app.id] || {}; return c.field === 'tick' ? v.on === true : (v.role || ''); }));
  });
  const H = Math.max(old.length, body.length + 2), W = Math.max(old[0] ? old[0].length : 0, width);
  if (sh.getMaxColumns() < W) sh.insertColumnsAfter(sh.getMaxColumns(), W - sh.getMaxColumns());
  if (sh.getMaxRows() < body.length + 102) sh.insertRowsAfter(sh.getMaxRows(), body.length + 102 - sh.getMaxRows());
  const grid = [h1, h2].concat(body).map(function (r) { return r.concat(new Array(W - r.length).fill('')); });
  while (grid.length < H) grid.push(new Array(W).fill(''));
  const all = sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns());
  all.breakApart(); all.clearDataValidations(); all.setBackground(null).setFontColor(null).setFontWeight(null);
  sh.getRange(1, 1, H, W).setValues(grid);
  const n = body.length + 100;
  cols.forEach(function (c) {
    const rng = sh.getRange(3, c.col + 1, n, 1);
    if (c.field === 'tick') { rng.setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build()); return; }
    const l = lists[c.app.id + '_ROLES'], listsSh = book_().getSheetByName(TABS.LISTS.name);
    if (l && listsSh) rng.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(listsSh.getRange(2, l.col + 1, 500, 1), true).setAllowInvalid(false).build());
  });
  headerBlocks_(sh, cols, apps, width);
  sh.getRange(1, 1).setNote('Type a designation in column A, tick the apps it gets and pick its role. Picking that designation for someone in Users gives them these.');
  forgetTabs_();
  syncDesigLinksLocked_();
  applyDesignationDropdown_();
}

/** One coloured, merged header block per app (same look as Access). */
function headerBlocks_(sh, cols, apps, width) {
  sh.getRange(1, 1).setBackground('#5F6368');
  apps.forEach(function (a, i) {
    const own = cols.filter(function (c) { return c.app === a; });
    if (!own.length) return;
    const rng = sh.getRange(1, own[0].col + 1, 1, own.length);
    if (own.length > 1) rng.merge();
    rng.setBackground(/^#[0-9a-f]{6}$/i.test(a.color) ? a.color : ['#4F46E5', '#0E7490', '#B45309', '#15803D', '#7C3AED'][i % 5]);
  });
  sh.getRange(1, 1, 1, width).setFontColor('#FFFFFF').setFontWeight('bold').setHorizontalAlignment('center');
  sh.getRange(2, 1, 1, width).setFontWeight('bold').setBackground('#E8EAF6').setHorizontalAlignment('center');
  sh.setFrozenRows(2); sh.setFrozenColumns(1);
}

/** Users → Designation: a dropdown of the designations. */
function applyDesignationDropdown_() {
  const users = sheet_(TABS.USERS), des = sheet_(TABS.DESIGNATIONS);
  users.getRange(1, U.DESIG + 1).setValue(TABS.USERS.head[U.DESIG]).setFontWeight('bold');
  users.getRange(2, U.DESIG + 1, Math.max(users.getMaxRows() - 1, 999), 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInRange(des.getRange('A3:A'), true).setAllowInvalid(false)
      .setHelpText('Pick a designation from the Designations tab.').build());
}

/** Sheets / Forms: { nameLc: { name, link, site, desig, users: { usernameLc: true } } } */
function linkMap_(kind) {
  const key = '__links_' + kind;
  if (MEMO_[key]) return MEMO_[key];
  const rows = values_(LINK_KINDS[kind]), map = {};
  const head = (rows[0] || []).map(function (h) { return String(h).trim().toLowerCase(); });
  for (let i = LINK_DATA_START; i < rows.length; i++) {
    const n = String(rows[i][LK.NAME] || '').trim();
    if (!n || map[n.toLowerCase()]) continue;            // first row with a name wins
    const users = {};
    for (let c = LK.USERS; c < head.length; c++) if (head[c] && isOn_(rows[i][c])) users[head[c]] = true;
    map[n.toLowerCase()] = { name: n, link: String(rows[i][LK.LINK] || '').trim(), site: String(rows[i][LK.SITE] || '').trim(),
                             desig: String(rows[i][LK.DESIG] || '').trim(), users: users };
  }
  return (MEMO_[key] = map);
}

/** Sheets / Forms: one ✓ column per user (row 1 username, row 2 name), in Users order. Keeps every tick. */
function syncLinkGridLocked_(kind) {
  forgetTabs_();
  const sh = sheet_(LINK_KINDS[kind]);
  const old = sh.getDataRange().getValues();
  const head = (old[0] || []).map(function (h) { return String(h).trim().toLowerCase(); });
  const users = allUsers_();
  const W = Math.max(LK.USERS + users.length, old[0] ? old[0].length : 0);
  const h1 = TABS.SHEETS.head.slice().concat(users.map(function (u) { return u.username; }));
  const h2 = ['', '', '', ''].concat(users.map(function (u) { return u.name; }));
  const body = old.slice(LINK_DATA_START).map(function (r) {
    const row = [r[LK.NAME], r[LK.LINK], r[LK.SITE], r[LK.DESIG]].map(function (v) { return v === undefined ? '' : v; });
    users.forEach(function (u) { const c = head.indexOf(u.username.toLowerCase()); row.push(c >= LK.USERS ? isOn_(r[c]) : false); });
    return row;
  });
  while (body.length && !String(body[body.length - 1][LK.NAME] || '').trim() && !String(body[body.length - 1][LK.LINK] || '').trim()) body.pop();
  const H = Math.max(old.length, body.length + 2);
  if (sh.getMaxColumns() < W) sh.insertColumnsAfter(sh.getMaxColumns(), W - sh.getMaxColumns());
  if (sh.getMaxRows() < body.length + 202) sh.insertRowsAfter(sh.getMaxRows(), body.length + 202 - sh.getMaxRows());
  const grid = [h1, h2].concat(body).map(function (r) { return r.concat(new Array(W - r.length).fill('')); });
  while (grid.length < H) grid.push(new Array(W).fill(''));
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).clearDataValidations();
  sh.getRange(1, 1, H, W).setValues(grid);
  if (users.length) sh.getRange(3, LK.USERS + 1, body.length + 200, users.length).setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  const des = sheet_(TABS.DESIGNATIONS);
  sh.getRange(3, LK.DESIG + 1, body.length + 200, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInRange(des.getRange('A3:A'), true).setAllowInvalid(true).build());
  sh.getRange(1, 1, 1, W).setFontWeight('bold').setBackground('#E8EAF6');
  sh.getRange(2, 1, 1, W).setFontStyle('italic').setFontColor('#6C685D');
  sh.setFrozenRows(2); sh.setFrozenColumns(1);
  sh.getRange(1, 1).setNote('One ' + kind + ' per row: the Name is what people see in the portal (' + (kind === 'sheet' ? 'Sheets' : 'Forms') +
    ' menu). Tick a user\'s column to give it to them, or tick it for a designation in "Designation Links".');
}

/** Designation Links: rows = designations (from Designations), columns = every sheet and form name. */
function syncDesigLinksLocked_() {
  forgetTabs_();
  const sh = sheet_(TABS.DLINKS);
  const old = sh.getDataRange().getValues();
  const oldKey = [];                                     // column → "sheet|name" from the old header
  let curKind = '';
  for (let c = 1; c < (old[0] || []).length; c++) {
    const g = String(old[0][c] || '').trim().toUpperCase();
    if (g === 'SHEETS') curKind = 'sheet'; else if (g === 'FORMS') curKind = 'form';
    oldKey[c] = curKind + '|' + String((old[1] || [])[c] || '').trim().toLowerCase();
  }
  const oldTicks = {};
  for (let i = 2; i < old.length; i++) {
    const d = String(old[i][0] || '').trim().toLowerCase();
    if (!d) continue;
    for (let c = 1; c < old[i].length; c++) if (oldKey[c] && isOn_(old[i][c])) oldTicks[d + '#' + oldKey[c]] = true;
  }
  const sheets = Object.keys(linkMap_('sheet')).map(function (k) { return linkMap_('sheet')[k].name; });
  const forms = Object.keys(linkMap_('form')).map(function (k) { return linkMap_('form')[k].name; });
  const cols = sheets.map(function (n) { return { kind: 'sheet', name: n }; }).concat(forms.map(function (n) { return { kind: 'form', name: n }; }));
  const h1 = ['DESIGNATION'].concat(cols.map(function (c, i) { return i === 0 || cols[i - 1].kind !== c.kind ? (c.kind === 'sheet' ? 'SHEETS' : 'FORMS') : ''; }));
  const h2 = ['Designation'].concat(cols.map(function (c) { return c.name; }));
  const names = designationNames_();
  const body = names.map(function (n) {
    return [n].concat(cols.map(function (c) { return !!oldTicks[n.toLowerCase() + '#' + c.kind + '|' + c.name.toLowerCase()]; }));
  });
  const W = Math.max(h1.length, old[0] ? old[0].length : 0), H = Math.max(old.length, body.length + 2);
  if (sh.getMaxColumns() < W) sh.insertColumnsAfter(sh.getMaxColumns(), W - sh.getMaxColumns());
  const grid = [h1, h2].concat(body).map(function (r) { return r.concat(new Array(W - r.length).fill('')); });
  while (grid.length < H) grid.push(new Array(W).fill(''));
  const all = sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns());
  all.breakApart(); all.clearDataValidations(); all.setBackground(null).setFontColor(null).setFontWeight(null);
  sh.getRange(1, 1, H, W).setValues(grid);
  if (cols.length && body.length) sh.getRange(3, 2, body.length, cols.length).setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  const ns = sheets.length, nf = forms.length;
  sh.getRange(1, 1).setBackground('#5F6368');
  if (ns) { const r = sh.getRange(1, 2, 1, ns); if (ns > 1) r.merge(); r.setBackground('#15803D'); }
  if (nf) { const r = sh.getRange(1, 2 + ns, 1, nf); if (nf > 1) r.merge(); r.setBackground('#7C3AED'); }
  sh.getRange(1, 1, 1, W).setFontColor('#FFFFFF').setFontWeight('bold').setHorizontalAlignment('center');
  sh.getRange(2, 1, 1, W).setFontWeight('bold').setBackground('#E8EAF6');
  sh.setFrozenRows(2); sh.setFrozenColumns(1);
  sh.getRange(1, 1).setNote('Rows come from the Designations tab, columns from the Sheets and Forms tabs. Tick = everyone with that designation gets it.');
  forgetTabs_();
}

/** { designationLc: { sheet: { nameLc: true }, form: { … } } } */
function desigLinksMap_() {
  if (MEMO_.__dlinks) return MEMO_.__dlinks;
  const rows = values_(TABS.DLINKS), map = {};
  const keys = [];
  let kind = '';
  for (let c = 1; c < (rows[0] || []).length; c++) {
    const g = String(rows[0][c] || '').trim().toUpperCase();
    if (g === 'SHEETS') kind = 'sheet'; else if (g === 'FORMS') kind = 'form';
    keys[c] = { kind: kind, name: String((rows[1] || [])[c] || '').trim().toLowerCase() };
  }
  for (let i = 2; i < rows.length; i++) {
    const d = String(rows[i][0] || '').trim().toLowerCase();
    if (!d) continue;
    const m = map[d] = { sheet: {}, form: {} };
    for (let c = 1; c < rows[i].length; c++) if (keys[c] && keys[c].kind && keys[c].name && isOn_(rows[i][c])) m[keys[c].kind][keys[c].name] = true;
  }
  return (MEMO_.__dlinks = map);
}

/* ---- applying a designation ----------------------------------------- */

/** Writes only the cells that change. edits: [[row0, col0, value]] */
function writeCells_(tab, edits) {
  if (!edits.length) return 0;
  const sh = sheet_(tab);
  edits.forEach(function (e) { sh.getRange(e[0] + 1, e[1] + 1).setValue(e[2]); });
  return edits.length;
}

/**
 * A person got designation `newD` (was `oldD`): tick its apps (+ roles), sheets and forms; untick
 * what only the old designation gave. Ticks added by hand are left alone.
 */
function applyDesignation_(username, newD, oldD) {
  const dm = designationMap_(), dl = desigLinksMap_();
  const nT = dm[String(newD || '').toLowerCase()], oT = dm[String(oldD || '').toLowerCase()];
  const nL = dl[String(newD || '').toLowerCase()] || { sheet: {}, form: {} }, oL = dl[String(oldD || '').toLowerCase()] || { sheet: {}, form: {} };
  let n = 0;
  // Access
  const acc = sheet_(TABS.ACCESS).getDataRange().getValues(), lay = accessLayout_(acc);
  let ri = -1;
  for (let i = lay.dataStart; i < acc.length; i++) if (String(acc[i][0]).trim().toLowerCase() === username.toLowerCase()) { ri = i; break; }
  if (ri > -1) {
    const edits = [];
    Object.keys(lay.apps).forEach(function (id) {
      const c = lay.apps[id], nn = nT && nT.apps[id], oo = oT && oT.apps[id];
      if (c.tick === undefined) return;
      if (nn && nn.on) {
        if (!isOn_(acc[ri][c.tick])) edits.push([ri, c.tick, true]);
        if (c.role !== undefined && nn.role && String(acc[ri][c.role]).trim() !== nn.role) edits.push([ri, c.role, nn.role]);
      } else if (oo && oo.on && isOn_(acc[ri][c.tick])) edits.push([ri, c.tick, false]);
    });
    n += writeCells_(TABS.ACCESS, edits);
  }
  // Sheets / Forms
  Object.keys(LINK_KINDS).forEach(function (kind) {
    const rows = sheet_(LINK_KINDS[kind]).getDataRange().getValues();
    const col = (rows[0] || []).map(function (h) { return String(h).trim().toLowerCase(); }).indexOf(username.toLowerCase());
    if (col < LK.USERS) return;
    const edits = [];
    for (let i = LINK_DATA_START; i < rows.length; i++) {
      const nm = String(rows[i][LK.NAME] || '').trim().toLowerCase();
      if (!nm) continue;
      if (nL[kind][nm]) { if (!isOn_(rows[i][col])) edits.push([i, col, true]); }
      else if (oL[kind][nm] && isOn_(rows[i][col])) edits.push([i, col, false]);
    }
    n += writeCells_(LINK_KINDS[kind], edits);
  });
  forgetTabs_();
  if (n) log_(username, 'DESIGNATION', '', (oldD ? oldD + ' → ' : '') + (newD || '(none)') + ': ' + n + ' cells');
  return n;
}

function usersWithDesignation_(desig) {
  const d = String(desig || '').trim().toLowerCase();
  return d ? allUsers_().filter(function (u) { return u.designation.toLowerCase() === d; }) : [];
}

/** Designations tab edit: one app tick / role changed for a designation → everyone with it. */
function applyDesignationCell_(desig, appId, field, value) {
  const people = usersWithDesignation_(desig);
  if (!people.length) return 0;
  const acc = sheet_(TABS.ACCESS).getDataRange().getValues(), lay = accessLayout_(acc), c = lay.apps[appId];
  if (!c) return 0;
  const col = field === 'role' ? c.role : c.tick;
  if (col === undefined) return 0;
  const want = field === 'role' ? String(value || '').trim() : isOn_(value);
  if (field === 'role' && !want) return 0;               // a cleared designation role does not clear people's roles
  const who = {};
  people.forEach(function (u) { who[u.username.toLowerCase()] = true; });
  const edits = [];
  for (let i = lay.dataStart; i < acc.length; i++) {
    if (!who[String(acc[i][0]).trim().toLowerCase()]) continue;
    const have = field === 'role' ? String(acc[i][col]).trim() : isOn_(acc[i][col]);
    if (have !== want) edits.push([i, col, want]);
  }
  const n = writeCells_(TABS.ACCESS, edits);
  forgetTabs_();
  return n;
}

/** Designation Links edit: one sheet / form ticked or unticked for a designation → everyone with it. */
function applyDesigLinkCell_(desig, kind, name, on) {
  const people = usersWithDesignation_(desig);
  if (!people.length || !LINK_KINDS[kind]) return 0;
  const rows = sheet_(LINK_KINDS[kind]).getDataRange().getValues();
  const head = (rows[0] || []).map(function (h) { return String(h).trim().toLowerCase(); });
  const nm = String(name).trim().toLowerCase();
  const edits = [];
  for (let i = LINK_DATA_START; i < rows.length; i++) {
    if (String(rows[i][LK.NAME] || '').trim().toLowerCase() !== nm) continue;
    people.forEach(function (u) {
      const col = head.indexOf(u.username.toLowerCase());
      if (col >= LK.USERS && isOn_(rows[i][col]) !== on) edits.push([i, col, on]);
    });
    break;
  }
  const n = writeCells_(LINK_KINDS[kind], edits);
  forgetTabs_();
  return n;
}

/** Called from onPortalEdit for the new tabs and for Users → Designation / names. */
function onDesignationEdit_(e, name) {
  const r = e.range, top = r.getRow(), left = r.getColumn();
  const nr = r.getNumRows(), nc = r.getNumColumns();
  if (name === TABS.USERS.name) {
    if (left <= U.NAME + 1) { syncLinkGridLocked_('sheet'); syncLinkGridLocked_('form'); }
    if (left <= U.DESIG + 1 && left + nc - 1 >= U.DESIG + 1) {
      const rows = sheet_(TABS.USERS).getRange(top, 1, nr, U.DESIG + 1).getValues();
      rows.forEach(function (row) {
        const un = String(row[U.USER] || '').trim();
        if (un) applyDesignation_(un, String(row[U.DESIG] || '').trim(), nr === 1 && nc === 1 ? e.oldValue : '');
      });
    }
    return;
  }
  if (name === TABS.DESIGNATIONS.name) {
    if (left === 1) { syncDesigLinksLocked_(); return; }
    const sh = sheet_(TABS.DESIGNATIONS), all = sh.getDataRange().getValues(), lay = desigLayout_(all);
    const byCol = {};
    Object.keys(lay.apps).forEach(function (id) { const c = lay.apps[id]; if (c.tick !== undefined) byCol[c.tick] = [id, 'tick']; if (c.role !== undefined) byCol[c.role] = [id, 'role']; });
    for (let i = Math.max(top, 3); i < top + nr; i++) for (let c = left; c < left + nc; c++) {
      const hit = byCol[c - 1], d = String((all[i - 1] || [])[0] || '').trim();
      if (hit && d) applyDesignationCell_(d, hit[0], hit[1], (all[i - 1] || [])[c - 1]);
    }
    return;
  }
  if (name === TABS.SHEETS.name || name === TABS.FORMS.name) {
    if (left === 1 || (left <= LK.DESIG + 1 && top <= 2)) syncDesigLinksLocked_();
    return;
  }
  if (name === TABS.DLINKS.name) {
    const all = sheet_(TABS.DLINKS).getDataRange().getValues();
    let kind = '';
    const kinds = [];
    for (let c = 1; c < (all[0] || []).length; c++) {
      const g = String(all[0][c] || '').trim().toUpperCase();
      if (g === 'SHEETS') kind = 'sheet'; else if (g === 'FORMS') kind = 'form';
      kinds[c] = kind;
    }
    for (let i = Math.max(top, 3); i < top + nr; i++) for (let c = Math.max(left, 2); c < left + nc; c++) {
      const d = String((all[i - 1] || [])[0] || '').trim(), nm = String((all[1] || [])[c - 1] || '').trim();
      if (d && nm && kinds[c - 1]) applyDesigLinkCell_(d, kinds[c - 1], nm, isOn_(all[i - 1][c - 1]));
    }
  }
}

/** Menu: build / repair the Designations, Sheets, Forms and Designation Links tabs. */
function adminSyncDesignations() {
  assertAdmin_();
  withLock_(function () { syncLinkGridLocked_('sheet'); syncLinkGridLocked_('form'); syncDesignationsLocked_(); });
  SpreadsheetApp.getActive().toast('Designations, Sheets, Forms and Designation Links are ready.', 'Portal Admin', 5);
}

/** Menu: give everyone what their designation includes (only adds; nothing is removed). */
function adminApplyDesignations() {
  assertAdmin_();
  let n = 0, people = 0;
  withLock_(function () { allUsers_().forEach(function (u) { if (u.designation) { people++; n += applyDesignation_(u.username, u.designation, ''); } }); });
  syncDirectSafe_();
  SpreadsheetApp.getUi().alert('Designations applied', people + ' people with a designation · ' + n + ' cells ticked or filled.\nNothing was removed.', SpreadsheetApp.getUi().ButtonSet.OK);
}

/* ---- the portal: Sheets and Forms menus ------------------------------ */

/** The sheets / forms this person is ticked for, without links (links are only handed out on tap). */
function linkItemsFor_(kind, username) {
  const m = linkMap_(kind), u = String(username).toLowerCase();
  return Object.keys(m).filter(function (k) { return m[k].users[u] && m[k].link; })
    .map(function (k) { return { name: m[k].name, site: m[k].site, desig: m[k].desig }; });
}

/** Tapped in the portal: checks the tick again, then hands back the link. */
function openLink(session, kind, name) {
  const user = requireSession_(session);
  if (!LINK_KINDS[kind]) throw new Error('Unknown item.');
  forgetTabs_();
  const it = linkMap_(kind)[String(name || '').trim().toLowerCase()];
  if (!it || !it.link || !it.users[user.username.toLowerCase()]) throw new Error('You do not have access to this ' + kind + '.');
  if (!/^https:\/\//i.test(it.link)) throw new Error('This ' + kind + ' has no valid link yet. Ask the IT admin.');
  if (PORTAL_CFG.LOG_OPENS) log_(user.username, 'OPEN', kind.toUpperCase(), it.name);
  return { url: it.link };
}

/* ======================================================================
 * BADGES — pending counts (every 5 minutes, and after an app is closed)
 * ==================================================================== */

function badgeUser_(u, app, acc) {
  return { u: u.username, lu: localIdFor_(u, app, acc, getLocalLogin_(u.username, app.id)), r: acc.role || '', s: acc.site || '', d: acc.doer || '' };
}

function refreshBadges_() {
  const access = accessMap_();
  const users = allUsers_().filter(function (u) { return u.active; });
  const apps = getApps_().filter(function (a) { return a.active && a.badges; });
  const jobs = [];
  apps.forEach(function (app) {
    if (app.id === levantoAppId_()) {
      try { writeBadgeCache_(app.id, { '*': levantoCount_() }, ''); }
      catch (e) { writeBadgeCache_(app.id, readBadges_(app.id) || {}, String(e.message || e)); }
      return;
    }
    if (app.type !== 'CONNECTED' || !app.url || !appKey_(app)) return;
    const list = users.filter(function (u) { const a = access[u.username.toLowerCase()]; return a && a[app.id] && a[app.id].on; })
      .map(function (u) { return badgeUser_(u, app, access[u.username.toLowerCase()][app.id]); });
    for (let i = 0; i < list.length; i += 15) jobs.push({ app: app, op: 'counts', data: { users: list.slice(i, i + 15) } });
  });
  const merged = {}, errors = {};
  callAppsParallel_(jobs).forEach(function (r, i) {
    const id = jobs[i].app.id;
    merged[id] = merged[id] || Object.assign({}, readBadges_(id) || {});   // a failed batch keeps its old numbers
    if (r.ok) Object.assign(merged[id], r.data || {}); else errors[id] = r.error;
  });
  Object.keys(merged).forEach(function (id) { writeBadgeCache_(id, merged[id], errors[id] || ''); });
}

function writeBadgeCache_(appId, counts, error, cacheOnly) {
  try { CacheService.getScriptCache().put('badge_' + appId, JSON.stringify(counts), PORTAL_CFG.BADGE_CACHE_SECONDS); } catch (e) {}
  if (cacheOnly) return;
  try {
    const sh = sheet_(TABS.BADGES);
    const rows = sh.getDataRange().getValues();
    let row = -1;
    for (let i = 1; i < rows.length; i++) if (String(rows[i][0]) === appId) { row = i + 1; break; }
    const vals = [appId, JSON.stringify(counts), new Date(), error === undefined ? (row > 0 ? rows[row - 1][3] : '') : error];
    if (row === -1) sh.appendRow(vals); else sh.getRange(row, 1, 1, 4).setValues([vals]);
  } catch (e) {}
}

function readBadges_(appId) {
  try {
    const hit = CacheService.getScriptCache().get('badge_' + appId);
    if (hit) return JSON.parse(hit);
  } catch (e) {}
  try {
    const rows = sheet_(TABS.BADGES).getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) if (String(rows[i][0]) === appId) return JSON.parse(rows[i][1] || '{}');
  } catch (e) {}
  return null;
}

function badgeFrom_(all, username) {
  if (!all) return null;
  const n = all[username] !== undefined ? all[username] : all['*'];
  return typeof n === 'number' ? n : null;
}

/** { appId: counts } for every app — one cache call, the sheet only for what the cache lost. */
function readAllBadges_() {
  const ids = getApps_().filter(function (a) { return a.badges; }).map(function (a) { return a.id; });
  const out = {};
  if (!ids.length) return out;
  try {
    const hits = CacheService.getScriptCache().getAll(ids.map(function (id) { return 'badge_' + id; }));
    Object.keys(hits).forEach(function (k) { out[k.slice(6)] = JSON.parse(hits[k]); });
  } catch (e) {}
  if (ids.some(function (id) { return !out[id]; })) {
    try {
      sheet_(TABS.BADGES).getDataRange().getValues().slice(1).forEach(function (r) {
        if (!out[r[0]] && r[1]) out[r[0]] = JSON.parse(r[1]);
      });
    } catch (e) {}
  }
  return out;
}

/* ---- Levanto: read its sheet, the dashboard itself is untouched ------ */

function levantoAppId_() { return String(settingsMap_().LEVANTO_APP_ID || 'LEVANTO'); }

function levantoRead_() {
  const cfg = settingsMap_();
  if (!cfg.LEVANTO_SHEET_ID) throw new Error('Settings: LEVANTO_SHEET_ID is empty.');
  const tab = cfg.LEVANTO_ALERTS_TAB || 'Grade Alerts';
  const sh = SpreadsheetApp.openById(cfg.LEVANTO_SHEET_ID).getSheetByName(tab);
  if (!sh) throw new Error('Levanto sheet has no tab "' + tab + '".');
  const v = sh.getDataRange().getValues();
  const head = (v[0] || []).map(function (h) { return String(h).trim(); });
  const openCol = findHeader_(head, cfg.LEVANTO_OPEN_HEADER, /respon|resolv|attend|action|closed|replied/i);
  const timeCol = findHeader_(head, cfg.LEVANTO_TIME_HEADER, /time|date|raised|created|reported/i);
  return { cfg: cfg, tab: tab, head: head, rows: v.slice(1), openCol: openCol, timeCol: timeCol };
}

function levantoCount_() {
  const d = levantoRead_();
  if (d.openCol < 0) throw new Error('Could not tell which column marks an alert as answered. Set LEVANTO_OPEN_HEADER in Settings.');
  const want = String(d.cfg.LEVANTO_OPEN_VALUE || '').trim().toLowerCase();
  const hours = Number(d.cfg.LEVANTO_WINDOW_HOURS || 0);
  const now = Date.now();
  let n = 0;
  d.rows.forEach(function (r) {
    if (!r.join('').trim()) return;
    const cell = String(r[d.openCol] === undefined ? '' : r[d.openCol]).trim().toLowerCase();
    if (want ? cell !== want : cell !== '') return;
    if (hours > 0 && d.timeCol > -1) {
      const t = r[d.timeCol] instanceof Date ? r[d.timeCol] : new Date(r[d.timeCol]);
      if (isNaN(t.getTime()) || now - t.getTime() > hours * 3600000) return;
    }
    n++;
  });
  return n;
}

function findHeader_(head, wanted, guess) {
  if (wanted) {
    const i = head.map(function (h) { return h.toLowerCase(); }).indexOf(String(wanted).trim().toLowerCase());
    return i;
  }
  for (let i = 0; i < head.length; i++) if (guess.test(head[i])) return i;
  return -1;
}


/* ======================================================================
 * TRIGGERS
 * ==================================================================== */

/** Every minute: switch retries + user sync. */
function portalMinuteJob() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    let t = Date.now();
    const ms = [], lap = function (name) { const n = Date.now(); ms.push(name + ' ' + (n - t) + 'ms'); t = n; };
    try { pushMode_(); } catch (e) { console.error('pushMode_: ' + e); } lap('mode');
    try { syncUsers_(); } catch (e) { console.error('syncUsers_: ' + e); } lap('v1 sync');
    try { syncDirect_(false); } catch (e) { console.error('syncDirect_: ' + e); } lap('v2 tabs');
    try { syncPhotoTabs_(); } catch (e) { console.error('syncPhotoTabs_: ' + e); }   // profile photos for v2 apps (Photos.js)
    try { trimLog_(); } catch (e) { console.error('trimLog_: ' + e); } lap('log');
    if (prop_('UNIQUE_USER_RULES') !== '1') {          // once: switch on the no-duplicate rules in Users
      try { applyUniqueUserRules_(); props_().setProperty('UNIQUE_USER_RULES', '1'); console.log('duplicate-user rules applied'); }
      catch (e) { console.error('applyUniqueUserRules_: ' + e); }
    }
    console.log('minute job: ' + ms.join(' · '));
  } finally { lock.releaseLock(); }
}

/** Every 5 minutes: pending counts. */
function portalBadgeJob() {
  refreshBadges_();
}

/** Daily: dropdown values from the apps. */
function portalDailyJob() {
  try { withLock_(function () { syncDirect_(true); }); } catch (e) { console.error('syncDirect_: ' + e); }   // repairs hand-edited / deleted tabs
  try { applyUniqueUserRules_(); } catch (e) { console.error('applyUniqueUserRules_: ' + e); }              // puts back removed duplicate rules
  refreshLists_();
}


/* ======================================================================
 * ADMIN — "Portal Admin" menu in the master sheet
 * ==================================================================== */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Portal Admin')
    .addItem('Set up / repair tabs', 'adminSetup')
    .addItem('Refresh Access grid', 'adminSyncAccess')
    .addItem('Apply typed passwords', 'adminApplyPasswords')
    .addItem('Check for duplicate users', 'adminCheckDuplicates')
    .addSeparator()
    .addItem('Sync now', 'adminSyncNow')
    .addItem('Retry failed syncs', 'adminRetryFailed')
    .addItem('Refresh dropdowns from apps', 'adminRefreshLists')
    .addItem('Refresh badges now', 'adminRefreshBadges')
    .addSeparator()
    .addItem('Send set-password email to selected user(s)', 'adminSendInvites')
    .addItem('Import existing users from apps (one-time)', 'adminImport')
    .addItem('Give access as the apps have it (from Import)', 'adminApplyImport')
    .addSeparator()
    .addItem('Build / repair Designations, Sheets & Forms tabs', 'adminSyncDesignations')
    .addItem('Apply designations to everyone (adds only)', 'adminApplyDesignations')
    .addSeparator()
    .addItem('Connect selected app (show its key)', 'adminAppSecret')
    .addItem('Test connection to selected app', 'adminTestApp')
    .addItem('Test Levanto badge', 'adminTestLevanto')
    .addItem('Show portal link', 'adminShowUrl')
    .addToUi();
}

/** Blocks portal visitors from calling admin functions through google.script.run. */
function assertAdmin_() {
  const active = Session.getActiveUser().getEmail();
  const eff = Session.getEffectiveUser().getEmail();
  if (!active || active !== eff) throw new Error('Admin only.');
}

function adminSetup() {
  assertAdmin_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const p = props_();
  p.setProperty('MASTER_ID', ss.getId());
  if (!p.getProperty('HUB_SECRET')) p.setProperty('HUB_SECRET', randomHex_(64));
  if (!p.getProperty('PEPPER')) p.setProperty('PEPPER', randomHex_(64));
  PROPS_ = null;

  Object.keys(TABS).forEach(function (k) {
    const tab = TABS[k];
    let sh = ss.getSheetByName(tab.name);
    if (!sh) sh = ss.insertSheet(tab.name);
    if (tab.built) return;                                 // Access / Designations / Sheets / Forms / Designation Links build themselves
    const have = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
    if (!String(have[0] || '').trim()) {
      sh.getRange(1, 1, 1, tab.head.length).setValues([tab.head]);
    } else if (tab.head.length > have.length && tab !== TABS.LISTS) {
      // add new columns at the far right, never move existing ones
      const add = tab.head.slice(have.length);
      sh.getRange(1, have.length + 1, 1, add.length).setValues([add]);
    }
    sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), tab.head.length)).setFontWeight('bold').setBackground('#E8EAF6');
    sh.setFrozenRows(1);
  });

  const cb = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  const users = sheet_(TABS.USERS);
  users.getRange(2, U.ACTIVE + 1, 999, 1).setDataValidation(cb);
  users.getRange(2, U.PWSET + 1, 999, 1).setDataValidation(cb);
  users.getRange(2, U.ADMIN + 1, 999, 1).setDataValidation(cb);
  users.hideColumns(U.HASH + 1, 2);                        // Password Hash + Salt
  applyUniqueUserRules_();                                 // no two people with one username / phone / email
  const apps = sheet_(TABS.APPS);
  apps.getRange(2, A.ACTIVE + 1, 199, 1).setDataValidation(cb);
  apps.getRange(2, A.BADGES + 1, 199, 1).setDataValidation(cb);
  apps.getRange(2, A.MATCH + 1, 199, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['Username', 'Phone', 'Email', 'Doer name'], true).build());
  apps.getRange(2, A.TYPE + 1, 199, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['CONNECTED', 'LINK'], true).build());
  sheet_(TABS.LOGINS).getRange(2, L.APP + 1, 999, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInRange(apps.getRange('A2:A200'), true).build());

  if (apps.getLastRow() < 2) apps.getRange(2, 1, DEFAULT_APPS.length, DEFAULT_APPS[0].length).setValues(DEFAULT_APPS);
  else {                                                   // add v2 apps (Sheet ID) and public dashboards (LINK) that are not listed yet
    const have = {};
    let last = 1;                                          // last row with an App ID (checkbox rows run further down)
    apps.getRange(2, 1, apps.getLastRow() - 1, 1).getValues().forEach(function (r, i) {
      const id = String(r[0]).trim(); if (id) { have[id] = true; last = i + 2; }
    });
    const add = DEFAULT_APPS.filter(function (r) { return (r[A.SHEET] || (r[A.TYPE] === 'LINK' && r[A.URL])) && !have[r[0]]; });
    if (add.length) apps.getRange(last + 1, 1, add.length, add[0].length).setValues(add);
  }

  const settings = sheet_(TABS.SETTINGS);
  const have = settingsMap_();
  DEFAULT_SETTINGS.forEach(function (d) { if (have[d[0]] === undefined) settings.appendRow([d[0], d[1], '', new Date()]); });
  forgetTabs_();

  sheet_(TABS.SYNC).hideColumns(8);                        // Hash
  [TABS.LISTS, TABS.BADGES].forEach(function (t) { try { sheet_(t).hideSheet(); } catch (e) {} });
  [TABS.SETTINGS, TABS.SYNC, TABS.LISTS, TABS.BADGES].forEach(function (t) {
    try {
      const sh = sheet_(t);
      if (!sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).length) sh.protect().setDescription('Written by the portal script').setWarningOnly(true);
    } catch (e) {}
  });

  // Installable triggers: edits, the 1-minute sync, the 5-minute badges, the daily dropdown refresh.
  const want = { onPortalEdit: 1, portalMinuteJob: 1, portalBadgeJob: 1, portalDailyJob: 1 };
  ScriptApp.getProjectTriggers().forEach(function (t) { delete want[t.getHandlerFunction()]; });
  if (want.onPortalEdit) ScriptApp.newTrigger('onPortalEdit').forSpreadsheet(ss).onEdit().create();
  if (want.portalMinuteJob) ScriptApp.newTrigger('portalMinuteJob').timeBased().everyMinutes(1).create();
  if (want.portalBadgeJob) ScriptApp.newTrigger('portalBadgeJob').timeBased().everyMinutes(5).create();
  if (want.portalDailyJob) ScriptApp.newTrigger('portalDailyJob').timeBased().everyDays(1).atHour(6).create();

  syncAccess_();
  try { withLock_(function () { syncLinkGridLocked_('sheet'); syncLinkGridLocked_('form'); syncDesignationsLocked_(); }); }
  catch (e) { console.error('designations setup: ' + e); }
  ss.toast('Portal tabs are ready.', 'Portal Admin', 5);
}

function adminSyncAccess() { assertAdmin_(); syncAccess_(); SpreadsheetApp.getActive().toast('Access grid refreshed.', 'Portal Admin', 4); }
function adminApplyPasswords() { assertAdmin_(); const n = applyPasswords_(); SpreadsheetApp.getActive().toast(n + ' password(s) saved.', 'Portal Admin', 4); }

function adminSyncNow() {
  assertAdmin_();
  const r = withLock_(syncUsers_);
  const d = withLock_(function () { return syncDirect_(true); });
  SpreadsheetApp.getActive().toast(r.pushed + ' pushed, ' + r.blocked + ' need fixing (see Sync tab).' + (d ? '\n' + d : ''), 'Portal Admin', 8);
}

function adminRetryFailed() {
  assertAdmin_();
  const sh = sheet_(TABS.SYNC);
  const last = sh.getLastRow();
  if (last > 1) {
    const rng = sh.getRange(2, 1, last - 1, 8);
    const v = rng.getValues();
    v.forEach(function (r) { if (r[4] !== 'OK') r[7] = ''; });
    rng.setValues(v);
  }
  adminSyncNow();
}

function adminRefreshLists() {
  assertAdmin_();
  const r = refreshLists_();
  SpreadsheetApp.getUi().alert('Dropdowns', r, SpreadsheetApp.getUi().ButtonSet.OK);
}

function adminRefreshBadges() {
  assertAdmin_();
  refreshBadges_();
  SpreadsheetApp.getActive().toast('Badges refreshed (see the hidden Badges tab for errors).', 'Portal Admin', 5);
}

/** Installable onEdit (created by Set up). */
function onPortalEdit(e) {
  if (!e || !e.range || typeof e.range.getSheet !== 'function') return; // ignore fake calls
  forgetTabs_();                                                        // any edit = fresh reads
  const name = e.range.getSheet().getName();
  if (name === TABS.USERS.name) { try { guardUniqueUsers_(e); } catch (err) { console.error('guardUniqueUsers_: ' + err); } }
  const col = e.range.getColumn();
  const lastCol = col + e.range.getNumColumns() - 1;
  if (name === TABS.USERS.name && col <= U.SETPW + 1 && lastCol >= U.SETPW + 1) applyPasswords_();
  if ((name === TABS.USERS.name && col <= U.NAME + 1) ||
      (name === TABS.APPS.name && (col <= A.ID + 1 || (col <= A.FIELDS + 1 && lastCol >= A.FIELDS + 1)))) syncAccess_();
  if (name === TABS.APPS.name && (col <= A.ID + 1 || (col <= A.FIELDS + 1 && lastCol >= A.FIELDS + 1) || (col <= A.ACTIVE + 1 && lastCol >= A.ACTIVE + 1))) {
    try { withLock_(syncDesignationsLocked_); } catch (err) { console.error('syncDesignations: ' + err); }
  }
  // Designations, Sheets, Forms, Designation Links, and Users → Designation / names
  if ([TABS.USERS.name, TABS.DESIGNATIONS.name, TABS.SHEETS.name, TABS.FORMS.name, TABS.DLINKS.name].indexOf(name) > -1) {
    try { withLock_(function () { onDesignationEdit_(e, name); }); } catch (err) { console.error('onDesignationEdit_: ' + err); }
  }
  // v2 apps: a tick / untick (or a changed name, phone, password…) reaches the app's sheet now
  if ([TABS.USERS.name, TABS.ACCESS.name, TABS.APPS.name, TABS.LOGINS.name, TABS.DESIGNATIONS.name, TABS.DLINKS.name].indexOf(name) > -1) syncDirectSafe_();
}

/** Anything typed in "Set Password" becomes a salted hash; the typed text is wiped. */
function applyPasswords_() {
  const sh = sheet_(TABS.USERS);
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const rng = sh.getRange(2, U.SETPW + 1, last - 1, 3); // Set Password, Hash, Salt
  const v = rng.getValues();
  const flags = [];
  let n = 0;
  v.forEach(function (r) {
    const pw = String(r[0]);
    flags.push([null]);
    if (!pw) return;
    const salt = randomHex_(24);
    r[1] = hashPassword_(pw, salt);
    r[2] = salt;
    r[0] = '';
    flags[flags.length - 1] = [true];
    n++;
  });
  if (n) {
    rng.setValues(v);
    const cur = sh.getRange(2, U.PWSET + 1, last - 1, 1).getValues();
    sh.getRange(2, U.PWSET + 1, last - 1, 1).setValues(cur.map(function (c, i) { return flags[i][0] ? [true] : c; }));
    forgetTabs_();
  }
  return n;
}

/**
 * Rebuilds the Access grid from Users + Apps: two header rows, one ✓ per app
 * plus its Role / Site / Doer name columns, dropdowns and colours.
 * Keeps every tick and choice already made (also from the old one-row layout).
 */
function syncAccess_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { syncAccessLocked_(); } finally { lock.releaseLock(); }
}

function syncAccessLocked_() {
  forgetTabs_();
  const sh = sheet_(TABS.ACCESS);
  const oldRows = sh.getDataRange().getValues();
  const lay = accessLayout_(oldRows);
  const oldMap = accessMap_();
  const users = allUsers_();
  const apps = getApps_();
  const lists = listsMap_();

  // user order: existing rows first, then new users from the Users tab
  const nameOf = {}, order = [], seen = {}, oldStatus = {}, oldName = {};
  users.forEach(function (u) { nameOf[u.username.toLowerCase()] = u.name; });
  for (let i = lay.dataStart; i < oldRows.length; i++) {
    const un = String(oldRows[i][0]).trim();
    if (!un || seen[un.toLowerCase()]) continue;
    seen[un.toLowerCase()] = true;
    order.push(un);
    oldName[un.toLowerCase()] = String(oldRows[i][1] || '');
    if (lay.status > -1) oldStatus[un.toLowerCase()] = oldRows[i][lay.status];
  }
  users.forEach(function (u) { if (!seen[u.username.toLowerCase()]) { seen[u.username.toLowerCase()] = true; order.push(u.username); } });

  const h1 = ['USER', ''], h2 = ['Username', 'Name'], cols = [];
  apps.forEach(function (a) {
    cols.push({ app: a, field: 'tick', col: h1.length });
    h1.push(a.id); h2.push('✓');
    a.fields.forEach(function (f) { cols.push({ app: a, field: f, col: h1.length }); h1.push(''); h2.push(FIELD_LABEL[f]); });
  });
  const statusCol = h1.length;
  h1.push('SYNC'); h2.push('Status');
  const width = h1.length;

  const body = order.map(function (un) {
    const lc = un.toLowerCase();
    const acc = oldMap[lc] || {};
    const row = [un, nameOf[lc] !== undefined ? nameOf[lc] : oldName[lc] || ''];
    cols.forEach(function (c) {
      const v = acc[c.app.id] || {};
      row.push(c.field === 'tick' ? v.on === true : (v[c.field] || ''));
    });
    row.push(oldStatus[lc] || '');
    return row;
  });

  // Rewrite in ONE write over the old area (padded with blanks): there is never a moment
  // with an empty grid, so a timeout mid-way cannot lose ticks.
  const need = body.length + 2 + 201;                    // users + headers + the 200 spare rows that get dropdowns
  if (sh.getMaxRows() < need) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows());
  if (sh.getMaxColumns() < width) sh.insertColumnsAfter(sh.getMaxColumns(), width - sh.getMaxColumns());
  const H = Math.max(oldRows.length, body.length + 2);
  const W = Math.max(oldRows[0] ? oldRows[0].length : 0, width);
  const grid = [h1, h2].concat(body).map(function (r) { return r.concat(new Array(W - r.length).fill('')); });
  while (grid.length < H) grid.push(new Array(W).fill(''));
  const all = sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns());
  all.breakApart();                                        // keeps values
  all.clearDataValidations();
  all.setBackground(null).setFontColor(null).setFontWeight(null);
  sh.getRange(1, 1, H, W).setValues(grid);

  // header look: one merged, coloured block per app
  const palette = ['#4F46E5', '#0E7490', '#B45309', '#15803D', '#7C3AED', '#57534E', '#9A3412', '#1F2937', '#BE185D', '#0369A1'];
  sh.getRange(1, 1, 1, 2).merge().setBackground('#5F6368');
  let p = 0;
  apps.forEach(function (a) {
    const span = 1 + a.fields.length;
    const start = cols.filter(function (c) { return c.app === a && c.field === 'tick'; })[0].col + 1;
    const rng = sh.getRange(1, start, 1, span);
    if (span > 1) rng.merge();
    rng.setBackground(/^#[0-9a-f]{6}$/i.test(a.color) ? a.color : palette[p++ % palette.length]);
  });
  sh.getRange(1, statusCol + 1).setBackground('#374151');
  sh.getRange(1, 1, 1, width).setFontColor('#FFFFFF').setFontWeight('bold').setHorizontalAlignment('center');
  sh.getRange(2, 1, 1, width).setFontWeight('bold').setBackground('#E8EAF6').setHorizontalAlignment('center');
  sh.setFrozenRows(2);
  sh.setFrozenColumns(2);

  // dropdowns + checkboxes
  const n = Math.max(body.length, 1) + 200;               // room for new users
  const listsSh = book_().getSheetByName(TABS.LISTS.name);
  const rules = [];
  cols.forEach(function (c) {
    const rng = sh.getRange(3, c.col + 1, n, 1);
    const tickCol = cols.filter(function (x) { return x.app === c.app && x.field === 'tick'; })[0].col + 1;
    const T = colLetter_(tickCol), C = colLetter_(c.col + 1);
    if (c.field === 'tick') { rng.setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build()); return; }
    const key = c.app.id + (c.field === 'role' ? '_ROLES' : c.field === 'site' ? '_SITES' : '_DOERS');
    if (listsSh && lists[key]) {
      const src = listsSh.getRange(2, lists[key].col + 1, 500, 1);
      rng.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(src, true)
        .setAllowInvalid(c.field === 'doer').build());     // a brand-new doer name may be typed
    }
    // grey when the app is not ticked
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$' + T + '3<>TRUE')
      .setBackground('#F1F3F4').setFontColor('#BDC1C6').setRanges([rng]).build());
    // red when ticked but a required value is missing
    let need = '=AND($' + T + '3=TRUE,' + C + '3="")';
    if (c.field === 'site') {
      const sr = lists[c.app.id + '_SITEROLES'];
      const roleCol = cols.filter(function (x) { return x.app === c.app && x.field === 'role'; })[0];
      if (sr && roleCol && listsSh) {
        const L1 = colLetter_(sr.col + 1);
        // conditional formats cannot point at another tab directly, hence INDIRECT
        need = '=AND($' + T + '3=TRUE,' + C + '3="",COUNTIF(INDIRECT("Lists!$' + L1 + '$2:$' + L1 + '$500"),$' + colLetter_(roleCol.col + 1) + '3)>0)';
      } else if (!sr) return;                              // site is optional when the app gives no rule
    }
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(need)
      .setBackground('#FCE8E6').setFontColor('#C5221F').setRanges([rng]).build());
  });
  sh.setConditionalFormatRules(rules);
  forgetTabs_();
}

/** Asks every connected app for its roles / sites / doers → Lists tab → dropdowns. */
function refreshLists_() {
  const apps = connectedApps_();
  const results = callAppsParallel_(apps.map(function (a) { return { app: a, op: 'meta', data: {} }; }));
  const cols = [];
  const notes = [];
  results.forEach(function (r, i) {
    const id = apps[i].id;
    if (!r.ok) { notes.push(id + ': ' + r.error); return; }
    const m = r.data || {};
    if (m.roles && m.roles.length) cols.push([id + '_ROLES'].concat(m.roles));
    if (m.sites && m.sites.length) cols.push([id + '_SITES'].concat(m.sites));
    if (m.siteRoles && m.siteRoles.length) cols.push([id + '_SITEROLES'].concat(m.siteRoles));
    if (m.doers && m.doers.length) cols.push([id + '_DOERS'].concat(m.doers));
    notes.push(id + ': ok');
  });
  const old = listsMap_();                 // keep lists of apps that did not answer this time
  Object.keys(old).forEach(function (k) {
    if (!cols.some(function (c) { return c[0] === k; })) cols.push([k].concat(old[k].values));
  });
  const sh = sheet_(TABS.LISTS);
  sh.clearContents();
  if (cols.length) {
    const h = Math.max.apply(null, cols.map(function (c) { return c.length; }));
    const grid = [];
    for (let r = 0; r < h; r++) grid.push(cols.map(function (c) { return c[r] === undefined ? '' : c[r]; }));
    sh.getRange(1, 1, h, cols.length).setValues(grid);
    sh.getRange(1, 1, 1, cols.length).setFontWeight('bold');
  } else {
    sh.getRange(1, 1).setValue(TABS.LISTS.head[0]);
  }
  forgetTabs_();
  syncAccess_();                           // re-point the dropdowns
  try { withLock_(syncDesignationsLocked_); } catch (e) { console.error('syncDesignations: ' + e); }
  return notes.join('\n') || 'No connected apps yet.';
}

/** Emails the selected users how to set their first password. */
function adminSendInvites() {
  assertAdmin_();
  const ui = SpreadsheetApp.getUi();
  const sh = SpreadsheetApp.getActiveSheet();
  if (sh.getName() !== TABS.USERS.name) { ui.alert('Select one or more rows in the Users tab first.'); return; }
  const url = hubUrl_();   // the live link (Google's own getUrl() gave the editor's test address)
  if (!url) { ui.alert('Deploy the portal first (Deploy → New deployment → Web app).'); return; }
  const rng = sh.getActiveRange();
  const users = allUsers_().filter(function (u) { return u.row >= rng.getRow() && u.row <= rng.getLastRow(); });
  let sent = 0;
  const skipped = [];
  users.forEach(function (u) {
    if (!u.email || !u.active) { skipped.push(u.username); return; }
    MailApp.sendEmail({
      to: u.email, name: PORTAL_CFG.TITLE, subject: 'Your GGM Portal account',
      htmlBody:
        '<div style="font-family:Arial,Helvetica,sans-serif;max-width:460px;margin:0 auto;padding:24px;color:#1B1A17">' +
        '<h2 style="margin:0 0 8px">Welcome to GGM Portal</h2>' +
        '<p style="color:#6C685D;font-size:14px;line-height:1.6">One sign-in now opens every app you use.</p>' +
        '<p style="font-size:14px">Your username: <b>' + esc_(u.username) + '</b> (your phone number works too).</p>' +
        '<ol style="font-size:14px;line-height:1.7;color:#1B1A17"><li>Open <a href="' + url + '">GGM Portal</a></li>' +
        '<li>Tap <b>First time here?</b> and enter your username</li><li>Type the code we email you and choose a password</li></ol></div>'
    });
    log_(u.username, 'INVITE', '', maskEmail_(u.email));
    sent++;
  });
  ui.alert('Invites', sent + ' sent.' + (skipped.length ? '\nSkipped (no email or switched off): ' + skipped.join(', ') : ''), ui.ButtonSet.OK);
}

/** Pulls the users each app already has into the Import tab, with a suggested match. */
function adminImport() {
  assertAdmin_();
  const apps = httpApps_();
  const results = callAppsParallel_(apps.map(function (a) { return { app: a, op: 'listUsers', data: {} }; }));
  const hub = allUsers_();
  const byPhone = {}, byEmail = {}, byName = {};
  hub.forEach(function (u) {
    if (u.phone) byPhone[u.phone] = u.username;
    if (u.email) byEmail[u.email.toLowerCase()] = u.username;
    byName[u.name.toLowerCase().replace(/\s+/g, ' ')] = u.username;
  });
  const out = [];
  const errors = [];
  results.forEach(function (r, i) {
    if (!r.ok) { errors.push(apps[i].id + ': ' + r.error); return; }
    (r.data || []).forEach(function (x) {
      const ph = digits_(x.phone), em = String(x.email || '').toLowerCase(), nm = String(x.name || '').toLowerCase().replace(/\s+/g, ' ');
      let match = '', how = '';
      if (ph && byPhone[ph]) { match = byPhone[ph]; how = 'phone'; }
      else if (em && byEmail[em]) { match = byEmail[em]; how = 'email'; }
      else if (nm && byName[nm]) { match = byName[nm]; how = 'name'; }
      else { match = suggestUsername_(x.name || x.localId); how = 'new'; }
      out.push([apps[i].id, x.localId || '', x.name || '', x.phone || '', x.email || '', x.role || '', x.site || '', match, how]);
    });
  });
  const sh = sheet_(TABS.IMPORT);
  const last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, TABS.IMPORT.head.length).clearContent();
  if (out.length) sh.getRange(2, 1, out.length, out[0].length).setValues(out);
  SpreadsheetApp.getUi().alert('Import', out.length + ' users listed in the Import tab.\n' +
    'Nothing was added to Users: review the Import tab, then copy people into Users / Access, and put ids that differ into App Logins.' +
    (errors.length ? '\n\nErrors:\n' + errors.join('\n') : ''), SpreadsheetApp.getUi().ButtonSet.OK);
}

/** Menu: tick each app for the portal people that app already has (from the Import tab). */
function adminApplyImport() {
  assertAdmin_();
  const r = withLock_(applyImport_);
  const ui = SpreadsheetApp.getUi();
  ui.alert('Access set from the apps',
    r.ticked + ' app ticks added, ' + r.filled + ' role / site / doer cells filled, ' + r.already + ' already right.\n' +
    (r.sheetTicks !== undefined ? 'Ticks in the Access tab now: ' + r.sheetTicks + '.\n' : '') +
    'Nothing was unticked and no choice you made was changed.' +
    (r.kept.length ? '\n\nKept your choice (the app says otherwise):\n' + r.kept.slice(0, 15).join('\n') : '') +
    (r.unmatched.length ? '\n\nNot in Users (add them first, then run this again):\n' + r.unmatched.slice(0, 25).join('\n') : '') +
    '\n\nThe apps get the changes within a minute (Sync tab).', ui.ButtonSet.OK);
}

/**
 * Import tab → Access grid. A person is linked when the import matched them (phone / email / name),
 * or their portal username equals the app's id and the app has no real phone for them.
 * Only adds: ticks the app, and fills Role / Site / Doer name where that cell is still empty.
 */
function applyImport_() {
  syncAccessLocked_();                                   // every Users row has its Access row
  const sh = sheet_(TABS.ACCESS);
  const rows = sh.getDataRange().getValues();
  const lay = accessLayout_(rows);
  const users = {};
  allUsers_().forEach(function (u) { users[u.username.toLowerCase()] = u; });
  const rowOf = {};
  for (let i = lay.dataStart; i < rows.length; i++) { const k = String(rows[i][0]).trim().toLowerCase(); if (k) rowOf[k] = i; }
  const fakePhone = function (p) { const d = digits_(p); return !d || /^(\d)\1+$/.test(d); };   // 9999999999 and the like
  const out = { ticked: 0, filled: 0, already: 0, kept: [], unmatched: [] };
  const done = {};                                        // "user|APP" → first app id used (a person gets one doer per app)
  const lists = listsMap_();
  const edits = [];                                       // only the cells that change are written
  // The Role / Site dropdowns refuse values that are not in their list (one bad cell made Google reject
  // the whole write): use the list's own spelling, and skip values the dropdown does not have.
  const allowed = function (appId, field, v) {
    if (field === 'doer') return v;                       // the doer dropdown accepts new names
    const l = lists[appId + (field === 'role' ? '_ROLES' : '_SITES')];
    if (!l) return v;                                     // no dropdown for this column
    const hit = l.values.filter(function (x) { return String(x).trim().toUpperCase() === String(v).trim().toUpperCase(); })[0];
    return hit === undefined ? null : hit;
  };
  values_(TABS.IMPORT).slice(1).forEach(function (r) {
    const appId = String(r[0]).trim(), lid = String(r[1]).trim(), how = String(r[8]).trim();
    if (!appId || !lid) return;
    let uname = how && how !== 'new' ? String(r[7]).trim() : '';
    if (!uname) {
      const u = users[lid.toLowerCase()];
      if (u && (fakePhone(r[3]) || digits_(r[3]) === u.phone)) uname = u.username;
    }
    if (!uname || !users[uname.toLowerCase()]) { out.unmatched.push(appId + ': ' + lid + (r[3] ? ' (' + r[3] + ')' : '')); return; }
    const c = lay.apps[appId], ri = rowOf[uname.toLowerCase()];
    if (!c || c.tick === undefined || ri === undefined) return;
    const key = uname.toLowerCase() + '|' + appId;
    if (done[key]) { out.kept.push(appId + ' · ' + uname + ': also "' + lid + '" in the app (kept "' + done[key] + '")'); return; }
    done[key] = lid;
    const row = rows[ri];
    let changed = false;
    if (!isOn_(row[c.tick])) { row[c.tick] = true; edits.push([ri, c.tick, true]); out.ticked++; changed = true; }
    const fill = function (col, want, label) {
      if (col === undefined || !want) return;
      const have = String(row[col] == null ? '' : row[col]).trim();
      if (!have) {
        const ok = allowed(appId, label, want);
        if (ok === null) { out.kept.push(appId + ' · ' + uname + ': ' + label + ' "' + want + '" is not in the dropdown (left empty)'); return; }
        row[col] = ok; edits.push([ri, col, ok]); out.filled++; changed = true;
      }
      else if (have.toUpperCase() !== String(want).toUpperCase()) out.kept.push(appId + ' · ' + uname + ': ' + label + ' "' + have + '" (app: "' + want + '")');
    };
    fill(c.role, String(r[5]).trim(), 'role');
    fill(c.site, String(r[6]).trim(), 'site');
    fill(c.doer, lid, 'doer');
    if (!changed) out.already++;
  });
  if (edits.length) {
    edits.forEach(function (e) { sh.getRange(e[0] + 1, e[1] + 1).setValue(e[2]); });
    SpreadsheetApp.flush();
    forgetTabs_();
    // read back: how many ticks the sheet really holds now
    const back = sh.getDataRange().getValues();
    let ticks = 0;
    Object.keys(lay.apps).forEach(function (id) { const c = lay.apps[id]; if (c.tick === undefined) return; for (let i = lay.dataStart; i < back.length; i++) if (isOn_(back[i][c.tick])) ticks++; });
    out.sheetTicks = ticks;
    console.log('applyImport_: wrote ' + edits.length + ' cells; ticks now ' + ticks);
    log_('', 'IMPORT_APPLIED', '', out.ticked + ' ticks, ' + out.filled + ' cells; sheet now has ' + ticks + ' ticks');
  }
  return out;
}

function suggestUsername_(name) {
  const w = String(name || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/^[a-z]{2,6}\s*-\s*/, '').replace(/[^a-z\s]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '';
  return w.length > 1 ? w[0] + '.' + w[w.length - 1].charAt(0) : w[0];
}

/** Select any cell in an Apps row, then run this. Shows the secret to paste into that app. */
function adminAppSecret() {
  assertAdmin_();
  const ui = SpreadsheetApp.getUi();
  const appId = selectedAppId_('Connect an app');
  if (!appId) return;
  const v2 = getApps_().filter(function (a) { return a.id === appId && a.sheetId; })[0];
  if (v2) {
    ui.showModalDialog(HtmlService.createHtmlOutput(
      '<div style="font:14px system-ui;line-height:1.45">' +
      '<p><b>' + esc_(appId) + '</b> uses the v2 login. Open its Apps Script project → <b>Project Settings</b> → <b>Script properties</b> → add:</p>' +
      '<p style="margin:10px 0 4px">Property: <code>PORTAL_KEY</code></p>' +
      '<input readonly value="' + esc_(pepper_()) + '" style="width:100%;font:12px monospace;padding:7px" onclick="this.select()">' +
      '<p style="color:#666;margin-top:12px">The same key for every v2 app. Treat it like a password: never put it in a sheet or a message.<br>' +
      'People reach the app through the tab <b>' + esc_(appTabName_(v2)) + '</b>, written in its sheet when you tick them.<br>' +
      'Then use <b>Test connection to selected app</b>.</p></div>').setWidth(520).setHeight(330), 'Connect ' + appId);
    return;
  }

  const key = 'APP_SECRET_' + appId;
  let secret = prop_(key);
  if (secret) {
    const again = ui.alert('Secret already exists for ' + appId,
      'YES = show the existing secret\nNO = make a new one (the app stops opening until you paste the new one into it)',
      ui.ButtonSet.YES_NO_CANCEL);
    if (again === ui.Button.CANCEL) return;
    if (again === ui.Button.NO) secret = null;
  }
  if (!secret) { secret = randomHex_(64); props_().setProperty(key, secret); PROPS_ = null; }
  const hubUrl = hubUrl_();

  const field = function (label, value) {
    return '<p style="margin:10px 0 4px">Property: <code>' + label + '</code></p>' +
      '<input readonly value="' + esc_(value) + '" style="width:100%;font:12px monospace;padding:7px" onclick="this.select()">';
  };
  const html = HtmlService.createHtmlOutput(
    '<div style="font:14px system-ui;line-height:1.45">' +
    '<p>Open the <b>' + esc_(appId) + '</b> Apps Script project → <b>Project Settings</b> → <b>Script properties</b> → add these three:</p>' +
    field('PORTAL_SECRET', secret) + field('PORTAL_APP_ID', appId) + field('PORTAL_HUB_URL', hubUrl) +
    '<p style="color:#666;margin-top:12px">Treat the secret like a password. Anyone who has it can open ' + esc_(appId) + ' as any user.<br>' +
    'Then use <b>Test connection to selected app</b>.</p></div>'
  ).setWidth(520).setHeight(390);
  ui.showModalDialog(html, 'Connect ' + appId);
}

function adminTestApp() {
  assertAdmin_();
  const ui = SpreadsheetApp.getUi();
  const appId = selectedAppId_('Test an app');
  if (!appId) return;
  const app = getApps_().filter(function (a) { return a.id === appId; })[0];
  if (!app) { ui.alert('No app "' + appId + '" in the Apps tab.'); return; }
  if (app.type === 'LINK') { ui.alert(appId + ' is a LINK (public dashboard). There is nothing to connect.'); return; }
  try {
    const r = callApp_(app, 'ping', {});
    ui.alert('Connected', app.sheetId
      ? appId + ' answered (v2 login). People it can see in ' + appTabName_(app) + ': ' + r.users + '.'
      : appId + ' answered. Portal-only inside the app: ' + (r.portalOnly ? 'ON' : 'OFF') + '.', ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Not connected', appId + ': ' + e.message, ui.ButtonSet.OK);
  }
}

function adminTestLevanto() {
  assertAdmin_();
  const ui = SpreadsheetApp.getUi();
  try {
    const d = levantoRead_();
    let count = '—';
    try { count = levantoCount_(); } catch (e) { count = 'error: ' + e.message; }
    ui.alert('Levanto badge',
      'Tab: ' + d.tab + '\nColumns: ' + d.head.join(' | ') +
      '\n\n"Answered" column used: ' + (d.openCol > -1 ? d.head[d.openCol] : '(none found)') +
      '\nTime column used: ' + (d.timeCol > -1 ? d.head[d.timeCol] : '(none found)') +
      '\nWindow: ' + (d.cfg.LEVANTO_WINDOW_HOURS || '0') + ' h' +
      '\n\nSlabs needing attention now: ' + count +
      '\n\nIf a column is wrong, type its exact header into LEVANTO_OPEN_HEADER / LEVANTO_TIME_HEADER in Settings.',
      ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Levanto badge', e.message, ui.ButtonSet.OK);
  }
}

function selectedAppId_(title) {
  const ui = SpreadsheetApp.getUi();
  const sh = SpreadsheetApp.getActiveSheet();
  let appId = '';
  if (sh.getName() === TABS.APPS.name && sh.getActiveRange().getRow() > 1) {
    appId = String(sh.getRange(sh.getActiveRange().getRow(), A.ID + 1).getValue()).trim();
  }
  if (!appId) {
    const r = ui.prompt(title, 'Type the App ID exactly as in the Apps tab:', ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) return '';
    appId = r.getResponseText().trim();
  }
  return appId;
}

function adminShowUrl() {
  assertAdmin_();
  const url = hubUrl_();   // the live link (Google's own getUrl() gave the editor's test address)
  SpreadsheetApp.getUi().alert('Portal link', url ? url : 'Not deployed yet: Deploy → New deployment → Web app.', SpreadsheetApp.getUi().ButtonSet.OK);
}

function log_(username, action, appId, detail) {
  try {
    sheet_(TABS.LOG).appendRow([new Date(), username, action, appId, detail]);   // SPEED: on every tile tap, so one call only
  } catch (e) { /* logging must never block a login */ }
}

/** Oldest Log rows go past LOG_MAX_ROWS (run by the minute job, not on every log write). */
function trimLog_() {
  const sh = sheet_(TABS.LOG);
  const last = sh.getLastRow();
  if (last > PORTAL_CFG.LOG_MAX_ROWS + 1000) sh.deleteRows(2, last - PORTAL_CFG.LOG_MAX_ROWS);
}


/* ======================================================================
 * SMALL HELPERS
 * ==================================================================== */

function props_() { return PropertiesService.getScriptProperties(); }
/* SPEED: all properties in one call per request (each getProperty is a round trip). */
let PROPS_ = null;
function prop_(k) { if (!PROPS_) PROPS_ = props_().getProperties(); return PROPS_[k] || ''; }
function hubSecret_() { const s = prop_('HUB_SECRET'); if (!s) throw new Error('Portal not set up. Run Portal Admin → Set up / repair tabs.'); return s; }
function pepper_() { const s = prop_('PEPPER'); if (!s) throw new Error('Portal not set up. Run Portal Admin → Set up / repair tabs.'); return s; }
function now_() { return Math.floor(Date.now() / 1000); }
function isOn_(v) { return v === true || /^(true|yes|y|1|✓)$/i.test(String(v).trim()); }
function digits_(v) { const d = String(v || '').replace(/\D/g, ''); return d.length > 10 ? d.slice(-10) : d; }
function b64url_(s) { return String(s).replace(/=+$/, ''); }
function pad64_(s) { return s + '==='.slice((s.length + 3) % 4); }
function randomHex_(n) { let s = ''; while (s.length < n) s += Utilities.getUuid().replace(/-/g, ''); return s.slice(0, n); }
function toHex_(bytes) { return bytes.map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join(''); }
function esc_(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function colLetter_(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('The portal is busy. Try again in a minute.');
  try { forgetTabs_(); return fn(); } finally { lock.releaseLock(); }
}
function safeEq_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}
