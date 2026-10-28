/**********************************************************************
 * File: 03_Auth.gs  —  PIN login, sessions, role guards, user admin
 *********************************************************************/

function login_(userId, pin) {
  // Connected to GGM Portal: the portal username/phone + password are tried first (checked by the hub).
  // While Portal-only is OFF the old User ID + PIN keeps working too, so nobody is locked out of their link.
  var portalErr = null;
  if (portalEnabled_()) {
    try { return portalRemoteLogin_(userId, pin); }
    catch (e) { if (portalOnly_()) throw e; portalErr = e; }
  }
  try { return pinLogin_(userId, pin); }
  catch (e) {
    if (portalErr && /Invalid User ID|required/.test(String(e.message))) throw new Error('Username / User ID or password / PIN is wrong.');
    throw e;
  }
}

/** The app's own login: User ID + PIN from the Users tab. */
function pinLogin_(userId, pin) {
  userId = safeStr_(userId).toUpperCase();
  pin    = safeStr_(pin);
  if (!userId || !pin) throw new Error('User ID and PIN are both required.');

  var u = null;
  var users = readAll_(SH.USERS);
  for (var i = 0; i < users.length; i++) {
    if (String(users[i].User_ID).toUpperCase() === userId) { u = users[i]; break; }
  }
  if (!u) throw new Error('Invalid User ID or PIN.');
  if (!truthy_(u.Active)) throw new Error('This account is deactivated. Contact the administrator.');
  if (String(u.PIN_Hash) !== hashPin_(u.User_ID, pin)) throw new Error('Invalid User ID or PIN.');

  var token   = uuid_();
  var created = now_();
  var expires = addHours_(created, APP.SESSION_HOURS);

  insert_(SH.SESSIONS, {
    Token: token, User_ID: u.User_ID, Role: u.Role,
    Created_At: created, Expires_At: expires
  });
  try {
    CacheService.getScriptCache().put('s_' + token,
      JSON.stringify({ u: u.User_ID, r: u.Role }), 21600);
  } catch (e) { /* cache is an optimisation only */ }

  return {
    token   : token,
    user    : publicUser_(u),
    stages  : stagesOut_(),
    expires : iso_(expires)
  };
}

function publicUser_(u) {
  return {
    id    : u.User_ID,
    name  : u.Name,
    role  : u.Role,
    site  : u.Site,
    plant : u.Site,                    // kept so an older browser tab keeps working
    sections: sectionsFor_(u.Site),
    email : u.Email,
    phone : u.Phone,
    lang  : langOf_(u)
  };
}

/** Resolve a token to a full user row, or throw. */
function requireAuth_(token) {
  token = safeStr_(token);
  if (!token) throw new Error('Not signed in.');
  // Portal-only: only sessions opened from GGM Portal ("P-") are accepted. While it is OFF,
  // portal ("P-"), own-link portal ("D-") and old PIN sessions all work.
  if (portalOnly_() && token.indexOf('P-') !== 0) throw new Error('Session expired. Please sign in again.');

  var userId = null;
  try {
    var c = CacheService.getScriptCache().get('s_' + token);
    if (c) userId = JSON.parse(c).u;
  } catch (e) {}

  if (!userId) {
    var s = findBy_(SH.SESSIONS, 'Token', token);
    if (!s) throw new Error('Session expired. Please sign in again.');
    var exp = toDate_(s.Expires_At);
    if (exp && exp.getTime() < Date.now()) throw new Error('Session expired. Please sign in again.');
    userId = s.User_ID;
  }

  var u = findBy_(SH.USERS, 'User_ID', userId);
  if (!u) throw new Error('Session expired. Please sign in again.');
  if (!truthy_(u.Active)) throw new Error('This account is deactivated.');
  return u;
}

/** May this person work the given step? The administrator always may; everyone
 *  else by the roles set for that step under Settings (stageRoles_). */
function requireStageRole_(token, stageKey) {
  var u = requireAuth_(token);
  var role = String(u.Role).toUpperCase();
  if (role === 'ADMIN') return u;
  var st = stageByKey_(stageKey);
  if (!roleOwnsStage_(role, st)) {
    throw new Error('Your role (' + u.Role + ') does not work the "' + (st ? st.name : stageKey) +
                    '" step. The administrator can change who works each step under Settings.');
  }
  return u;
}

function requireRole_(token, roles) {
  var u = requireAuth_(token);
  if (roles && roles.length && roles.indexOf(String(u.Role).toUpperCase()) === -1) {
    throw new Error('Your role (' + u.Role + ') is not allowed to do this.');
  }
  return u;
}

