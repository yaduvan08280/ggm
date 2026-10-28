/**********************************************************************
 * File: 13_Portal.gs  —  How GGM Portal talks to Indent Flow
 *
 *  The shared connector is Portal.gs (the same file in every app). This
 *  file only says what "start a session", "create a user" and "count what
 *  is waiting" mean here. Until the Script Property PORTAL_SECRET is set,
 *  none of it runs and Indent Flow keeps its own User ID + PIN login.
 *
 *  Portal sessions use the normal Sessions tab; their token starts with
 *  "P-" (opened from the portal) or "D-" (own link, password checked by
 *  the portal), so the Portal-only switch can end the "D-" ones.
 *********************************************************************/

function portalAdapter_() {
  return {
    startSession: portalIndentStart_,
    provision: portalIndentProvision_,
    endSessions: portalIndentEndSessions_,
    counts: portalIndentCounts_,
    meta: function () {
      return { roles: ROLES.slice(), sites: siteList_(), siteRoles: SITE_BOUND_ROLES.slice() };
    },
    listUsers: function () {
      return readAll_(SH.USERS).map(function (u) {
        return { localId: safeStr_(u.User_ID), name: safeStr_(u.Name), phone: safeStr_(u.Phone),
                 email: safeStr_(u.Email), role: safeStr_(u.Role), site: safeStr_(u.Site) };
      });
    }
  };
}

/** A launch pass (or a portal-checked password) → a normal Indent Flow session. */
function portalIndentStart_(c, src) {
  var id = safeStr_(c.lu).toUpperCase();
  if (!id) throw new Error('GGM Portal did not say which Indent Flow user this is.');

  // Keep name / role / site in step with the portal even before the next sync.
  if (c.r) {
    portalIndentProvision_({ username: c.u, name: c.n, phone: c.p, email: c.e,
                             localId: id, role: c.r, site: c.s, active: true });
  }
  var u = findBy_(SH.USERS, 'User_ID', id);
  if (!u) throw new Error('Your Indent Flow account is not set up yet. Ask the IT admin to give you a role in GGM Portal.');
  if (!truthy_(u.Active)) throw new Error('Your Indent Flow account is switched off. Contact the IT admin.');

  var token = (src === 'portal' ? 'P-' : 'D-') + uuid_();
  var created = now_();
  var expires = addHours_(created, APP.SESSION_HOURS);
  insert_(SH.SESSIONS, { Token: token, User_ID: u.User_ID, Role: u.Role, Created_At: created, Expires_At: expires });
  try {
    CacheService.getScriptCache().put('s_' + token, JSON.stringify({ u: u.User_ID, r: u.Role }), 21600);
  } catch (e) { /* cache is an optimisation only */ }
  // SPEED: a new session is not data, so it does not bump the data version (a bump makes
  // every open Indent screen reload). Expired sessions are cleared by the background trigger.
  return { token: token, user: publicUser_(u), stages: stagesOut_(), expires: iso_(expires) };
}

/** Create / update / switch off one user, using Indent Flow's own rules. */
function portalIndentProvision_(w) {
  var id = safeStr_(w.localId).toUpperCase();
  if (!id) throw new Error('No Indent Flow user id.');
  var existing = findBy_(SH.USERS, 'User_ID', id);

  if (!w.active) {
    if (existing && truthy_(existing.Active)) { update_(SH.USERS, existing.__row, { Active: 'FALSE' }); return 'switched off'; }
    return existing ? 'already off' : 'not in Indent Flow';
  }

  var role = safeStr_(w.role).toUpperCase();
  if (ROLES.indexOf(role) === -1) throw new Error('Unknown Indent Flow role: ' + (w.role || '(blank)'));
  var patch = {
    Name: safeStr_(w.name) || id,
    Role: role,
    Site: normaliseUserSite_(role, w.site),   // throws for a site that is not one of the four
    Active: 'TRUE'
  };
  // Phone / Email only when the portal has one: a blank must not wipe what Indent uses for reminders.
  if (safeStr_(w.phone)) patch.Phone = safeStr_(w.phone);
  if (safeStr_(w.email)) patch.Email = safeStr_(w.email);

  if (existing) {
    var same = Object.keys(patch).every(function (k) {
      return k === 'Active' ? truthy_(existing.Active) : safeStr_(existing[k]) === safeStr_(patch[k]);
    });
    if (same) return 'already up to date';
    update_(SH.USERS, existing.__row, patch);   // Telegram and Language columns are left as they are
    return 'updated';
  }
  patch.User_ID = id;
  patch.PIN_Hash = hashPin_(id, Utilities.getUuid());   // nobody knows it: the portal password is used instead
  patch.Created_At = now_();
  insert_(SH.USERS, patch);
  return 'created';
}

/** { user: wanted } → that user's sessions · { direct: true } → every session not opened from the portal. */
function portalIndentEndSessions_(opts) {
  var id = opts && opts.user ? safeStr_(opts.user.localId).toUpperCase() : '';
  var dead = readAll_(SH.SESSIONS).filter(function (s) {
    if (opts && opts.direct) return String(s.Token).indexOf('P-') !== 0;
    return id && String(s.User_ID).toUpperCase() === id;
  });
  var cache = CacheService.getScriptCache();
  dead.sort(function (a, b) { return b.__row - a.__row; }).forEach(function (s) {
    try { cache.remove('s_' + s.Token); } catch (e) {}
    try { deleteRow_(SH.SESSIONS, s.__row); } catch (e) {}
  });
  bumpIfDirty_();
  return dead.length;
}

/** Badge: indents waiting on this person, + incoming transfers (store), + item-list requests (admin). */
function portalIndentCounts_(list) {
  var indents = readAll_(SH.INDENTS);
  var pendingItemReq = null;
  var out = {};
  list.forEach(function (x) {
    var actor = findBy_(SH.USERS, 'User_ID', safeStr_(x.lu).toUpperCase());
    if (!actor || !truthy_(actor.Active)) { out[x.u] = 0; return; }
    var n = 0;
    indents.forEach(function (r) { if (waitingOn_(actor, r)) n++; });   // admin: step 4 only
    var role = String(actor.Role).toUpperCase();
    if (role === 'STORE') { try { n += incomingTransferCount_(actor) || 0; } catch (e) {} }
    if (role === 'ADMIN') {
      if (pendingItemReq === null) {
        pendingItemReq = readWhere_(SH.ITEM_REQ, function (r) { return String(r.Status) === 'PENDING'; }).length;
      }
      n += pendingItemReq;
    }
    out[x.u] = n;
  });
  return out;
}
