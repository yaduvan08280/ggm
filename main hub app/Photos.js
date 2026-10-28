/**************************************************************************
 * PROFILE PHOTOS
 *
 * A person adds a photo from the portal's account menu. The phone crops and
 * shrinks it first, so the hub only ever stores two small JPEGs as text:
 *   Thumb  ~112 px square, shown wherever an app draws initials (HJ)
 *   Photo  up to ~480 px, shown big when someone taps a photo
 * They live in the hidden "Photos" tab (one row per username).
 *
 * Connected apps ask for them through the signed app channel (doPost):
 *   op "photos" -> { ver, list: [{ u, n, a: [other names], t }] }   (list left out when ver is unchanged)
 *   op "photo"  -> { p }   the big one, for one username
 **************************************************************************/

const PHOTO_TAB = 'Photos';
const PHOTO_HEAD = ['Username', 'Thumb', 'Photo', 'Updated'];
const PHOTO_MAX_THUMB = 20000;     // characters (a cell holds 50,000)
const PHOTO_MAX_FULL = 49000;
const PHOTO_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;
const PHOTO_CACHE = 'ggm_photo_list';

function photoSheet_(create) {
  let sh = book_().getSheetByName(PHOTO_TAB);
  if (!sh && create) {
    sh = book_().insertSheet(PHOTO_TAB);
    sh.getRange(1, 1, 1, PHOTO_HEAD.length).setValues([PHOTO_HEAD]).setFontWeight('bold');
    sh.setFrozenRows(1);
    try { sh.hideSheet(); } catch (e) {}
  }
  return sh;
}

/** [{ u, t, p, row }] from the Photos tab. */
function photoRows_() {
  const sh = photoSheet_(false);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues()
    .map(function (r, i) { return { u: String(r[0]).trim(), t: String(r[1] || ''), p: String(r[2] || ''), row: i + 2 }; })
    .filter(function (x) { return x.u; });
}

function photosVer_() { return prop_('PHOTOS_VER') || '0'; }

function bumpPhotos_() {
  const v = String(Math.max(Date.now(), Number(photosVer_()) + 1));   // always moves on, even twice in one millisecond
  props_().setProperty('PHOTOS_VER', v);
  if (PROPS_) PROPS_.PHOTOS_VER = v;
  try { CacheService.getScriptCache().remove(PHOTO_CACHE + '_n'); } catch (e) {}
  return v;
}

/** Everyone with a photo, with every name an app may know them by (doer names, app logins). */
function photoList_() {
  const cache = CacheService.getScriptCache();
  const ver = photosVer_();
  try {
    const n = parseInt(cache.get(PHOTO_CACHE + '_n'), 10);
    if (n > 0) {
      const keys = []; for (let i = 0; i < n; i++) keys.push(PHOTO_CACHE + '_' + i);
      const got = cache.getAll(keys);
      if (keys.every(function (k) { return got[k] != null; })) {
        const o = JSON.parse(keys.map(function (k) { return got[k]; }).join(''));
        if (o.ver === ver) return o.list;
      }
    }
  } catch (e) {}

  const rows = photoRows_().filter(function (x) { return x.t; });
  let list = [];
  if (rows.length) {
    const users = {}; allUsers_().forEach(function (u) { users[u.username.toLowerCase()] = u; });
    const access = accessMap_();
    const logins = {};
    values_(TABS.LOGINS).slice(1).forEach(function (r) {
      const u = String(r[L.USER] || '').trim().toLowerCase(), lu = String(r[L.LOCAL] || '').trim();
      if (u && lu) (logins[u] = logins[u] || []).push(lu);
    });
    list = rows.map(function (x) {
      const key = x.u.toLowerCase(), u = users[key];
      if (!u || !u.active) return null;
      const names = {};
      const add = function (s) { s = String(s || '').trim(); if (s && s.toLowerCase() !== key && s.indexOf('@') < 0) names[s] = 1; };
      add(u.name);
      Object.keys(access[key] || {}).forEach(function (id) { add(access[key][id].doer); });
      (logins[key] || []).forEach(add);
      return { u: u.username, n: u.name, a: Object.keys(names), t: x.t };
    }).filter(Boolean);
  }
  try {
    const s = JSON.stringify({ ver: ver, list: list }), put = {};
    let c = 0;
    for (let i = 0; i < s.length; i += 90000) put[PHOTO_CACHE + '_' + (c++)] = s.substr(i, 90000);
    put[PHOTO_CACHE + '_n'] = String(c);
    cache.putAll(put, 21600);
  } catch (e) {}
  return list;
}

function photoOf_(username, big) {
  const key = String(username || '').trim().toLowerCase();
  const r = photoRows_().filter(function (x) { return x.u.toLowerCase() === key; })[0];
  return r ? (big ? (r.p || r.t) : r.t) : '';
}

