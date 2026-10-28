/**********************************************************************
 * File: 10_Sites.gs  —  Sites and sections
 *
 *  A SITE is one of the four operations: TONK, NEWAI, SANWARIYA,
 *  KHAKHUNDA. It owns its own stock, its own item list and its own
 *  store team.
 *
 *  A SECTION is a part of a site — the washing plant, the colour
 *  sorter, and so on. It is optional: an indent with no section
 *  belongs to the site itself ("site main"), which is the common case.
 *
 *  A shop-floor user and a storekeeper each belong to exactly one site
 *  and cannot change it. Admin, purchase and the coordinator work
 *  across all four.
 *********************************************************************/

var SITE_ALL = 'ALL';

/** Active site names, in the order they are declared. */
function siteList_() {
  var rows = readAll_(SH.SITES);
  if (!rows.length) return SITES.slice();          // before the installer has run
  var live = {};
  rows.forEach(function (r) {
    if (truthy_(r.Active)) live[String(r.Site_Name).toUpperCase().trim()] = true;
  });
  return SITES.filter(function (s) { return live[s]; });
}

/** Sections declared for a site, in sheet order. */
function sectionsFor_(site) {
  var s = String(site || '').toUpperCase().trim();
  if (!s || s === SITE_ALL) return [];
  return readAll_(SH.SECTIONS)
    .filter(function (r) {
      return truthy_(r.Active) && String(r.Site_Name).toUpperCase().trim() === s;
    })
    .map(function (r) { return String(r.Section_Name).trim(); })
    .filter(function (n) { return !!n; });
}

/** Every site with its sections — what the browser needs to draw the form. */
function siteTree_() {
  return siteList_().map(function (s) {
    return { site: s, sections: sectionsFor_(s) };
  });
}

/** The site an indent by this person belongs to.
 *  Site-bound roles always get their own; the rest may choose. */
function siteForActor_(actor, wanted) {
  var mine = String(actor.Site || '').toUpperCase().trim();

  if (roleNeedsSite_(actor.Role)) {
    if (!mine || mine === SITE_ALL) {
      throw new Error('Your account is not attached to a site yet. Ask the administrator ' +
                      'to set your site in Users before you raise an indent.');
    }
    if (!isSite_(mine)) throw new Error('"' + mine + '" is not one of the four sites.');
    return mine;                       // whatever the browser sent is ignored
  }

  var w = String(wanted || '').toUpperCase().trim();
  if (!w && mine && mine !== SITE_ALL) w = mine;
  if (!w) throw new Error('Choose which site this indent is for.');
  if (!isSite_(w)) throw new Error('"' + w + '" is not one of the four sites.');
  return w;
}

/** Normalise a section against its site. Blank means the site itself. */
function resolveSection_(site, wanted) {
  var w = String(wanted || '').trim();
  if (!w || w.toUpperCase() === 'NONE') return '';
  var list = sectionsFor_(site);
  for (var i = 0; i < list.length; i++) {
    if (list[i].toUpperCase() === w.toUpperCase()) return list[i];
  }
  throw new Error('"' + w + '" is not a section of ' + site + '.');
}

/** "TONK — Washing plant", or just "TONK" when there is no section. */
function siteLabel_(site, section) {
  var s = safeStr_(site);
  var sec = safeStr_(section);
  return sec ? (s + ' — ' + sec) : s;
}

/* ================================================================== */
/*  Admin maintenance                                                  */
/* ================================================================== */

function saveSection_(token, p) {
  requireRole_(token, ['ADMIN']);
  var site = String(p.site || '').toUpperCase().trim();
  if (!isSite_(site)) throw new Error('Choose one of the four sites.');
  var name = safeStr_(p.name);
  if (!name) throw new Error('Section name is required.');

  var existing = null;
  readAll_(SH.SECTIONS).forEach(function (r) {
    if (!existing && String(r.Site_Name).toUpperCase().trim() === site &&
        String(r.Section_Name).toUpperCase().trim() === name.toUpperCase()) existing = r;
  });
  if (existing) {
    update_(SH.SECTIONS, existing.__row, { Active: p.active === false ? 'FALSE' : 'TRUE' });
    return { site: site, name: existing.Section_Name, created: false };
  }
  insert_(SH.SECTIONS, { Site_Name: site, Section_Name: name,
                         Active: p.active === false ? 'FALSE' : 'TRUE' });
  return { site: site, name: name, created: true };
}

function listSections_(token, p) {
  requireAuth_(token);
  var site = String((p && p.site) || '').toUpperCase().trim();
  if (site) return sectionsFor_(site).map(function (n) { return { site: site, name: n }; });
  var out = [];
  siteTree_().forEach(function (s) {
    s.sections.forEach(function (n) { out.push({ site: s.site, name: n }); });
  });
  return out;
}
