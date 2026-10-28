// ============================================================
//  GGM ASSETS — HOW GGM PORTAL TALKS TO THIS APP
//  The shared connector is Portal.js (same file in every app).
//
//  Assets never had a user list: people signed in with a shared
//  site name + password. Now every server call carries a session
//  token, and the session says who the person is and which site
//  they belong to (SITE) or that they see everything (BOSS).
//    - Not connected yet (no PORTAL_SECRET): the old site login
//      still works, and it also gets a session.
//    - Connected: people sign in as themselves; role and site come
//      from the Access grid in GGM Portal.
// ============================================================

function portalAdapter_() {
  return {
    startSession: portalAssetsStart_,
    provision: function (w) { return w.active ? 'no sheet write needed (site comes from the portal)' : 'signed out'; },
    endSessions: function () { return 0; },   // cache sessions end through Portal.js (revoke list / epoch)
    counts: portalAssetsCounts_,
    meta: function () {
      return { roles: ['SITE', 'BOSS'], sites: LOCATION_BLOCKS.map(function (b) { return b.name; }), siteRoles: ['SITE'] };
    },
    listUsers: function () { return []; }      // the old logins are sites, not people
  };
}

/** Requests from GGM Portal (this app had no doPost before). */
function doPost(e) {
  return portalHandlePost_(e) || ContentService.createTextOutput('Not found');
}

function portalAssetsStart_(c, src) {
  var boss = String(c.r || '').toUpperCase() === 'BOSS';
  var site = String(c.s || '').toUpperCase().trim();
  if (!boss && !LOCATION_BLOCKS.some(function (b) { return b.name === site; })) {
    throw new Error('No Assets site is set for you in GGM Portal. Ask the IT admin.');
  }
  var token = portalNewSession_(c, src);
  return { token: token, site: boss ? 'BOSS' : site, username: c.u, name: c.n };
}

/** Who is calling, from their session. Throws SESSION_EXPIRED when there is none. */
function assetsSession_(token) {
  var rec = portalCheck_(token);
  var site = String(rec.s || '').toUpperCase().trim();
  var boss = String(rec.r || '').toUpperCase() === 'BOSS' || ['BOSS', 'ADMIN', 'MAIN'].indexOf(site) > -1;
  return {
    boss: boss,
    site: boss ? 'BOSS' : site,
    who: rec.src === 'legacy' ? site + ' (Web UI)' : (rec.u || site)   // written in the forms' column B
  };
}

/** Badge: assets on the way to this person's site (BOSS: everything in transit). */
function portalAssetsCounts_(list) {
  var all = getGlobalAssetStatus_();
  var out = {};
  list.forEach(function (x) {
    var boss = String(x.r || '').toUpperCase() === 'BOSS';
    var site = String(x.s || '').toUpperCase().trim();
    var n = 0;
    for (var name in all) {
      var a = all[name];
      if (a.status !== 'IN_TRANSIT') continue;
      if (boss || String(a.dest || '').toUpperCase().trim() === site) n++;
    }
    out[x.u] = n;
  });
  return out;
}
