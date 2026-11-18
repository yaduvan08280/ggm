/*******************************************************
 * Api.js — everything the page calls (token first; PORTAL.run adds it).
 *******************************************************/

function doGet(e) {
  if (e && e.parameter && e.parameter.bench) return benchOut_();
  if (e && e.parameter && e.parameter.rebuild) {
    if (e.parameter.layout) { FLOW_IDS.forEach(function (fid) { cache_().remove('lay_' + fid + LAY_V); }); MEMO_ = {}; PropertiesService.getScriptProperties().setProperty('BOARD_BUILT', '0'); }
    return rebuildOut_();
  }
  if (e && e.parameter && e.parameter.migrate) return migrateOut_();
  if (e && e.parameter && e.parameter.mergecq) return mergeCqOut_();
  if (e && e.parameter && e.parameter.cycles) return cyclesOut_();
  if (e && e.parameter && e.parameter.cyclesfix) return cyclesFixOut_();
  var gate = ggmGate_(e);
  var t = HtmlService.createTemplateFromFile('Index');
  t.bootJson = 'null';
  if (gate.boot && gate.boot.user) {
    try {
      var u = ggmRows_()[String(gate.boot.user.username).toLowerCase()];
      if (u) t.bootJson = jsonTag_(bootFor_(u));
    } catch (err) {}
  }
  var out = ggmPage_(t.evaluate(), gate);
  return out.setTitle(APP.name)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .addMetaTag('mobile-web-app-capable', 'yes')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(name) { return HtmlService.createHtmlOutputFromFile(name).getContent(); }

/** JSON safe inside a <script> tag. */
function jsonTag_(o) {
  var ls = new RegExp(String.fromCharCode(8232), 'g'), ps = new RegExp(String.fromCharCode(8233), 'g');
  return JSON.stringify(o).replace(/</g, '\\u003c').replace(ls, '\\u2028').replace(ps, '\\u2029');
}

/** ?bench=1 — timings only (no data): how long the board and the dashboards take on the server. */
function benchOut_() {
  var t0 = Date.now(), out = {};
  function lap(k, fn) { var a = Date.now(); var r = fn(); out[k] = Date.now() - a; return r; }
  var admin = null, rows = ggmRows_();
  Object.keys(rows).forEach(function (k) { if (!admin && roleOf_(rows[k]) === 'admin') admin = rows[k]; });
  lap('layouts', function () { return FLOW_IDS.map(layout_); });
  var boot = lap('boot_cached', function () { return admin ? bootFor_(admin) : null; });
  out.boot_kb = boot ? Math.round(JSON.stringify(boot).length / 1024) : 0;
  lap('board_read_sheets', function () { MEMO_ = { ss: MEMO_.ss }; return FLOW_IDS.map(buildBoard_); });
  lap('perf_person', function () { MEMO_ = { ss: MEMO_.ss }; var all = ledger_(isoOf_(Date.now() - 29 * 864e5), isoOf_(Date.now())); return admin ? personView_(all, admin.username.toLowerCase(), isoOf_(Date.now() - 29 * 864e5), isoOf_(Date.now())) : null; });
  lap('perf_team', function () { MEMO_ = { ss: MEMO_.ss }; return teamRows_(ledger_(isoOf_(Date.now() - 29 * 864e5), isoOf_(Date.now()))); });
  lap('detail', function () { var l = boardData_('L2O').leads.filter(function (x) { return x.cur; })[0]; return l && admin ? leadDetail_(admin, 'L2O', l.id) : null; });
  out.total = Date.now() - t0;
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/** ?rebuild=1 — re-read both sheets now (at most once every 3 minutes); answers with counts only. */
function rebuildOut_() {
  var p = PropertiesService.getScriptProperties(), built = Number(p.getProperty('BOARD_BUILT') || 0), ran = false;
  if (Date.now() - built > 3 * 60000) ran = rebuildBoards_();
  var out = { ran: ran, builtMinAgo: Math.round((Date.now() - Number(p.getProperty('BOARD_BUILT') || 0)) / 60000) };
  FLOW_IDS.forEach(function (f) {
    var b = boardData_(f), bad = b.leads.filter(function (l) { return /^#/.test(String(l.id)); }).length;
    out[f] = { leads: b.leads.length, open: b.leads.filter(function (l) { return l.cur; }).length, broken: bad };
  });
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/** Work.js functions handed to the page so both sides compute deadlines the same way. */
function sharedJs_() {
  return [wCal, wDay, wIsWork, wNext, workAdd, workHours, dueState, fmtDur, nameKey, namesMatch, ruleOf]
    .map(function (f) { return f.toString(); }).join('\n') + '\nvar W_H=3600000,W_D=86400000,W_OFF=19800000;';
}

/* ---------------------------------------------------------------- who may do what */

function roleOf_(u) {
  var r = String(u.role || '').toLowerCase();
  if (/lead\s*gen/.test(r)) return 'leadgen';
  if (/order\s*gen/.test(r)) return 'ordergen';
  if (/admin/.test(r)) return 'admin';
  if (/manager|head/.test(r)) return 'manager';
  return 'exec';
}
/**
 * The names a person appears under in the FMS sheets: their portal name and username (no doer name in
 * this app — whoever signs in is who they are), plus any spellings the admin added in Settings → People.
 */
function myNames_(u) {
  var list = [u.name, u.username], extra = aliases_()[String(u.username).toLowerCase()];
  if (extra) list = String(extra).split(',').concat(list);
  return list.map(function (s) { return String(s || '').trim(); }).filter(String);
}

/** Every owner name already used in either sheet (ATT. NAME / SALES PER.). */
function sheetOwners_() {
  if (MEMO_.owners) return MEMO_.owners;
  var m = {};
  FLOW_IDS.forEach(function (fid) {
    try { readFlow_(fid).forEach(function (l) { var n = String(pick_(l.b, FLOWS[fid].owner) || '').trim(); if (n) m[n.toUpperCase()] = (m[n.toUpperCase()] || 0) + 1; }); } catch (e) {}
  });
  return (MEMO_.owners = m);
}

/** The name written into ATT. NAME / SALES PER.: always the person's Master App username (14 Nov 2026). */
function sheetName_(u, fid) {
  return String(u.username);
}
function sheetNameOld_(u, fid) {
  var extra = aliases_()[String(u.username).toLowerCase()];
  if (extra && String(extra).split(',')[0].trim()) return String(extra).split(',')[0].trim().toUpperCase();
  var owners = sheetOwners_(), best = '', n = -1;
  if (fid) {   // prefer a spelling used in this flow's sheet
    var local = {};
    try { readFlow_(fid).forEach(function (l) { var x = String(pick_(l.b, FLOWS[fid].owner) || '').trim().toUpperCase(); if (x) local[x] = (local[x] || 0) + 1; }); } catch (e) {}
    Object.keys(local).forEach(function (k) { if (local[k] > n && [u.name, u.username].some(function (x) { return namesMatch(x, k); })) { best = k; n = local[k]; } });
    if (best) return best;
  }
  Object.keys(owners).forEach(function (k) { if (owners[k] > n && [u.name, u.username].some(function (x) { return namesMatch(x, k); })) { best = k; n = owners[k]; } });
  return best || String(u.name || u.username).toUpperCase();
}
function isOwner_(u, lead) {
  return myNames_(u).some(function (n) { return namesMatch(n, lead.owner); });
}
function canAct_(u, fid, lead, stepKey) {
  var role = roleOf_(u);
  if (role === 'admin' || role === 'manager') return true;
  var c = stepCfg_(fid)[stepKey];
  if (!c) return false;
  var un = String(u.username).toLowerCase();
  if (c.doers.some(function (d) { return String(d).toLowerCase() === un; })) return true;
  return c.ownerActs && isOwner_(u, lead);
}
/** Portal usernames whose names match a sheet name (for credit / blame). */
function usersForName_(name) {
  if (!String(name || '').trim()) return [];
  var rows = ggmRows_(), out = [];
  Object.keys(rows).forEach(function (k) { if (myNames_(rows[k]).some(function (n) { return namesMatch(n, name); })) out.push(rows[k].username); });
  return out;
}
function mustAdmin_(me) { if (roleOf_(me) !== 'admin') throw new Error('Only an Admin can do this.'); }

/* ---------------------------------------------------------------- board */

/** Counts from Events / Notes / Photos per lead, for the tiles. */
function eventAgg_(fid) {
  var key = 'agg_' + fid;
  if (MEMO_[key]) return MEMO_[key];
  var out = {};
  function o(id) { return out[id] || (out[id] = { att: {}, n: 0, p: 0, la: 0, bk: 0, by: {} }); }
  rows_(TABS.EVENTS).forEach(function (r) {
    if (String(r[3]) !== fid) return;
    var x = o(String(r[4])), t = msOf_(r[0]) || 0, a = String(r[6]), st = String(r[5]);
    if (t > x.la) x.la = t;
    if (a === 'FOLLOWUP') x.att[st] = (x.att[st] || 0) + 1;
    if (a === 'BACK') { x.bk++; x.att = {}; }
    if (a === 'DONE') x.by[st] = { u: String(r[1]), n: String(r[2]), t: t };
  });
  partialRows_(TABS.NOTES, 6).forEach(function (r) { if (String(r[3]) === fid) o(String(r[4])).n++; });
  partialRows_(TABS.PHOTOS, 7).forEach(function (r) { if (String(r[3]) === fid) o(String(r[4])).p++; });
  return (MEMO_[key] = out);
}

/** First n columns of a tab (Photos keeps big thumbnails in a later column). */
function partialRows_(t, n) {
  var key = 'prow_' + t.name + n;
  if (MEMO_[key]) return MEMO_[key];
  var sh = tab_(t), last = sh.getLastRow() - 1;
  return (MEMO_[key] = last > 0 ? sh.getRange(2, 1, last, n).getValues() : []);
}

/** One lead as the board has it (row + counters), read fresh. */
function boardLead_(fid, id) {
  var l = freshLead_(fid, id), a = eventAgg_(fid)[id] || {};
  l.att = a.att || {}; l.nN = a.n || 0; l.nP = a.p || 0; l.la = Date.now(); l.bk = a.bk || 0; l.by = a.by || {};
  return l;
}

function publicLayout_(fid) {
  var lay = layout_(fid), scfg = stepCfg_(fid), f = FLOWS[fid];
  return {
    fid: fid, title: f.title, short: f.short, unit: f.unit, parent: f.parent || '', owner: f.owner, titles: f.titles, sub: f.sub, category: f.category,
    material: f.material, qty: f.qty, source: f.source, market: f.market, place: f.place, phone: f.phone,
    url: 'https://docs.google.com/spreadsheets/d/' + (f.ssId || appSs_().getId()) + '/edit#gid=' + lay.gid,
    cal: { open: lay.cal.open, close: lay.cal.close, mask: lay.cal.mask, hol: lay.cal.hol },
    base: lay.base.map(function (b) { return { k: b.k, t: b.t, o: b.o, ro: b.ro }; }),
    fieldRules: fieldRules_(fid),
    steps: lay.steps.map(function (s) {
      return { key: s.key, num: s.num, title: s.title, who: s.who, how: s.how, tat: s.tat, opts: s.opts, statusHead: s.statusHead,
               from: s.from, fields: s.fields.map(function (x) { return { k: x.k, t: x.t, o: x.o, ro: x.ro }; }), cfg: scfg[s.key] };
    })
  };
}

/**
 * The board for a visitor: the current version from the cache, else the last board built (a little
 * older — the background jobs bring it up to date). Only when nothing was ever built is the sheet read here.
 */
function boardData_(fid) {
  var key = 'bd2_' + fid + '_' + boardVer_();
  var c = cacheGet_(key);
  if (c) return c;
  c = cacheGet_('bd2_' + fid + '_last');
  if (c) return c;
  c = buildBoard_(fid);
  cachePut_(key, c, 21600);
  cachePut_('bd2_' + fid + '_last', c, 21600);
  return c;
}

/** Full read of one FMS sheet (slow on the order sheet: its formulas run 50,000 rows down). */
function buildBoard_(fid) {
  var lay = layout_(fid), scfg = stepCfg_(fid), state = leadState_(fid), agg = eventAgg_(fid), now = Date.now();
  var leads = readFlow_(fid).map(function (l) {
    decorate_(fid, l, lay, scfg, state, now);
    var a = agg[l.id] || {};
    l.att = a.att || {}; l.nN = a.n || 0; l.nP = a.p || 0; l.la = a.la || null; l.bk = a.bk || 0; l.by = a.by || {};
    return l;
  });
  var keep = [FLOWS[fid].owner, 'Timestamp', FLOWS[fid].sub, FLOWS[fid].phone, FLOWS[fid].material, FLOWS[fid].place, FLOWS[fid].category,
              FLOWS[fid].source, FLOWS[fid].market, FLOWS[fid].qty, 'MAIL ID'].concat(FLOWS[fid].titles).filter(String);
  leads = leads.map(function (l) {
    if (!l.closed || !l.closed.at || l.closed.at > now - 90 * 864e5) return l;
    var b = {};
    keep.forEach(function (h) { var v = pick_(l.b, h); if (v !== '' && v != null) b[h] = v; });
    return { id: l.id, r: l.r, b: b, s: {}, closed: l.closed, owner: l.owner, ind: l.ind, link: l.link, cur: null, side: [], att: {}, nN: l.nN, nP: l.nP, bk: l.bk, slim: 1 };
  });
  return { fid: fid, leads: leads, at: now };
}

/**
 * Background only (triggers): read both sheets, then publish the result as a new version. Saves made
 * while it was reading are re-applied, so nothing a person just did disappears.
 */
function rebuildBoards_() {
  var lock = LockService.getScriptLock(), p = PropertiesService.getScriptProperties();
  var busy = Number(p.getProperty('REBUILDING') || 0);
  if (Date.now() - busy < 240000) { p.setProperty('REBUILD_AGAIN', '1'); return false; }   // one rebuild at a time
  p.setProperty('REBUILDING', String(Date.now()));
  try {
    var rounds = 0;
    do {
      p.deleteProperty('REBUILD_AGAIN');
      var t0 = Date.now(), built = {};
      MEMO_ = { ss: MEMO_.ss };
      FLOW_IDS.forEach(function (f) { built[f] = buildBoard_(f); });   // no lock: saves never wait for this read
      FLOW_IDS.forEach(function (f) {                                  // a broken sheet (#REF!) never wipes the board
        var prev = cacheGet_('bd2_' + f + '_last'), nb = built[f];
        var bad = nb.leads.some(function (l) { return /^#/.test(String(l.id)); });
        if (prev && prev.leads.length > 10 && (bad || nb.leads.length < prev.leads.length / 2)) {
          Logger.log(f + ': sheet looks broken (' + nb.leads.length + ' rows, was ' + prev.leads.length + '), board kept');
          built[f] = prev;
        }
      });
      if (!lock.tryLock(20000)) return false;
      recentPatches_().forEach(function (x) {
        if (x.t < t0 - 5000 || !built[x.f]) return;
        try {
          MEMO_ = { ss: MEMO_.ss };
          var l = boardLead_(x.f, x.id), a = built[x.f].leads, i = -1;
          for (var j = 0; j < a.length; j++) if (a[j].id === x.id) { i = j; break; }
          if (i > -1) a[i] = l; else a.push(l);
        } catch (e) {}
      });
      var nv = String(Math.max(Date.now(), (Number(p.getProperty('BOARD_VER')) || 0) + 1));
      FLOW_IDS.forEach(function (f) { cachePut_('bd2_' + f + '_' + nv, built[f], 21600); cachePut_('bd2_' + f + '_last', built[f], 21600); });
      p.setProperty('BOARD_VER', nv);
      p.setProperty('BOARD_BUILT', nv);
      lock.releaseLock();
    } while (p.getProperty('REBUILD_AGAIN') && ++rounds < 2);
    return true;
  } finally { try { lock.releaseLock(); } catch (e) {} p.deleteProperty('REBUILDING'); }
}
function recentPatches_() { try { return JSON.parse(cache_().get('recent_patches') || '[]'); } catch (e) { return []; } }

/** Page start: who I am, both flows' layouts and boards. */
function bootstrap(token) {
  return bootFor_(ggmUser_(token));
}
function bootFor_(me) {
  var gen = GEN_FLOW[roleOf_(me)];
  if (gen) return {                                   // form-only: the form of one flow + who it can go to, no data
    me: { username: me.username, name: me.name, role: roleOf_(me), roleName: me.role, names: myNames_(me) },
    flows: [publicLayout_(gen)], boards: [], ver: '', industries: industries_(), warnPct: warnPct_(), scores: {}, hub: GGM_APP.hub,
    lists: (function () { var o = {}; o[gen] = nameLists_(gen); return o; })(),
    users: userList_().filter(function (x) { return !GEN_FLOW[x.r]; }).map(function (x) { return { u: x.u, n: x.n, r: x.r, rn: x.rn, names: [] }; })
  };
  return {
    me: { username: me.username, name: me.name, role: roleOf_(me), roleName: me.role, names: myNames_(me), scope: scopeOf_(me) },
    flows: FLOW_IDS.map(publicLayout_),
    boards: boardsFor_(me),
    ver: boardVer_(),
    users: userList_(),
    industries: industries_(),
    warnPct: warnPct_(),
    scores: scoreRules_(),
    hub: GGM_APP.hub
  };
}

/**
 * Suggestions for the new-entry form of a form-only role: the names already used (party, company,
 * mine, material…), never phone numbers, mails, remarks or anything else about a lead.
 */
function nameLists_(fid) {
  var f = FLOWS[fid], leads = boardData_(fid).leads, out = {};
  var skip = [f.owner, f.phone, 'MAIL ID', 'Timestamp'].filter(String).map(function (x) { return x.toLowerCase(); });
  layout_(fid).base.forEach(function (b) {
    if (b.ro || b.o || b.t !== 'text' || skip.indexOf(String(b.k).toLowerCase()) > -1 ||
        /mail|phone|mobile|contact det|remark|note|address|gst/i.test(b.k)) return;
    var m = {};
    leads.forEach(function (l) {
      var v = pick_(l.b, b.k); v = String(v == null ? '' : v).trim();
      if (v && !m[v.toUpperCase()]) m[v.toUpperCase()] = v;
    });
    var vals = Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, c) { return a.localeCompare(c); });
    if (vals.length) out[b.k] = vals;
  });
  return out;
}

function userList_() {
  var rows = ggmRows_();
  return Object.keys(rows).map(function (k) { var u = rows[k]; return { u: u.username, n: u.name, r: roleOf_(u), rn: u.role, names: myNames_(u), s: { L2O: sheetName_(u, 'L2O'), O2D: sheetName_(u, 'O2D') } }; })
    .sort(function (a, b) { return a.u.localeCompare(b.u); });
}

/** Heartbeat every minute or two: screen time + is the board still current? */
function ping(token, secs, ver, opens) {
  var me = ggmUser_(token);
  secs = Math.max(0, Math.min(Number(secs) || 0, 600));
  if (secs || opens) touchActivity_(me, secs, 0, opens ? 1 : 0);
  var v = boardVer_();
  if (GEN_FLOW[roleOf_(me)]) return { ver: v, same: true };       // form-only roles never get the board
  if (ver && ver === v) return { ver: v, same: true };
  return { ver: v, boards: boardsFor_(me), flows: FLOW_IDS.map(publicLayout_) };   // step settings (tile details, labels…) reach open screens too
}

/* ---------------------------------------------------------------- who sees what */

/** Admin setting (Settings → People → Board): { username: 'mine' } = that Executive sees only the tiles they can work. */
function scopes_() { return settings_().scope || {}; }
function scopeOf_(me) {
  return roleOf_(me) === 'exec' && scopes_()[String(me.username).toLowerCase()] === 'mine' ? 'mine' : 'all';
}
/** An open lead whose current step (or a step running beside it) this person may answer. */
function canSee_(me, fid, lead) {
  if (lead.closed) return false;
  return (lead.cur ? [lead.cur] : []).concat(lead.side || []).some(function (k) { return canAct_(me, fid, lead, k); });
}
/** "Only their steps" Executives may only touch the leads on their screen (notes, photos, industry). */
function mustSee_(me, fid, id) {
  if (scopeOf_(me) !== 'mine') return;
  if (!canSee_(me, fid, freshLead_(fid, id))) throw new Error(id + ' is not at a step you work.');
}
/** The boards as this person may see them: everything, or (scope 'mine') only their tiles — the rest is never sent. */
function boardsFor_(me) {
  var all = FLOW_IDS.map(boardData_);
  if (scopeOf_(me) !== 'mine') return all;
  return all.map(function (b) { return { fid: b.fid, at: b.at, leads: b.leads.filter(function (l) { return canSee_(me, b.fid, l); }) }; });
}

/* ---------------------------------------------------------------- one lead */

/** Re-reads the lead's row straight from the sheet (never from the cache). */
function freshLead_(fid, id) {
  var lay = layout_(fid), row = findRow_(fid, id), vals = fmsSheet_(fid).getRange(row, 1, 1, lay.cols).getValues()[0];
  var b = {}, s = {};
  lay.base.forEach(function (fl) { var v = cellOut_(vals[fl.c]); if (v !== '' && v != null) b[fl.k] = v; });
  lay.steps.forEach(function (st) {
    var o = { p: msOf_(vals[st.p]), a: msOf_(vals[st.a]), s: st.s >= 0 ? cellOut_(vals[st.s]) : '', f: {} };
    st.fields.forEach(function (fl) { var v = cellOut_(vals[fl.c]); if (v !== '' && v != null) o.f[fl.k] = v; });
    if (o.s === '') delete o.s;
    s[st.key] = o;
  });
  var lead = { r: row, id: id, b: b, s: s };
  MEMO_['state_' + fid] = null;
  decorate_(fid, lead, lay, stepCfg_(fid), leadState_(fid), Date.now());
  return lead;
}

/** Everything about one lead for the side panel: its row, events, notes, photo thumbnails. */
function leadDetail(token, fid, id) {
  var me = staff_(token), d = leadDetail_(me, fid, id);
  if (scopeOf_(me) === 'mine' && !canSee_(me, fid, d.lead)) throw new Error(id + ' is not at a step you work.');
  return d;
}
function leadDetail_(me, fid, id) {
  checkFlow_(fid);
  var lead = freshLead_(fid, id), agg = eventAgg_(fid)[id] || {};
  lead.att = agg.att || {}; lead.nN = agg.n || 0; lead.nP = agg.p || 0; lead.bk = agg.bk || 0; lead.by = agg.by || {};
  var events = rows_(TABS.EVENTS).filter(function (r) { return String(r[3]) === fid && String(r[4]) === id; }).map(eventObj_);
  var notes = rows_(TABS.NOTES).filter(function (r) { return String(r[3]) === fid && String(r[4]) === id; })
    .map(function (r) { return { t: msOf_(r[0]), u: String(r[1]), n: String(r[2]), st: String(r[5]), x: String(r[6]) }; });
  var psh = tab_(TABS.PHOTOS), photos = [];
  partialRows_(TABS.PHOTOS, 9).forEach(function (r, i) {
    if (String(r[3]) !== fid || String(r[4]) !== id) return;
    photos.push({ t: msOf_(r[0]), u: String(r[1]), n: String(r[2]), st: String(r[5]), id: String(r[6]), th: String(r[7] || ''), cap: String(r[8] || '') });
  });
  var can = {};
  (lead.cur ? [lead.cur] : []).concat(lead.side).forEach(function (k) { can[k] = canAct_(me, fid, lead, k); });
  var editAny = roleOf_(me) !== 'exec';
  var res = { lead: lead, events: events, notes: notes, photos: photos, can: can, editAny: editAny, owner: isOwner_(me, lead) };
  cycleDetail_(fid, lead, res);                      // cycles: trucks, allowed payment terms, order totals (Cycles.js)
  return res;
}

function checkFlow_(fid) { if (!FLOWS[fid]) throw new Error('Unknown flow.'); }

/** Signed-in person for everything except the new-entry form: form-only roles are refused. */
function staff_(token) {
  var me = ggmUser_(token);
  if (GEN_FLOW[roleOf_(me)]) throw new Error('Your role only adds new ' + (GEN_FLOW[roleOf_(me)] === 'L2O' ? 'leads' : 'orders') + '.');
  return me;
}

/* ---------------------------------------------------------------- answering a step */

/**
 * data = { status, fields: { head: value }, note, photos: [{ data, thumb, caption }] }
 * The answer decides where the tile goes: next step · stays (follow-up) · back to an earlier step · won · lost.
 */
function submitStep(token, fid, id, stepKey, data) {
  var me = staff_(token);
  checkFlow_(fid);
  data = data || {};
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var lay = layout_(fid), scfg = stepCfg_(fid), lead = freshLead_(fid, id), step = stepByKey_(lay, stepKey);
    if (!step) throw new Error('Unknown step.');
    if (lead.closed) throw new Error(id + ' is already closed (' + lead.closed.o + ').');
    if (lead.cur !== stepKey && lead.side.indexOf(stepKey) < 0) {
      throw new Error(id + ' is no longer at "' + scfg[stepKey].label + '"' + (lead.cur ? ' — it is at "' + scfg[lead.cur].label + '"' : '') + '. The board has been refreshed.');
    }
    if (!canAct_(me, fid, lead, stepKey)) throw new Error('This step is not assigned to you.');
    var status = String(data.status || '').trim();
    if (step.opts.indexOf(status) < 0) throw new Error('Pick an answer for "' + scfg[stepKey].label + '".');
    cycleGate_(fid, lead, stepKey, status, data.fields);   // payment terms / tons / trucks / open cycles (Cycles.js)

    var cells = {}, changes = {}, fields = data.fields || {};
    step.fields.forEach(function (fl) {
      if (fl.ro || !(fl.k in fields)) return;
      var v = cellIn_(fl, fields[fl.k]), old = lead.s[stepKey].f[fl.k];
      if (String(v instanceof Date ? v.getTime() : v) === String(old == null ? '' : old)) return;
      cells[fl.c] = v; changes[fl.k] = [old == null ? '' : old, v instanceof Date ? v.getTime() : v];
    });
    // required fields (of this step; values may already be in the sheet)
    var missing = scfg[stepKey].required.filter(function (ref) {
      var fl = fieldOf_(lay, ref);
      if (!fl) return false;
      var sk = ref.slice(0, ref.indexOf(':'));
      var v = sk === stepKey && fl.k in fields ? fields[fl.k] : refVal_(lead, ref);
      return v === '' || v == null;
    });
    var rule = ruleOf(scfg[stepKey].rules, stepKey, status, isLastMain_(lay, scfg, stepKey));
    if (missing.length && rule !== 'stay' && rule !== 'lost') throw new Error('Fill in: ' + missing.map(function (r) { return r.slice(r.indexOf(':') + 1); }).join(', ') + '.');

    // a saved field can also send the lead back (e.g. sample failed)
    var fr = fieldRuleHit_(fid, stepKey, Object.keys(changes).reduce(function (o, k) { o[k] = changes[k][1]; return o; }, {}));
    if (fr && (rule === 'next' || rule === 'stay')) rule = fr.action;

    var now = new Date(), plan = lead.s[stepKey].p, late = plan && now.getTime() > plan ? workHours(plan, now.getTime(), lay.cal) : 0;
    var onTime = !plan || now.getTime() <= plan;
    var ownerUsers = usersForName_(lead.owner), ownerUser = ownerUsers[0] || '';
    var msg = '', to = '';
    cells[step.s >= 0 ? step.s : step.a] = status;
    if (rule === 'next' || rule === 'won' || rule === 'lost') {
      cells[step.a] = now;
      // the app sheet has no formulas: Planned and Time Delay are written with the answer
      if (step.p >= 0 && plan && lay.formulaCols.indexOf(step.p) < 0) cells[step.p] = new Date(plan);
      if (step.d >= 0 && lay.formulaCols.indexOf(step.d) < 0) cells[step.d] = plan && now.getTime() > plan ? (now.getTime() - plan) / 864e5 : '';
      writeCells_(fid, lead.r, cells);
      logEvent_(me, fid, id, stepKey, 'DONE', status, { onTime: onTime, late: late, ownerUser: ownerUser, detail: Object.keys(changes).length ? { fields: changes } : null });
      if (rule === 'won' || rule === 'lost') {
        if (fid !== 'CYC') logEvent_(me, fid, id, stepKey, rule === 'won' ? 'WON' : 'LOST', status, { ownerUser: ownerUser });   // a cycle done is not an order won
        msg = id + (fid === 'CYC' ? (rule === 'won' ? ' — cycle complete ✓' : ' is closed') : rule === 'won' ? ' is won 🎉' : ' is closed as lost') + '.';
      } else {
        var nx = nextMainKey_(lay, scfg, stepKey);
        msg = id + ' moved to "' + (nx ? scfg[nx].label : 'done') + '".';
        to = nx || '';
      }
    } else if (rule === 'stay') {
      writeCells_(fid, lead.r, cells);
      logEvent_(me, fid, id, stepKey, 'FOLLOWUP', status, { ownerUser: ownerUser, detail: Object.keys(changes).length ? { fields: changes } : null });
      msg = id + ' stays at "' + scfg[stepKey].label + '" (' + status + '). Follow-up logged.';
    } else if (rule.indexOf('back:') === 0) {
      to = rule.slice(5);
      delete cells[step.s >= 0 ? step.s : step.a];        // the answer goes to Events; the step is redone later
      if (Object.keys(cells).length) writeCells_(fid, lead.r, cells);
      logEvent_(me, fid, id, stepKey, 'ANSWER', status, { ownerUser: ownerUser, detail: Object.keys(changes).length ? { fields: changes } : null });
      sendBack_(me, fid, lead, to, (fr ? fr.field + ': ' + fr.value : scfg[stepKey].label + ': ' + status), stepKey);
      msg = id + ' went back to "' + (scfg[to] ? scfg[to].label : to) + '".';
    } else throw new Error('Unknown rule "' + rule + '" for this answer. Ask the admin to check Settings → Flow rules.');

    if (data.note && String(data.note).trim()) saveNote_(me, fid, id, stepKey, data.note);
    (data.photos || []).slice(0, 8).forEach(function (p) { savePhoto_(me, fid, id, stepKey, p); });
    var extra = cycleAfterStep_(me, fid, lead, stepKey, rule);   // first cycle / order totals (Cycles.js)
    var det = leadDetailFor_(me, fid, id);
    bumpVer_(mergePatch_(patchOf_(fid, det.lead), extra));
    if (extra.CYC && fid === 'O2D') msg += ' ' + extra.CYC[0].id + ' started — record its payment.';
    return { ok: true, msg: msg, rule: rule, to: to, detail: det, extra: extra };
  } finally { lock.releaseLock(); }
}

/**
 * "Only save": what was filled in so far (fields, note, photos) is kept; no answer, no Actual —
 * the tile stays at this step and its deadline keeps running. "Move to next step" is submitStep.
 */
function saveStepDraft(token, fid, id, stepKey, data) {
  var me = staff_(token);
  checkFlow_(fid);
  data = data || {};
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var lay = layout_(fid), scfg = stepCfg_(fid), lead = freshLead_(fid, id), step = stepByKey_(lay, stepKey);
    if (!step) throw new Error('Unknown step.');
    if (lead.closed) throw new Error(id + ' is already closed (' + lead.closed.o + ').');
    if (lead.cur !== stepKey && lead.side.indexOf(stepKey) < 0) {
      throw new Error(id + ' is no longer at "' + scfg[stepKey].label + '"' + (lead.cur ? ' — it is at "' + scfg[lead.cur].label + '"' : '') + '. The board has been refreshed.');
    }
    if (!canAct_(me, fid, lead, stepKey)) throw new Error('This step is not assigned to you.');
    var cells = {}, changes = {}, fields = data.fields || {};
    step.fields.forEach(function (fl) {
      if (fl.ro || !(fl.k in fields)) return;
      var v = cellIn_(fl, fields[fl.k]), old = lead.s[stepKey].f[fl.k];
      if (String(v instanceof Date ? v.getTime() : v) === String(old == null ? '' : old)) return;
      cells[fl.c] = v; changes[fl.k] = [old == null ? '' : old, v instanceof Date ? v.getTime() : v];
    });
    var note = String(data.note || '').trim(), photos = (data.photos || []).slice(0, 8);
    if (!Object.keys(cells).length && !note && !photos.length) return { ok: true, msg: 'Nothing new to save.', detail: leadDetailFor_(me, fid, id) };
    if (Object.keys(cells).length) {
      writeCells_(fid, lead.r, cells);
      logEvent_(me, fid, id, stepKey, 'SAVE', Object.keys(changes).join(', '), { detail: { fields: changes } });
    }
    if (note) saveNote_(me, fid, id, stepKey, note);
    photos.forEach(function (p) { savePhoto_(me, fid, id, stepKey, p); });
    var det = leadDetailFor_(me, fid, id);
    bumpVer_(patchOf_(fid, det.lead));
    return { ok: true, msg: 'Saved — ' + id + ' stays at "' + scfg[stepKey].label + '".', detail: det };
  } finally { lock.releaseLock(); }
}

/** "Log call" on a tile: what happened on the call. It is a follow-up (count + points); "call later" sets a Telegram reminder. */
var CALL_OUTCOMES = ['Call not received', 'Talked – interested', 'Talked – not interested', 'Asked to call later'];
function logCall(token, fid, id, data) {
  var me = staff_(token);
  checkFlow_(fid);
  data = data || {};
  var outcome = String(data.outcome || ''), note = String(data.note || '').trim().slice(0, 1000);
  if (CALL_OUTCOMES.indexOf(outcome) < 0) throw new Error('Pick what happened on the call.');
  var when = null;
  if (outcome === CALL_OUTCOMES[3]) {
    var m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(String(data.next || ''));
    if (!m) throw new Error('Pick when to call again.');
    when = new Date(m[1] + 'T' + m[2] + ':' + m[3] + ':00+05:30');
    if (when.getTime() < Date.now() - 60000) throw new Error('That time has already passed.');
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var lead = freshLead_(fid, id);
    if (lead.closed) throw new Error(id + ' is already closed.');
    var keys = (lead.cur ? [lead.cur] : []).concat(lead.side || []), role = roleOf_(me);
    if (!(role === 'admin' || role === 'manager' || isOwner_(me, lead) || keys.some(function (k) { return canAct_(me, fid, lead, k); }))) throw new Error('This ' + FLOWS[fid].unit + ' is not with you.');
    var k = keys[0] || '';
    logEvent_(me, fid, id, k, 'FOLLOWUP', 'Call: ' + outcome + (note ? ' — ' + note.slice(0, 200) : ''),
      { ownerUser: usersForName_(lead.owner)[0] || '', detail: { call: outcome, note: note, next: when ? when.getTime() : null } });
    if (note) saveNote_(me, fid, id, k, '📞 ' + outcome + ' — ' + note);
    if (when) addReminder_(me, '📞 Call back ' + id + ' · ' + leadTitle_(fid, lead) + (note ? ' — ' + note : ''), when, '', fid, id);
    var det = leadDetailFor_(me, fid, id);
    bumpVer_(patchOf_(fid, det.lead));
    var linked = when && !!tgChats_()[String(me.username).toLowerCase()];
    return { ok: true, detail: det, msg: 'Call logged' + (when ? ' · reminder ' + fmtWhen_(when.getTime()) + (linked ? ' on Telegram' : ' (connect Telegram in 🔔 Reminders to get it)') : '') + '.' };
  } finally { lock.releaseLock(); }
}

function leadDetailFor_(me, fid, id) {
  MEMO_ = { ss: MEMO_.ss };
  return leadDetail_(me, fid, id);
}

function isLastMain_(lay, scfg, key) {
  var mains = lay.steps.filter(function (s) { return !scfg[s.key].side; });
  return mains.length && mains[mains.length - 1].key === key && !scfg[key].side;
}
function nextMainKey_(lay, scfg, key) {
  var i = lay.steps.map(function (s) { return s.key; }).indexOf(key);
  for (var j = i + 1; j < lay.steps.length; j++) if (!scfg[lay.steps[j].key].side) return lay.steps[j].key;
  return null;
}

/** { field, value, action } when a changed field matches a field rule of this step. */
function fieldRuleHit_(fid, stepKey, changed) {
  var hit = null;
  fieldRules_(fid).forEach(function (r) {
    if (hit || r.step !== stepKey) return;
    Object.keys(changed).forEach(function (k) {
      if (hit || hKey_(k) !== hKey_(r.field)) return;
      var v = String(changed[k]).trim();
      if ((r.values || []).some(function (x) { return String(x).trim().toLowerCase() === v.toLowerCase(); })) hit = { field: k, value: v, action: r.action };
    });
  });
  return hit;
}

/**
 * Back to an earlier step: that step and every main step after it (up to where the
 * lead is now) lose their Actual / answer in the sheet; the clock of the target step
 * restarts now. The old values stay in Events (detail), so nothing is lost.
 */
function sendBack_(me, fid, lead, toKey, reason, fromKey) {
  var lay = layout_(fid), scfg = stepCfg_(fid), keys = lay.steps.map(function (s) { return s.key; });
  var ti = keys.indexOf(toKey);
  if (ti < 0) throw new Error('Unknown step to go back to.');
  var upto = lead.cur ? keys.indexOf(lead.cur) : keys.length - 1;
  if (fromKey) upto = Math.max(upto, keys.indexOf(fromKey));
  if (ti > upto) throw new Error('A lead can only go back to an earlier step.');
  var cells = {}, cleared = {};
  for (var i = ti; i <= upto; i++) {
    var st = lay.steps[i], x = lead.s[st.key];
    if (!x.a && !x.s) continue;
    cleared[st.key] = { a: x.a || '', s: x.s || '' };
    cells[st.a] = '';
    if (st.s >= 0) cells[st.s] = '';
    if (st.p >= 0 && lay.formulaCols.indexOf(st.p) < 0) cells[st.p] = '';     // the clock restarts
    if (st.d >= 0 && lay.formulaCols.indexOf(st.d) < 0) cells[st.d] = '';
  }
  if (Object.keys(cells).length) writeCells_(fid, lead.r, cells);
  var blame = ((eventAgg_(fid)[lead.id] || {}).by || {})[toKey];
  setState_(fid, lead.id, 'restart:' + toKey, Date.now(), me.username);
  logEvent_(me, fid, lead.id, fromKey || lead.cur || '', 'BACK', reason, { to: toKey, ownerUser: (usersForName_(lead.owner)[0] || ''),
    detail: { cleared: cleared, blame: blame ? blame.u : (usersForName_(lead.owner)[0] || '') } });
}

/** Manual "send back" from the panel (a reason is required). */
function sendBack(token, fid, id, toKey, reason) {
  var me = staff_(token);
  checkFlow_(fid);
  reason = String(reason || '').trim();
  if (reason.length < 3) throw new Error('Write why it goes back.');
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var lead = freshLead_(fid, id);
    if (lead.closed) throw new Error('Reopen the ' + FLOWS[fid].unit + ' first.');
    if (!canAct_(me, fid, lead, lead.cur) && !isOwner_(me, lead)) throw new Error('This step is not assigned to you.');
    sendBack_(me, fid, lead, toKey, reason, null);
    var det = leadDetailFor_(me, fid, id);
    bumpVer_(patchOf_(fid, det.lead));
    return { ok: true, msg: id + ' went back to "' + stepCfg_(fid)[toKey].label + '".', detail: det };
  } finally { lock.releaseLock(); }
}

/** Change values of a step already done (or the lead's own details). Field rules apply. */
function editFields(token, fid, id, stepKey, fields) {
  var me = staff_(token);
  checkFlow_(fid);
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var lay = layout_(fid), lead = freshLead_(fid, id), list, cells = {}, changes = {};
    if (stepKey === 'base') {
      if (roleOf_(me) === 'exec' && !isOwner_(me, lead)) throw new Error('Only the owner, a Manager or an Admin can change these details.');
      list = lay.base;
    } else {
      var st = stepByKey_(lay, stepKey);
      if (!st) throw new Error('Unknown step.');
      if (!canAct_(me, fid, lead, stepKey)) throw new Error('This step is not assigned to you.');
      list = st.fields.slice();
      if (fields.__status != null && st.s >= 0 && lead.s[stepKey].a) list.push({ c: st.s, k: '__status', t: 'select', o: st.opts });
    }
    var cur = stepKey === 'base' ? lead.b : lead.s[stepKey].f;
    list.forEach(function (fl) {
      if ((fl.ro && !(stepKey === 'base' && fl.sp && fl.src != null && fl.c > 1)) || !(fl.k in fields)) return;
      var v = cellIn_(fl, fields[fl.k]), old = fl.k === '__status' ? lead.s[stepKey].s : cur[fl.k];
      if (String(v instanceof Date ? v.getTime() : v) === String(old == null ? '' : old)) return;
      cells[fl.c] = v; changes[fl.k === '__status' ? 'Answer' : fl.k] = [old == null ? '' : old, v instanceof Date ? v.getTime() : v];
    });
    if (!Object.keys(cells).length) return { ok: true, msg: 'Nothing changed.', detail: leadDetailFor_(me, fid, id) };
    if (stepKey === 'base') writeBase_(fid, lead, cells); else writeCells_(fid, lead.r, cells);
    logEvent_(me, fid, id, stepKey === 'base' ? '' : stepKey, 'EDIT', Object.keys(changes).join(', '), { detail: { fields: changes } });
    var msg = 'Saved.';
    if (stepKey !== 'base' && !lead.closed) {
      var fr = fieldRuleHit_(fid, stepKey, Object.keys(changes).reduce(function (o, k) { o[k] = changes[k][1]; return o; }, {}));
      if (fr && fr.action.indexOf('back:') === 0) {
        var to = fr.action.slice(5), keys = lay.steps.map(function (s) { return s.key; });
        if (!lead.cur || keys.indexOf(to) <= keys.indexOf(lead.cur)) {
          MEMO_['rd_' + fid] = null;
          sendBack_(me, fid, freshLead_(fid, id), to, fr.field + ': ' + fr.value, null);
          msg = 'Saved. ' + id + ' went back to "' + stepCfg_(fid)[to].label + '" (' + fr.field + ': ' + fr.value + ').';
        }
      }
    }
    var det = leadDetailFor_(me, fid, id);
    bumpVer_(patchOf_(fid, det.lead));
    return { ok: true, msg: msg, detail: det };
  } finally { lock.releaseLock(); }
}

/** Close a lead by hand (won / lost, with a reason), or reopen it. */
function closeLead(token, fid, id, outcome, reason) {
  var me = staff_(token);
  checkFlow_(fid);
  reason = String(reason || '').trim();
  if (outcome !== 'won' && outcome !== 'lost' && outcome !== 'open') throw new Error('Bad request.');
  if (outcome !== 'open' && reason.length < 3) throw new Error('Write a reason.');
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var lead = freshLead_(fid, id), lay = layout_(fid), scfg = stepCfg_(fid);
    if (roleOf_(me) === 'exec' && !isOwner_(me, lead)) throw new Error('Only the owner, a Manager or an Admin can close or reopen.');
    var ownerUser = usersForName_(lead.owner)[0] || '';
    if (outcome === 'open') {
      if (!lead.closed) return { ok: true, msg: 'Already open.', detail: leadDetailFor_(me, fid, id) };
      if (lead.closed.app) setState_(fid, id, 'closed', '', me.username);
      else if (lead.closed.step) {                       // closed by an answer in the sheet: clear that answer
        var st = stepByKey_(lay, lead.closed.step), cells = {};
        cells[st.a] = ''; if (st.s >= 0) cells[st.s] = '';
        writeCells_(fid, lead.r, cells);
        setState_(fid, id, 'restart:' + st.key, Date.now(), me.username);
      }
      logEvent_(me, fid, id, lead.closed.step || '', 'REOPEN', reason || 'Reopened', { ownerUser: ownerUser });
      var ox = fid === 'CYC' ? writeOrderSummary_(me, String(pick_(lead.b, 'Order No')).trim()) : null;
      var det = leadDetailFor_(me, fid, id);
      bumpVer_(mergePatch_(patchOf_(fid, det.lead), ox ? { O2D: [ox] } : {}));
      return { ok: true, msg: id + ' is open again.', detail: det };
    }
    if (lead.closed) throw new Error(id + ' is already closed.');
    if (fid === 'O2D' && cyclesOn_() && orderSummary_(id).open) throw new Error('Finish or close the open cycles of ' + id + ' first.');
    // when the current step has a matching answer ("Close Inquiry", "Order Reject"…) it is written to the sheet too
    var stepKey = lead.cur, written = false;
    if (stepKey) {
      var opt = stepByKey_(lay, stepKey).opts.filter(function (o) { return ruleOf(scfg[stepKey].rules, stepKey, o, isLastMain_(lay, scfg, stepKey)) === outcome; }).pop();   // "Close Inquiry" rather than "Wrong Number"
      if (opt) {
        var s2 = stepByKey_(lay, stepKey), c2 = {};
        c2[s2.a] = new Date(); c2[s2.s >= 0 ? s2.s : s2.a] = opt;
        writeCells_(fid, lead.r, c2);
        written = true;
      }
    }
    if (!written) setState_(fid, id, 'closed', { o: outcome, at: Date.now(), by: me.name, why: reason, step: stepKey || '' }, me.username);
    logEvent_(me, fid, id, stepKey || '', outcome === 'won' ? 'WON' : 'LOST', reason, { ownerUser: ownerUser, detail: { manual: true } });
    if (reason) saveNote_(me, fid, id, stepKey || '', (outcome === 'won' ? 'Closed as won: ' : 'Closed as lost: ') + reason);
    var oc = fid === 'CYC' ? writeOrderSummary_(me, String(pick_(lead.b, 'Order No')).trim()) : null;
    var det = leadDetailFor_(me, fid, id);
    bumpVer_(mergePatch_(patchOf_(fid, det.lead), oc ? { O2D: [oc] } : {}));
    return { ok: true, msg: id + ' closed as ' + outcome + '.', detail: det };
  } finally { lock.releaseLock(); }
}

