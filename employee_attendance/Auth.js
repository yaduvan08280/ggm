/* ---------------- settings ---------------- */

function getSiteSetting_(site) {
  var s = settingsAll_()[site] || {};
  return {
    site: site,
    closingTime: s.closingTime || DEFAULT_CLOSING_TIME,
    refreshSeconds: s.refreshSeconds || DEFAULT_REFRESH_SEC,
    lockLogin: s.row ? s.lockLogin : DEFAULT_LOCK_LOGIN,
    allowResubmit: s.row ? s.allowResubmit : DEFAULT_ALLOW_RESUBMIT,
    fdHours: s.fdHours || DEFAULT_FD_HOURS,
    hdHours: s.hdHours || DEFAULT_HD_HOURS,
    autoAbsent: s.row ? s.autoAbsent !== false : true
  };
}

/** Sheets sometimes coerces "15:00" into a Date — handle both. */
function normalizeTime_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'HH:mm');
  var s = String(v == null ? '' : v).trim();
  var m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return '';
  return ('0' + m[1]).slice(-2) + ':' + m[2];
}

function isSubmissionWindowOpen_(site) {
  var cfg = getSiteSetting_(site);
  var parts = cfg.closingTime.split(':');
  var nowStr = Utilities.formatDate(new Date(), TZ, 'HH:mm');
  var nowMin = Number(nowStr.split(':')[0]) * 60 + Number(nowStr.split(':')[1]);
  var closeMin = Number(parts[0]) * 60 + Number(parts[1]);
  return {
    open: nowMin < closeMin,
    closingTime: cfg.closingTime,
    minutesLeft: Math.max(0, closeMin - nowMin),
    lockLogin: cfg.lockLogin,
    allowResubmit: cfg.allowResubmit,
    refreshSeconds: cfg.refreshSeconds
  };
}

/* ---------------- users ---------------- */

function normRole_(r) {
  var s = String(r || '').trim().toLowerCase();
  return s === 'supervisor' ? 'Supervisor' : s === 'hr' ? 'HR' : s === 'admin' ? 'Admin' : s === 'accounts' ? 'Accounts' : '';
}