function logout_(token) {
  try { CacheService.getScriptCache().remove('s_' + token); } catch (e) {}
  var s = findBy_(SH.SESSIONS, 'Token', token);
  if (s) deleteRow_(SH.SESSIONS, s.__row);
  return true;
}

/** Expired sign-ins are cleared by the 5-minute background trigger, at most
 *  once an hour and under the lock. It used to happen inside sign-in itself:
 *  slow for whoever signed in, and two sign-ins purging at the same moment
 *  deleted by stale row numbers, i.e. somebody else's live session. */
function purgeSessionsHourly_() {
  try {
    var c = CacheService.getScriptCache();
    if (c.get('session_purge')) return 0;
    c.put('session_purge', '1', 3600);
    return withLock_(function () { memoClear_(SH.SESSIONS); return purgeExpiredSessions_(); });
  } catch (e) { return 0; }
}

function purgeExpiredSessions_() {
  var rows = readAll_(SH.SESSIONS);
  var nowMs = Date.now();
  var dead = rows.filter(function (r) {
    var e = toDate_(r.Expires_At);
    return e && e.getTime() < nowMs;
  });
  // delete bottom-up so row numbers stay valid
  dead.sort(function (a, b) { return b.__row - a.__row; })
      .forEach(function (r) { try { deleteRow_(SH.SESSIONS, r.__row); } catch (e) {} });
  return dead.length;
}

function changePin_(token, oldPin, newPin) {
  var u = requireAuth_(token);
  if (portalOnly_()) throw new Error('Your password is managed in GGM Portal: account menu → Change password.');
  if (String(u.PIN_Hash) !== hashPin_(u.User_ID, oldPin)) throw new Error('Current PIN is incorrect.');
  if (safeStr_(newPin).length < 4) throw new Error('New PIN must be at least 4 characters.');
  update_(SH.USERS, u.__row, { PIN_Hash: hashPin_(u.User_ID, newPin) });
  return true;
}

/* ----------------------- Admin user management -------------------- */

function listUsers_(token) {
  requireRole_(token, ['ADMIN']);
  return readAll_(SH.USERS).map(function (u) {
    return {
      id: u.User_ID, name: u.Name, role: u.Role, site: u.Site, plant: u.Site,
      phone: u.Phone, email: u.Email, active: truthy_(u.Active),
      lang: langOf_(u), created: iso_(u.Created_At)
    };
  });
}

function saveUser_(token, p) {
  requireRole_(token, ['ADMIN']);
  if (portalOnly_()) throw new Error('Users are managed in GGM Portal (master sheet → Users and Access).');
  var id = safeStr_(p.id).toUpperCase();
  if (!id) throw new Error('User ID is required.');
  if (ROLES.indexOf(safeStr_(p.role).toUpperCase()) === -1) throw new Error('Unknown role: ' + p.role);

  var existing = findBy_(SH.USERS, 'User_ID', id);
  var patch = {
    Name          : safeStr_(p.name) || id,
    Role          : safeStr_(p.role).toUpperCase(),
    Site          : normaliseUserSite_(p.role, p.site !== undefined ? p.site : p.plant),
    Phone         : safeStr_(p.phone),
    Email         : safeStr_(p.email),
    Active        : p.active === false ? 'FALSE' : 'TRUE'
  };
  if (safeStr_(p.lang) && isLang_(p.lang)) patch.Language = String(p.lang).toUpperCase();

  if (existing) {
    if (safeStr_(p.pin)) patch.PIN_Hash = hashPin_(id, p.pin);
    update_(SH.USERS, existing.__row, patch);
    return { id: id, created: false };
  }
  patch.User_ID    = id;
  patch.PIN_Hash   = hashPin_(id, safeStr_(p.pin) || '1234');
  patch.Created_At = now_();
  insert_(SH.USERS, patch);
  return { id: id, created: true };
}

/** What goes in the Site column for a given role.
 *  Site-bound roles (user, store) must name one of the four sites, or be
 *  left blank so the administrator is prompted to set it. Everybody else
 *  works across all four and is stored as ALL. */
function normaliseUserSite_(role, wanted) {
  var r = String(role || '').toUpperCase();
  var w = String(wanted || '').toUpperCase().trim();
  if (!roleNeedsSite_(r)) return SITE_ALL;
  if (!w || w === SITE_ALL) return '';
  if (!isSite_(w)) {
    throw new Error('"' + wanted + '" is not one of the four sites (' + SITES.join(', ') + ').');
  }
  return w;
}