/* ---------------------------------------------------------------- notes, photos, extras */

function saveNote_(me, fid, id, step, text) {
  text = String(text || '').trim().slice(0, 4000);
  if (!text) return;
  append_(TABS.NOTES, [new Date(), me.username, me.name, fid, id, step || '', text]);
  logEvent_(me, fid, id, step, 'NOTE', text.slice(0, 120));
}

function addNote(token, fid, id, step, text) {
  var me = staff_(token);
  checkFlow_(fid);
  mustSee_(me, fid, id);
  if (!String(text || '').trim()) throw new Error('Write the note first.');
  findRow_(fid, id);
  saveNote_(me, fid, id, step, text);
  var det = leadDetailFor_(me, fid, id);
  bumpVer_(patchOf_(fid, det.lead));
  return { ok: true, msg: 'Note added.', detail: det };
}

function photoFolder_() {
  var p = PropertiesService.getScriptProperties(), id = p.getProperty('PHOTO_FOLDER');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var f = DriveApp.createFolder('Leads & Orders — photos');
  p.setProperty('PHOTO_FOLDER', f.getId());
  return f;
}

/** p = { data: dataURL (already shrunk by the page), thumb: small dataURL, caption } */
function savePhoto_(me, fid, id, step, p) {
  var m = String(p && p.data || '').match(/^data:(image\/[a-z+]+);base64,(.+)$/);
  if (!m) throw new Error('A photo could not be read.');
  var bytes = Utilities.base64Decode(m[2]);
  if (bytes.length > 8 * 1024 * 1024) throw new Error('A photo is too big (max 8 MB).');
  var name = fid + '_' + id + '_' + (step || 'lead') + '_' + Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyyMMdd_HHmmss') + '.jpg';
  var file = photoFolder_().createFile(Utilities.newBlob(bytes, m[1], name));
  var thumb = String(p.thumb || '');
  if (thumb.length > 45000 || !/^data:image\//.test(thumb)) thumb = '';
  append_(TABS.PHOTOS, [new Date(), me.username, me.name, fid, id, step || '', file.getId(), thumb, String(p.caption || '').slice(0, 300)]);
  logEvent_(me, fid, id, step, 'PHOTO', String(p.caption || '').slice(0, 120));
}

function addPhotos(token, fid, id, step, list) {
  var me = staff_(token);
  checkFlow_(fid);
  mustSee_(me, fid, id);
  findRow_(fid, id);
  (list || []).slice(0, 8).forEach(function (p) { savePhoto_(me, fid, id, step, p); });
  var det = leadDetailFor_(me, fid, id);
  bumpVer_(patchOf_(fid, det.lead));
  return { ok: true, msg: (list || []).length + ' photo(s) added.', detail: det };
}

/** Full-size photo (only files listed in the Photos tab). */
function getPhoto(token, fileId) {
  staff_(token);
  var ok = partialRows_(TABS.PHOTOS, 7).some(function (r) { return String(r[6]) === String(fileId); });
  if (!ok) throw new Error('Photo not found.');
  var blob = DriveApp.getFileById(fileId).getBlob();
  if (blob.getBytes().length > 12 * 1024 * 1024) throw new Error('Photo too large to show.');
  return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
}

function setIndustry(token, fid, id, value) {
  var me = staff_(token);
  checkFlow_(fid);
  mustSee_(me, fid, id);
  findRow_(fid, id);
  value = String(value || '').trim().slice(0, 80);
  setState_(fid, id, 'industry', value, me.username);
  logEvent_(me, fid, id, '', 'INDUSTRY', value || '(cleared)');
  var det = leadDetailFor_(me, fid, id);
  bumpVer_(patchOf_(fid, det.lead));
  return { ok: true, msg: 'Industry saved.', detail: det };
}

/* ---------------------------------------------------------------- new lead / new order */

/** fields = { heading: value } of the first block. Returns the new id. */
function createEntry(token, fid, fields, fromLead) {
  var me = ggmUser_(token);
  checkFlow_(fid);
  fields = fields || {};
  var f = FLOWS[fid], lay = layout_(fid), gen = GEN_FLOW[roleOf_(me)];
  if (gen) {
    if (gen !== fid) throw new Error('You can only add ' + (gen === 'L2O' ? 'leads' : 'orders') + '.');
    if (!fields.__owner) throw new Error('Pick who will work this ' + f.unit + '.');
    fromLead = null;
  }
  // owner: Admin / Manager may pick anyone with access (__owner = username); everyone else gets the lead themselves
  var ownerUser = me;
  if (fields.__owner && roleOf_(me) !== 'exec') {
    ownerUser = ggmRows_()[String(fields.__owner).toLowerCase()];
    if (!ownerUser) throw new Error('That person does not have access to Leads & Orders.');
    if (GEN_FLOW[roleOf_(ownerUser)]) throw new Error(ownerUser.name + ' only adds new entries and cannot work them. Pick someone else.');
  }
  fields[f.owner] = sheetName_(ownerUser, fid);
  var hasTitle = f.titles.some(function (h) { return String(fields[h] || '').trim(); });
  if (!hasTitle) throw new Error('Enter ' + f.titles.join(' or ') + '.');
  if (fid === 'L2O' && !String(fields[f.phone] || '').trim() && !String(fields['MAIL ID'] || '').trim()) throw new Error('Enter a phone number or an e-mail.');
  if (fid === 'O2D' && !String(fields[f.qty] || '').trim()) throw new Error('Enter the quantity.');
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    if (fromLead) {
      var src = freshLead_('L2O', fromLead);
      if (src.link) throw new Error(fromLead + ' already has order ' + src.link + '.');
    }
    var id;
    if (lay.source) {
      var ssh = srcSheet_(fid), width = 0, rowVals = {};
      lay.base.forEach(function (fl) {
        if (!fl.sp || fl.src == null) return;
        width = Math.max(width, fl.src + 1);
        if (fl.c === 1 || hKey_(fl.k) === 'timestamp') { rowVals[fl.src] = new Date(); return; }
        if (!(fl.k in fields)) return;
        var v = cellIn_(fl, fields[fl.k]);
        if (v !== '') rowVals[fl.src] = v;
      });
      var arr = []; for (var i = 0; i < width; i++) arr.push(rowVals[i] != null ? rowVals[i] : '');
      ssh.appendRow(arr);
      SpreadsheetApp.flush();
      MEMO_ = { ss: MEMO_.ss };
      var all = readFlow_(fid);
      id = all.length ? all[all.length - 1].id : '';
      if (!id) throw new Error('The order was added to "' + lay.source.tab + '" but has no order number yet. Refresh in a minute.');
    } else {
      id = nextId_(fid);
      var r = newRow_(fid), cells = {};
      cells[0] = id; cells[1] = new Date();
      lay.base.forEach(function (fl) {
        if (fl.ro || !(fl.k in fields)) return;
        var v = cellIn_(fl, fields[fl.k]);
        if (v !== '') cells[fl.c] = v;
      });
      writeCells_(fid, r, cells);
    }
    var ownerUser = usersForName_(fields[f.owner])[0] || '';
    logEvent_(me, fid, id, '', 'CREATE', fromLead ? 'From lead ' + fromLead : 'New ' + f.unit, { ownerUser: ownerUser });
    if (fields.__industry) setState_(fid, id, 'industry', String(fields.__industry), me.username);
    if (fields.__note) saveNote_(me, fid, id, '', fields.__note);
    if (fromLead) {
      setState_('L2O', fromLead, 'link', id, me.username);
      setState_('O2D', id, 'link', fromLead, me.username);
      logEvent_(me, 'L2O', fromLead, '', 'ORDER', id, { ownerUser: usersForName_(src.owner)[0] || '' });
    }
    MEMO_ = { ss: MEMO_.ss };
    var nl = boardLead_(fid, id), srcL = fromLead ? boardLead_('L2O', fromLead) : null;
    bumpVer_(patchOf_(fid, nl, srcL ? 'L2O' : null, srcL));
    var msg = (fid === 'L2O' ? 'Lead ' : 'Order ') + id + ' created.';
    return gen ? { ok: true, id: id, msg: msg, owner: fields[f.owner] } : { ok: true, id: id, lead: nl, msg: msg };
  } finally { lock.releaseLock(); }
}