/** Portal username / phone + password. Returns { ok, token, role, name, site, scope, ... } */
function login(username, password) {
  try {
    var p = portalPerson_(ggmLogin(username, password).token);
    if (!p) return { ok: false, error: 'Username or password is wrong.' };
    return portalEnter_(p);
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

/** Sign in and get the first screen in the same round trip. */
function loginAndLoad(username, password) {
  var s = login(username, password);
  if (!s.ok) return s;
  var u = requireSession_(s.token);
  return { ok: true, session: s, cfg: clientConfig_(u), first: firstScreen_(u) };
}

/** GGM Portal person → session, with the Role and Site from the portal's Access grid. */
function portalEnter_(p) {
  var role = normRole_(p.role);
  if (!role) return { ok: false, error: 'No Attendance role is set for you in GGM Portal. Ask the IT admin to pick one in the Access tab.' };
  return openSession_({ username: p.username, role: role, site: p.site || 'ALL', name: p.name || p.username },
                      { pu: p.username.toLowerCase(), pv: String(p.hash).slice(0, 12) });
}

/** The portal row behind a GGM Portal token (GgmLogin.gs), or null. */
function portalPerson_(ggmToken) {
  try {
    var u = ggmUser_(ggmToken);
    return u && u.hash ? u : null;
  } catch (e) { return null; }
}

/** Called by the page when it was opened from a portal tile (or with a portal token). */
function portalSignIn(ggmToken) {
  try {
    var p = portalPerson_(ggmToken);
    if (!p) return { ok: false, error: 'Your GGM Portal sign-in has ended. Open Attendance from the portal again.' };
    return portalEnter_(p);
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

/** Supervisor rules, then a session in the script cache. */
function openSession_(ident, portal) {
  if (ident.role === 'Supervisor') {
    if (!ident.site || ident.site === 'ALL' || SITES.indexOf(ident.site) === -1) {
      return { ok: false, error: 'No site is set for you in GGM Portal. Ask the IT admin to pick one in the Access tab.' };
    }
    var gate = isSubmissionWindowOpen_(ident.site);
    if (!gate.open && gate.lockLogin) {
      return { ok: false, error: 'Attendance for ' + ident.site + ' closed at ' + gate.closingTime + '. Sign-in reopens tomorrow morning.' };
    }
  }
  var token = Utilities.getUuid();
  var payload = { username: ident.username, role: ident.role, site: ident.site, name: ident.name, ts: Date.now(), pu: portal.pu, pv: portal.pv };
  CacheService.getScriptCache().put(SESSION_CACHE_PREFIX + token, JSON.stringify(payload), SESSION_TTL_SECONDS);

  logAudit_({ action: 'LOGIN_PORTAL', byUser: ident.username, byRole: ident.role, site: ident.site });
  return sessionInfo_(token, payload);
}

function sessionInfo_(token, u) {
  return {
    ok: true, token: token, role: u.role, name: u.name, site: u.site, username: u.username,
    scope: scopeSites_(u),
    serverTime: Utilities.formatDate(new Date(), TZ, 'HH:mm'),
    serverDate: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd')
  };
}

/** Which sites this user may see. Supervisors: one. HR/Admin: their site, or all. */
function scopeSites_(user) {
  if (user.role === 'Supervisor') return [user.site];
  if (!user.site || user.site === 'ALL' || SITES.indexOf(user.site) === -1) return SITES.slice();
  return [user.site];
}

function requireSession_(token) {
  if (MEMO_['sess_' + token]) return MEMO_['sess_' + token];
  var cache = CacheService.getScriptCache();
  var raw = cache.get(SESSION_CACHE_PREFIX + token);
  if (!raw) throw new Error('SESSION_EXPIRED');
  var u = JSON.parse(raw), dirty = false;

  // A sign-in from before the old Users tab was retired (no portal person behind it) has ended.
  if (!u.pu) { cache.remove(SESSION_CACHE_PREFIX + token); throw new Error('SESSION_EXPIRED'); }

  // A sign-in follows the portal: unticked or password changed → out within a minute,
  // and a changed Role / Site applies at the next check.
  if (!cache.get('ATT_PCHK_' + token)) {
    var fresh = portalRecheck_(u);
    if (!fresh) { cache.remove(SESSION_CACHE_PREFIX + token); throw new Error('SESSION_EXPIRED'); }
    if (JSON.stringify(fresh) !== JSON.stringify(u)) { u = fresh; dirty = true; }
    cache.put('ATT_PCHK_' + token, '1', 60);
  }
  // sliding expiry — an active user shouldn't get kicked out mid-shift (refreshed every 10 minutes)
  if (dirty || !u.ts || Date.now() - u.ts > 600000) {
    u.ts = Date.now();
    cache.put(SESSION_CACHE_PREFIX + token, JSON.stringify(u), SESSION_TTL_SECONDS);
  }
  return (MEMO_['sess_' + token] = u);
}

/** The session again with today's portal row, or null when the person is no longer allowed in. */
function portalRecheck_(u) {
  var row;
  try { row = ggmRows_()[u.pu]; } catch (e) { return null; }
  if (!row || !row.hash || row.hash.slice(0, 12) !== u.pv) return null;
  var role = normRole_(row.role);
  if (!role) return null;
  var next = JSON.parse(JSON.stringify(u));
  next.role = role; next.site = row.site || 'ALL'; next.name = row.name || row.username;
  return next;
}

function requireRole_(token, roles) {
  var user = requireSession_(token);
  if (roles.indexOf(user.role) === -1) throw new Error('Not authorised for this action.');
  return user;
}

/** Site guard: stops an HR user scoped to one site from reading another. */
function resolveSite_(user, requestedSite) {
  var allowed = scopeSites_(user);
  if (!requestedSite || requestedSite === 'ALL') {
    return allowed.length === 1 ? [allowed[0]] : allowed;
  }
  if (allowed.indexOf(requestedSite) === -1) throw new Error('You do not have access to ' + requestedSite + '.');
  return [requestedSite];
}

/** Lets the client restore a session after a phone lock / page reload. */
function resumeSession(token) {
  try {
    return sessionInfo_(token, requireSession_(token));
  } catch (err) {
    return { ok: false };
  }
}

/**
 * Everything the page needs to open, in ONE round trip: the session, the site
 * rules and the first screen's data.
 */
function bootstrap(token) {
  var s = resumeSession(token);
  if (!s.ok) return { ok: false };
  var u = requireSession_(token);
  return { ok: true, session: s, cfg: clientConfig_(u), first: firstScreen_(u) };
}

/** The data of the screen a role lands on. */
function firstScreen_(u) {
  try {
    if (u.role === 'Supervisor') return { view: 'mark', mark: supervisorData_(u) };
    if (u.role === 'HR') return { view: 'today', today: todayData_(u) };
    if (u.role === 'Accounts') return { view: 'salary' };   // salary and advances only (17 Nov 2026)
    return { view: 'overview', today: todayData_(u), overview: overviewData_(u) };
  } catch (e) {
    return { error: String(e.message || e) };
  }
}

function logout(token) {
  try {
    var u = requireSession_(token);
    logAudit_({ action: 'LOGOUT', byUser: u.username, byRole: u.role, site: u.site });
  } catch (e) {}
  CacheService.getScriptCache().remove(SESSION_CACHE_PREFIX + token);
  return { ok: true };
}

/** Client asks once at login and again after any settings change. */
function getClientConfig(token) {
  return clientConfig_(requireSession_(token));
}

function clientConfig_(u) {
  var sites = scopeSites_(u);
  var refresh = null;
  sites.forEach(function (s) {
    var r = getSiteSetting_(s).refreshSeconds;
    refresh = refresh === null ? r : Math.min(refresh, r);
  });
  return {
    refreshSeconds: Math.max(10, refresh || DEFAULT_REFRESH_SEC),
    scope: sites,
    allSites: SITES.slice(),
    serverDate: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'),
    serverTime: Utilities.formatDate(new Date(), TZ, 'HH:mm')
  };
}