/* ---------------- called from the portal page ---------------- */

/** Saves (or replaces) the signed-in person's photo. Both images arrive already shrunk. */
function savePhoto(session, thumb, full) {
  const user = requireSession_(session);
  thumb = String(thumb || ''); full = String(full || '');
  if (!PHOTO_RE.test(thumb) || !PHOTO_RE.test(full)) throw new Error('That file is not a photo. Pick a JPG or PNG picture.');
  if (thumb.length > PHOTO_MAX_THUMB || full.length > PHOTO_MAX_FULL) throw new Error('The photo is still too large after shrinking. Try another picture.');
  return withLock_(function () {
    const sh = photoSheet_(true);
    const row = photoRows_().filter(function (x) { return x.u.toLowerCase() === user.username.toLowerCase(); })[0];
    const vals = [[user.username, thumb, full, new Date()]];
    if (row) sh.getRange(row.row, 1, 1, 4).setValues(vals);
    else sh.getRange(sh.getLastRow() + 1, 1, 1, 4).setValues(vals);
    const ver = bumpPhotos_();
    log_(user.username, 'PHOTO', '', 'profile photo added / changed');
    return { thumb: thumb, ver: ver };
  });
}

function removePhoto(session) {
  const user = requireSession_(session);
  return withLock_(function () {
    const row = photoRows_().filter(function (x) { return x.u.toLowerCase() === user.username.toLowerCase(); })[0];
    if (row) photoSheet_(false).deleteRow(row.row);
    const ver = bumpPhotos_();
    log_(user.username, 'PHOTO', '', 'profile photo removed');
    return { ver: ver };
  });
}

/** The big photo of anyone (signed-in portal users only). */
function getPhoto(session, username) {
  requireSession_(session);
  return photoOf_(username || '', true);
}

/* ---------------- called by connected apps (doPost) ---------------- */

function appPhotos_(data) {
  const ver = photosVer_();
  if (data && data.ver && String(data.ver) === ver) return { ver: ver, same: true };
  return { ver: ver, list: photoList_() };
}

function appPhoto_(data) {
  return { p: photoOf_(data && data.u, true) };
}

/* ---------------- apps on the v2 login (no call back to the hub) ---------------- */

/** "Portal Photos <APP ID>" in each v2 app's sheet: written only when the photos change. */
const PHOTO_TAB_HEAD = ['Username', 'Name', 'Other names', 'Thumb', 'Photo'];
function photoTabName_(app) { return 'Portal Photos ' + app.id; }

function syncPhotoTabs_() {
  const ver = photosVer_();
  directApps_().filter(function (a) { return a.active; }).forEach(function (app) {
    const key = 'PHOTO_TAB_' + app.id;
    if (prop_(key) === ver) return;
    try {
      writePhotoTab_(app, ver);
      props_().setProperty(key, ver); if (PROPS_) PROPS_[key] = ver;
    } catch (e) { console.error('photo tab ' + app.id + ': ' + e); }   // tried again next minute
  });
}

function writePhotoTab_(app, ver) {
  const big = {};
  photoRows_().forEach(function (x) { big[x.u.toLowerCase()] = x.p || x.t; });
  const rows = photoList_().map(function (p) { return [p.u, p.n, (p.a || []).join('|'), p.t, big[p.u.toLowerCase()] || p.t]; });
  const ss = SpreadsheetApp.openById(app.sheetId);
  const name = photoTabName_(app), W = PHOTO_TAB_HEAD.length;
  let sh = ss.getSheetByName(name);
  const fresh = !sh;
  if (fresh) sh = ss.insertSheet(name);
  const old = Math.max(sh.getLastRow() - 1, 0);
  const grid = [PHOTO_TAB_HEAD.slice()].concat(rows);
  while (grid.length < old + 1) grid.push(new Array(W).fill(''));      // people who removed their photo
  if (sh.getMaxRows() < grid.length) sh.insertRowsAfter(sh.getMaxRows(), grid.length - sh.getMaxRows());
  const rng = sh.getRange(1, 1, grid.length, W);
  rng.setNumberFormat('@');
  rng.setValues(grid);
  sh.getRange(1, W + 1).setValue(ver);                                  // F1: version the app compares
  if (fresh) {
    sh.getRange(1, 1, 1, W).setFontWeight('bold').setBackground('#E8EAF6');
    sh.setFrozenRows(1);
    sh.getRange(1, 1).setNote('Profile photos, written by GGM Portal. Do not edit: changed in the portal account menu.');
    try { sh.hideSheet(); } catch (e) {}
  }
  if (!sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).length) {
    const pr = sh.protect().setDescription('Written by GGM Portal');
    pr.addEditor(Session.getEffectiveUser());
    pr.removeEditors(pr.getEditors());
    if (pr.canDomainEdit()) pr.setDomainEdit(false);
  }
}