/** Admin / Manager: give a lead or order to someone who has access (writes their name into ATT. NAME / SALES PER.). */
function assignOwner(token, fid, id, username) {
  var me = staff_(token);
  checkFlow_(fid);
  if (roleOf_(me) === 'exec') throw new Error('Only an Admin or a Manager can assign.');
  var u = ggmRows_()[String(username || '').toLowerCase()];
  if (!u) throw new Error('That person does not have access to Leads & Orders.');
  if (GEN_FLOW[roleOf_(u)]) throw new Error(u.name + ' only adds new entries and cannot work them.');
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var lay = layout_(fid), lead = freshLead_(fid, id), fl = null;
    lay.base.forEach(function (b) { if (hKey_(b.k) === hKey_(FLOWS[fid].owner)) fl = b; });
    if (!fl) throw new Error('No ' + FLOWS[fid].owner + ' column in the sheet.');
    var name = sheetName_(u, fid), cells = {};
    if (String(lead.owner).toUpperCase() === name) return { ok: true, msg: 'Already with ' + u.name + '.', detail: leadDetailFor_(me, fid, id) };
    cells[fl.c] = name;
    writeBase_(fid, lead, cells);
    logEvent_(me, fid, id, '', 'ASSIGN', u.name, { ownerUser: u.username, detail: { fields: { Owner: [lead.owner, name] } } });
    var moved = [];
    if (fid === 'O2D' && cyclesOn_()) {                // the order's open cycles go to the same person
      var cl = layout_('CYC'), oc2 = baseCol_(cl, FLOWS.CYC.owner);
      orderSummary_(id).cycles.forEach(function (c) { if (!c.closed && oc2 >= 0) { var w = {}; w[oc2] = name; writeCells_('CYC', findRow_('CYC', c.id), w); moved.push(c.id); } });
      MEMO_['rd_CYC'] = null;
    }
    var det = leadDetailFor_(me, fid, id);
    bumpVer_(mergePatch_(patchOf_(fid, det.lead), moved.length ? { CYC: moved.map(function (c) { return boardLead_('CYC', c); }) } : {}));
    return { ok: true, msg: id + ' is now with ' + u.name + '.', detail: det };
  } finally { lock.releaseLock(); }
}

