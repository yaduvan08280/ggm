/*******************************************************
 * Photos.gs — a photo for every employee.
 *
 * Kept in the hidden tab "Employee Photos" of this spreadsheet (no Drive
 * permission needed): A Employee ID · B Thumb · C Photo · D Updated · E By.
 * The phone shrinks every picture before it is sent (any size can be picked):
 * the photo is ~480 px, enough to recognise a face, and fits one cell; the
 * thumb is a 120 px square for lists. Lists load only the thumbs they show,
 * and the phone keeps them, so a photo is downloaded once.
 *******************************************************/

var SHEET_PHOTOS = 'Employee Photos';
var PHOTO_MAX_CHARS = 48000;   // a cell holds 50,000 characters
var THUMB_MAX_CHARS = 12000;

function photoSheet_() {
  var ss = ss_();
  var sh = ss.getSheetByName(SHEET_PHOTOS);
  if (!sh) {
    sh = ss.insertSheet(SHEET_PHOTOS);
    sh.getRange(1, 1, 1, 5).setValues([['Employee ID', 'Thumb', 'Photo', 'Updated', 'By']]);
    sh.hideSheet();
  }
  return sh;
}

/** { employeeId: version } for everyone who has a photo. Small, cached. */
function photoIndex_() {
  var hit = cacheGetJson_('ATT_PHIDX');
  if (hit) return hit;
  var sh = photoSheet_(), out = {}, n = sh.getLastRow() - 1;
  if (n > 0) {
    var ids = sh.getRange(2, 1, n, 1).getValues(), when = sh.getRange(2, 4, n, 1).getValues();
    ids.forEach(function (r, i) {
      var id = String(r[0] == null ? '' : r[0]).trim();
      if (id) out[id] = when[i][0] instanceof Date ? when[i][0].getTime() : 1;
    });
  }
  cachePutJson_('ATT_PHIDX', out, 21600);
  return out;
}

function getPhotoIndex(token) {
  requireSession_(token);
  return photoIndex_();
}

/** Thumbs for the people on screen (up to 200 at a time). */
function getPhotoThumbs(token, ids) {
  requireSession_(token);
  ids = (ids || []).slice(0, 200).map(function (x) { return String(x).trim(); });
  var c = CacheService.getScriptCache(), out = {}, miss = [];
  var got = c.getAll(ids.map(function (id) { return 'ATT_PT_' + id; }));
  ids.forEach(function (id) { var v = got['ATT_PT_' + id]; if (v != null) out[id] = v; else miss.push(id); });
  if (miss.length) {
    var sh = photoSheet_(), n = sh.getLastRow() - 1, put = {};
    if (n > 0) {
      sh.getRange(2, 1, n, 2).getValues().forEach(function (r) {
        var id = String(r[0] == null ? '' : r[0]).trim();
        if (!id || !r[1]) return;
        put['ATT_PT_' + id] = String(r[1]);
        if (miss.indexOf(id) > -1) out[id] = String(r[1]);
      });
      try { c.putAll(put, 21600); } catch (e) {}
    }
  }
  return out;
}

/** The sharp photo, when someone taps a face. */
function getEmployeePhoto(token, employeeId) {
  requireSession_(token);
  var row = photoRow_(employeeId);
  if (!row) return '';
  var v = photoSheet_().getRange(row, 2, 1, 2).getValues()[0];
  return String(v[1] || v[0] || '');
}

function photoRow_(employeeId) {
  var sh = photoSheet_(), n = sh.getLastRow() - 1, id = String(employeeId).trim();
  if (n < 1) return 0;
  var ids = sh.getRange(2, 1, n, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]).trim() === id) return i + 2;
  return 0;
}

/**
 * Adds or replaces one employee's photo. HR / Admin: anyone in their sites.
 * Supervisor: anyone at their own site.
 */
function setEmployeePhoto(token, site, employeeId, thumb, photo) {
  var user = requireSession_(token);
  var sites = resolveSite_(user, site);
  if (sites.length !== 1) return { ok: false, error: 'Pick a single site first.' };
  var id = String(employeeId).trim();
  if (!employeesAll_().some(function (e) { return e.id === id && e.site === sites[0]; })) {
    return { ok: false, error: 'Employee ' + id + ' is not on the ' + sites[0] + ' list.' };
  }
  var jpeg = /^data:image\/(jpeg|webp|png);base64,[A-Za-z0-9+\/=]+$/;
  if (!jpeg.test(String(thumb)) || !jpeg.test(String(photo))) return { ok: false, error: 'That is not a picture.' };
  if (String(photo).length > PHOTO_MAX_CHARS || String(thumb).length > THUMB_MAX_CHARS) return { ok: false, error: 'The picture is still too big. Try again.' };

  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) { return { ok: false, error: 'Server busy, try again.' }; }
  try {
    var sh = photoSheet_(), row = photoRow_(id) || sh.getLastRow() + 1, now = new Date();
    sh.getRange(row, 1, 1, 5).setValues([[id, thumb, photo, now, user.username]]);
    SpreadsheetApp.flush();
    var idx = photoIndex_();
    idx[id] = now.getTime();
    cachePutJson_('ATT_PHIDX', idx, 21600);
    try { CacheService.getScriptCache().put('ATT_PT_' + id, String(thumb), 21600); } catch (e) {}
    logAudit_({ site: sites[0], employeeId: id, action: 'PHOTO', value: 'photo saved', byUser: user.username, byRole: user.role });
    return { ok: true, ver: now.getTime() };
  } finally {
    lock.releaseLock();
  }
}