/* ---------------------------------------------------------------- owner names = Master App usernames */

var HUB_SHEET_ID = '19n2BoxjvBpfqpenxGkWuGleRLmyBYcI7RY0o3fepmCM';   // GGM Portal "Master App" (Users tab)

/** Every Master App user: [{ u: username, n: name }] (cached 30 min; falls back to this app's users). */
function hubUsers_() {
  var c = cache_().get('hub_users');
  if (c) return JSON.parse(c);
  var list = [];
  try {
    var sh = SpreadsheetApp.openById(HUB_SHEET_ID).getSheetByName('Users'), n = sh.getLastRow() - 1;
    if (n > 0) sh.getRange(2, 1, n, 2).getDisplayValues().forEach(function (r) { if (String(r[0]).trim()) list.push({ u: String(r[0]).trim(), n: String(r[1]).trim() }); });
  } catch (e) {}
  if (!list.length) { var rows = ggmRows_(); Object.keys(rows).forEach(function (k) { list.push({ u: rows[k].username, n: rows[k].name }); }); }
  try { cache_().put('hub_users', JSON.stringify(list), 1800); } catch (e) {}
  return list;
}

/** A sheet name → the Master App username it belongs to (null when nobody or more than one person fits). */
function ownerUsername_(name, users, al) {
  var v = String(name || '').trim();
  if (!v) return null;
  for (var i = 0; i < users.length; i++) if (users[i].u.toLowerCase() === v.toLowerCase()) return users[i].u;
  var exact = function (un) { for (var j = 0; j < users.length; j++) if (users[j].u.toLowerCase() === un.toLowerCase()) return users[j].u; return un; };
  var hit = null;
  Object.keys(al || {}).forEach(function (un) {
    String(al[un]).split(',').forEach(function (sp) { if (!hit && nameKey(sp) && nameKey(sp) === nameKey(v)) hit = exact(un); });
  });
  if (hit) return hit;
  var found = {};
  users.forEach(function (u) { if (namesMatch(v, u.u) || namesMatch(v, u.n)) found[u.u] = 1; });
  var keys = Object.keys(found);
  return keys.length === 1 ? keys[0] : null;
}

/**
 * Rewrites ATT. NAME / SALES PER. in both FMS sheets to Master App usernames (SURAJ KUMAR → SURAJ,
 * AAYUSHI → AAYUSHI KHANDELWAL…). Runs every 10 minutes, so rows from the Google Forms are fixed too.
 */
function normalizeOwners_() {
  var users = hubUsers_(), al = aliases_(), changed = 0, report = {}, unknown = {}, patch = {};
  FLOW_IDS.forEach(function (fid) {
    var lay = layout_(fid), sh = fmsSheet_(fid), col = -1, groups = {}, ofl = null;
    lay.base.forEach(function (b) { if (hKey_(b.k) === hKey_(FLOWS[fid].owner)) { col = b.c; ofl = b; } });
    if (col < 0) return;
    if (ofl.sp) {                                   // e.g. SALES PER. comes from "Form responses 1" → rename there
      if (ofl.src == null) return;
      var ssh = srcSheet_(fid), n = ssh.getLastRow() - lay.source.row0 + 1;
      if (n < 1) return;
      var vals = ssh.getRange(lay.source.row0, ofl.src + 1, n, 1).getValues(), sg = {};
      vals.forEach(function (r, i) {
        var cur = String(r[0] || '').trim();
        if (!cur) return;
        var to = ownerUsername_(cur, users, al);
        if (!to) { unknown[cur.toUpperCase()] = 1; return; }
        if (to === cur) return;
        (sg[to] = sg[to] || []).push(colA1_(ofl.src) + (lay.source.row0 + i));
        report[cur + ' → ' + to] = (report[cur + ' → ' + to] || 0) + 1;
        changed++;
      });
      Object.keys(sg).forEach(function (to) {
        for (var i = 0; i < sg[to].length; i += 200) ssh.getRangeList(sg[to].slice(i, i + 200)).setValue(to);
      });
      if (Object.keys(sg).length) {
        SpreadsheetApp.flush();
        var bd2 = boardData_(fid);
        patch[fid] = [];
        bd2.leads.forEach(function (l) { var to2 = ownerUsername_(l.owner, users, al); if (to2 && to2 !== l.owner) { l.owner = to2; l.b[FLOWS[fid].owner] = to2; patch[fid].push(l); } });
      }
      return;
    }
    var bd = boardData_(fid);
    patch[fid] = [];
    bd.leads.forEach(function (l) {
      var cur = String(l.owner || pick_(l.b, FLOWS[fid].owner) || '').trim();
      if (!cur || !l.r) return;
      var to = ownerUsername_(cur, users, al);
      if (!to) { unknown[cur.toUpperCase()] = 1; return; }
      if (to === cur) return;
      (groups[to] = groups[to] || []).push(colA1_(col) + l.r);
      l.owner = to; l.b[FLOWS[fid].owner] = to; patch[fid].push(l);
      report[cur + ' → ' + to] = (report[cur + ' → ' + to] || 0) + 1;
      changed++;
    });
    Object.keys(groups).forEach(function (to) {
      for (var i = 0; i < groups[to].length; i += 200) sh.getRangeList(groups[to].slice(i, i + 200)).setValue(to);
    });
  });
  if (changed) {
    append_(TABS.EVENTS, [new Date(), 'system', 'System', '', '', '', 'RENAME', changed + ' owner name(s) → Master App usernames', '', '', '', '', JSON.stringify(report).slice(0, 45000)]);
    MEMO_ = { ss: MEMO_.ss };
    bumpVer_(patch);
  }
  return { changed: changed, report: report, unknown: Object.keys(unknown) };
}
function colA1_(c) { var s = '', n = c + 1; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; } return s; }

/* ---------------------------------------------------------------- settings (admin) */

function settingsData(token) {
  var me = staff_(token);
  mustAdmin_(me);
  var s = settings_();
  return {
    users: userList_(), aliases: aliases_(), scope: scopes_(), custTerms: custTerms_(), industries: industries_(), warnPct: warnPct_(), scores: scoreRules_(),
    rules: FLOW_IDS.reduce(function (o, fid) { o[fid] = (s.rules || {})[fid] || DEFAULT_RULES[fid] || {}; return o; }, {}),
    fieldRules: FLOW_IDS.reduce(function (o, fid) { o[fid] = fieldRules_(fid); return o; }, {})
  };
}

/** patch = { steps: {fid: {KEY: {...}}}, rules: {fid: {...}}, fieldRules: {fid: [...]}, scores: {k: pts}, warnPct, industries, aliases } */
function saveSettings(token, patch) {
  var me = staff_(token);
  mustAdmin_(me);
  patch = patch || {};
  var s = settings_();
  if (patch.steps) {
    var all = s.steps || {};
    Object.keys(patch.steps).forEach(function (fid) { checkFlow_(fid); all[fid] = patch.steps[fid]; });
    setSetting_('steps', all, me.username);
  }
  if (patch.rules) {
    var r = s.rules || {};
    Object.keys(patch.rules).forEach(function (fid) {
      checkFlow_(fid);
      Object.keys(patch.rules[fid]).forEach(function (k) {
        Object.keys(patch.rules[fid][k]).forEach(function (opt) {
          var a = patch.rules[fid][k][opt];
          if (!/^(next|stay|won|lost|back:[A-Z0-9_]+)$/.test(a)) throw new Error('Bad rule: ' + a);
        });
      });
      r[fid] = patch.rules[fid];
    });
    setSetting_('rules', r, me.username);
  }
  if (patch.fieldRules) {
    var fr = s.fieldRules || {};
    Object.keys(patch.fieldRules).forEach(function (fid) { checkFlow_(fid); fr[fid] = patch.fieldRules[fid]; });
    setSetting_('fieldRules', fr, me.username);
  }
  if (patch.scores) setSetting_('scores', patch.scores, me.username);
  if (patch.warnPct != null) setSetting_('warnPct', Math.max(5, Math.min(90, Number(patch.warnPct) || WARN_PCT)), me.username);
  if (patch.industries) setSetting_('industries', patch.industries.map(String).filter(function (x) { return x.trim(); }).slice(0, 80), me.username);
  if (patch.aliases) setSetting_('aliases', patch.aliases, me.username);
  if (patch.custTerms) {                              // Settings → Customers: which terms besides advance each party may use
    var ct = {};
    Object.keys(patch.custTerms).forEach(function (k) {
      var v = (patch.custTerms[k] || []).filter(function (t) { return CYCLE_TERMS.indexOf(t) > 0; });
      if (v.length && partyKey_(k)) ct[partyKey_(k)] = v;
    });
    setSetting_('custTerms', ct, me.username);
  }
  if (patch.scope) {
    var sc = {};
    Object.keys(patch.scope).forEach(function (u) { if (patch.scope[u] === 'mine') sc[String(u).toLowerCase()] = 'mine'; });
    setSetting_('scope', sc, me.username);
  }
  MEMO_ = { ss: MEMO_.ss };
  bumpVer_({});
  PropertiesService.getScriptProperties().setProperty('BOARD_BUILT', '0');   // the next 10-minute job rebuilds with the new rules
  logEvent_(me, '', '', '', 'SETTINGS', Object.keys(patch).join(', '));
  return { ok: true, msg: 'Settings saved.', flows: FLOW_IDS.map(publicLayout_), scores: scoreRules_(), warnPct: warnPct_(), industries: industries_() };
}
