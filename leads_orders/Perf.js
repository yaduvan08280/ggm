/*******************************************************
 * Perf.js — per-person performance: score (+ / −), steps on time, trends,
 * daily opens and screen time. Built from Events, Activity and the FMS rows
 * themselves (steps finished in the sheet before the app existed are credited
 * to the lead's owner, marked "from sheet").
 *******************************************************/

function isoOf_(ms) { return Utilities.formatDate(new Date(ms), 'Asia/Kolkata', 'yyyy-MM-dd'); }
function dayStartMs_(iso) { return new Date(iso + 'T00:00:00+05:30').getTime(); }

/** Users who are responsible for a tile (assigned doers, or the owner where the owner acts). */
function responsible_(fid, lead, stepKey, users) {
  var c = stepCfg_(fid)[stepKey];
  if (!c) return [];
  var out = {};
  c.doers.forEach(function (d) { out[String(d).toLowerCase()] = 1; });
  if (c.ownerActs) users.forEach(function (u) { if (isOwner_(u, lead)) out[u.username.toLowerCase()] = 1; });
  return Object.keys(out);
}

/** Every open tile with its state, for counts per person. */
function openTiles_() {
  var users = Object.keys(ggmRows_()).map(function (k) { return ggmRows_()[k]; }), now = Date.now(), out = [];
  FLOW_IDS.forEach(function (fid) {
    var lay = layout_(fid), wp = warnPct_();
    boardData_(fid).leads.forEach(function (l) {
      (l.cur ? [l.cur] : []).concat(l.side || []).forEach(function (k) {
        var st = stepByKey_(lay, k), x = l.s[k] || {};
        out.push({ fid: fid, id: l.id, step: k, due: dueState(x.p, st.tat, now, lay.cal, wp), resp: responsible_(fid, l, k, users), lead: l });
      });
    });
  });
  return out;
}

/** Called every evening: each tile still overdue costs its responsible people points. */
function dailyOverdue() {
  var cal = layout_('L2O').cal, today = wDay(Date.now());
  if (!wIsWork(today, cal)) return;
  var p = PropertiesService.getScriptProperties(), flag = 'OVD_' + isoOf_(Date.now());
  if (p.getProperty(flag)) return;
  p.setProperty(flag, '1');
  var rows = ggmRows_(), per = {};
  openTiles_().forEach(function (t) {
    if (t.due !== 'over') return;
    t.resp.forEach(function (u) { (per[u] = per[u] || []).push(t.fid + ' ' + t.id + ' · ' + t.step); });
  });
  Object.keys(per).forEach(function (u) {
    var who = rows[u] || { username: u, name: u };
    append_(TABS.EVENTS, [new Date(), who.username, who.name, '', '', '', 'OVERDUE', per[u].length, '', '', '', who.username, JSON.stringify({ tiles: per[u].slice(0, 200) })]);
  });
}

/**
 * opts = { from: 'yyyy-MM-dd', to: 'yyyy-MM-dd', user: username | '*' }
 * Executives always get their own numbers.
 */
function perfData(token, opts) {
  var me = staff_(token);
  opts = opts || {};
  var role = roleOf_(me), today = isoOf_(Date.now());
  var to = /^\d{4}-\d{2}-\d{2}$/.test(opts.to || '') ? opts.to : today;
  var from = /^\d{4}-\d{2}-\d{2}$/.test(opts.from || '') ? opts.from : isoOf_(Date.now() - 29 * 864e5);
  if (from > to) { var x = from; from = to; to = x; }
  var who = role === 'exec' ? me.username.toLowerCase() : String(opts.user || me.username).toLowerCase();
  var key = 'perf_' + from + to + who + boardVer_() + (opts.v || '');
  var c = cacheGet_(key);
  if (c) return c;
  var all = ledger_(from, to);
  var res = who === '*' ? { team: teamRows_(all), from: from, to: to } : personView_(all, who, from, to);
  res.from = from; res.to = to; res.user = who;
  if (role !== 'exec') res.users = userList_();
  cachePut_(key, res, 240);
  return res;
}

/** Score lines for everybody in the period: [{ u, day, k, pts, t, txt }] + per-person facts. */
function ledger_(from, to) {
  var rules = scoreRules_(), t0 = dayStartMs_(from), t1 = dayStartMs_(to) + 864e5;
  var rows = ggmRows_(), users = Object.keys(rows).map(function (k) { return rows[k]; });
  var lines = [], facts = {}, caps = {};
  function F(u) { u = String(u || '').toLowerCase(); return facts[u] || (facts[u] = { done: 0, onTime: 0, late: 0, lateHrs: 0, follow: 0, notes: 0, photos: 0, created: 0, won: 0, lost: 0, rework: 0, overdue: 0, sheet: 0, events: [] }); }
  function add(u, t, k, mult, txt, capKey, cap) {
    if (!u || !rules[k] || !rules[k].pts) return;
    u = String(u).toLowerCase();
    var day = isoOf_(t);
    if (capKey) { var ck = u + day + capKey; caps[ck] = (caps[ck] || 0) + 1; if (caps[ck] > cap) return; }
    lines.push({ u: u, day: day, k: k, pts: rules[k].pts * (mult || 1), t: t, txt: txt || '' });
  }
  var doneSeen = {}, closeSeen = {};
  rows_(TABS.EVENTS).forEach(function (r) {
    var e = eventObj_(r);
    if (e.a === 'DONE') doneSeen[e.f + '|' + e.id + '|' + e.st] = 1;
    if (e.a === 'WON' || e.a === 'LOST') closeSeen[e.f + '|' + e.id] = 1;
    if (!(e.t >= t0 && e.t < t1)) return;
    var ref = e.f && e.id ? e.f + ' ' + e.id + (e.st ? ' · ' + e.st : '') : '';
    switch (e.a) {
      case 'DONE':
        F(e.u).done++;
        if (e.ot === false) {
          F(e.u).late++; F(e.u).lateHrs += e.late;
          add(e.u, e.t, 'step_late', 1, ref);
          add(e.u, e.t, 'late_hour', Math.min(15, Math.ceil(e.late)), ref + ' (' + Math.round(e.late * 10) / 10 + ' h late)');
        } else { F(e.u).onTime++; add(e.u, e.t, 'step_on_time', 1, ref); }
        break;
      case 'FOLLOWUP': F(e.u).follow++; add(e.u, e.t, 'follow_up', 1, ref + ' ' + e.v, 'fu', 20); break;
      case 'NOTE': F(e.u).notes++; add(e.u, e.t, 'note', 1, ref, 'note', 10); break;
      case 'PHOTO': F(e.u).photos++; add(e.u, e.t, 'photo', 1, ref, 'photo', 10); break;
      case 'CREATE':
        F(e.u).created++;
        add(e.u, e.t, /^From lead/.test(e.v) ? 'order_created' : 'lead_created', 1, ref);
        break;
      case 'WON': F(e.ou || e.u).won++; add(e.ou || e.u, e.t, 'won', 1, ref); break;
      case 'LOST': F(e.ou || e.u).lost++; add(e.ou || e.u, e.t, 'lost', 1, ref + ' ' + e.v); break;
      case 'BACK':
        var b = e.d && e.d.blame;
        if (b) { F(b).rework++; add(b, e.t, 'rework', 1, ref + ' → ' + e.to + ': ' + e.v); }
        break;
      case 'OVERDUE': F(e.u).overdue += Number(e.v) || 0; add(e.u, e.t, 'overdue_day', Number(e.v) || 0, (Number(e.v) || 0) + ' overdue tile(s)'); break;
    }
    if (e.a !== 'OVERDUE' && e.a !== 'SETTINGS') F(e.u).events.push(e);
  });

  // steps finished in the sheet itself (no app event): credited to the lead's owner
  FLOW_IDS.forEach(function (fid) {
    var lay = layout_(fid), scfg = stepCfg_(fid);
    boardData_(fid).leads.forEach(function (l) {
      var owners = usersForName_(l.owner);
      lay.steps.forEach(function (st) {
        var x = l.s[st.key] || {};
        if (!x.a || !(x.a >= t0 && x.a < t1) || doneSeen[fid + '|' + l.id + '|' + st.key]) return;
        if (fid === 'CYC' && doneSeen['O2D|' + String(pick_(l.b, 'Order No')).trim() + '|' + st.key]) return;   // answered before the move to cycles
        var ref = fid + ' ' + l.id + ' · ' + st.key + ' (from sheet)';
        owners.slice(0, 1).forEach(function (u) {
          var late = x.p && x.a > x.p ? workHours(x.p, x.a, lay.cal) : 0;
          F(u).done++; F(u).sheet++;
          if (late > 0.01) { F(u).late++; F(u).lateHrs += late; add(u, x.a, 'step_late', 1, ref); add(u, x.a, 'late_hour', Math.min(15, Math.ceil(late)), ref); }
          else { F(u).onTime++; add(u, x.a, 'step_on_time', 1, ref); }
        });
      });
      if (fid !== 'CYC' && l.closed && l.closed.at && l.closed.at >= t0 && l.closed.at < t1 && !closeSeen[fid + '|' + l.id] && (fid === 'L2O' || l.closed.o === 'won')) {
        owners.slice(0, 1).forEach(function (u) { F(u)[l.closed.o]++; add(u, l.closed.at, l.closed.o, 1, fid + ' ' + l.id + ' (from sheet)'); });
      }
    });
  });

  // opens and screen time
  var act = {}, firstDay = {};
  rows_(TABS.ACTIVITY).forEach(function (r) {
    var iso = r[0] instanceof Date ? isoOf_(r[0].getTime()) : String(r[0]).trim(), u = String(r[1]).toLowerCase();
    if (!u || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return;
    if (!firstDay[u] || iso < firstDay[u]) firstDay[u] = iso;
    if (iso < from || iso > to) return;
    var a = act[u] || (act[u] = {});
    var d = a[iso] || (a[iso] = { opens: 0, secs: 0, last: 0 });
    d.opens += Number(r[3]) || 0; d.secs += Number(r[4]) || 0; d.last = Math.max(d.last, msOf_(r[6]) || 0);
  });
  var cal = layout_('L2O').cal, today = isoOf_(Date.now());
  Object.keys(act).forEach(function (u) {
    Object.keys(act[u]).forEach(function (iso) {
      var d = act[u][iso], t = dayStartMs_(iso) + 12 * 3600000;
      if (!wIsWork(wDay(t), cal)) return;
      if (d.opens > 0 || d.secs > 0) add(u, t, 'login_day', 1, iso);
      if (d.secs >= 7200) add(u, t, 'active_2h', 1, iso + ' (' + Math.round(d.secs / 360) / 10 + ' h)');
    });
  });
  users.forEach(function (uo) {
    var u = uo.username.toLowerCase(), fd = firstDay[u];
    if (!fd) return;
    for (var t = dayStartMs_(from > fd ? from : fd) + 12 * 3600000; t < t1; t += 864e5) {
      var iso = isoOf_(t);
      if (iso >= today) break;
      if (!wIsWork(wDay(t), cal)) continue;
      if (!(act[u] && act[u][iso])) add(u, t, 'absent_day', 1, iso);
    }
  });
  return { lines: lines, facts: facts, act: act, users: users, from: from, to: to };
}

function sumScore_(lines, u) {
  var pos = 0, neg = 0;
  lines.forEach(function (l) { if (l.u !== u) return; if (l.pts > 0) pos += l.pts; else neg += l.pts; });
  return { pos: pos, neg: neg, score: pos + neg };
}

function openNow_(u) {
  var n = 0, over = 0, warn = 0;
  openTiles_().forEach(function (t) {
    if (t.resp.indexOf(u) < 0) return;
    n++; if (t.due === 'over') over++; else if (t.due === 'warn') warn++;
  });
  return { open: n, over: over, warn: warn };
}

function teamRows_(all) {
  var tiles = openTiles_();
  return all.users.map(function (uo) {
    var u = uo.username.toLowerCase(), f = all.facts[u] || {}, s = sumScore_(all.lines, u), a = all.act[u] || {};
    var days = Object.keys(a), secs = days.reduce(function (x, d) { return x + a[d].secs; }, 0);
    var last = days.reduce(function (x, d) { return Math.max(x, a[d].last); }, 0);
    var mine = tiles.filter(function (t) { return t.resp.indexOf(u) > -1; });
    return { u: uo.username, n: uo.name, role: roleOf_(uo), score: s.score, pos: s.pos, neg: s.neg, done: f.done || 0,
             onTimePct: f.done ? Math.round(100 * (f.onTime || 0) / f.done) : null, won: f.won || 0, lost: f.lost || 0,
             open: mine.length, over: mine.filter(function (t) { return t.due === 'over'; }).length,
             secsPerDay: days.length ? Math.round(secs / days.length) : 0, days: days.length, last: last || null };
  }).sort(function (a, b) { return b.score - a.score; });
}

function personView_(all, u, from, to) {
  var f = all.facts[u] || { events: [] }, s = sumScore_(all.lines, u), a = all.act[u] || {};
  var days = [], t1 = dayStartMs_(to);
  for (var t = dayStartMs_(from); t <= t1; t += 864e5) {
    var iso = isoOf_(t + 3600000);
    days.push({ d: iso, pos: 0, neg: 0, onTime: 0, late: 0, secs: a[iso] ? a[iso].secs : 0, opens: a[iso] ? a[iso].opens : 0 });
  }
  var byDay = {};
  days.forEach(function (d) { byDay[d.d] = d; });
  var br = {};
  all.lines.forEach(function (l) {
    if (l.u !== u) return;
    var d = byDay[l.day];
    if (d) { if (l.pts > 0) d.pos += l.pts; else d.neg += l.pts; if (l.k === 'step_on_time') d.onTime++; if (l.k === 'step_late') d.late++; }
    var b = br[l.k] || (br[l.k] = { k: l.k, label: (DEFAULT_SCORES[l.k] || {}).label || l.k, count: 0, pts: 0, last: [] });
    b.count++; b.pts += l.pts; if (b.last.length < 6) b.last.push(l.txt);
  });
  var secs = Object.keys(a).reduce(function (x, d) { return x + a[d].secs; }, 0), dayN = Object.keys(a).length;
  var uo = ggmRows_()[u] || { username: u, name: u };
  var now = openNow_(u);
  return {
    person: { u: uo.username, n: uo.name, role: roleOf_(uo), sheet: sheetName_(uo, 'L2O') },
    kpi: { score: s.score, pos: s.pos, neg: s.neg, done: f.done || 0, onTime: f.onTime || 0, late: f.late || 0,
           onTimePct: f.done ? Math.round(100 * (f.onTime || 0) / f.done) : null, avgLate: f.late ? Math.round(10 * f.lateHrs / f.late) / 10 : 0,
           follow: f.follow || 0, notes: f.notes || 0, photos: f.photos || 0, created: f.created || 0, won: f.won || 0, lost: f.lost || 0,
           conv: (f.won || 0) + (f.lost || 0) ? Math.round(100 * (f.won || 0) / ((f.won || 0) + (f.lost || 0))) : null,
           rework: f.rework || 0, fromSheet: f.sheet || 0, open: now.open, over: now.over, warn: now.warn,
           secs: secs, secsPerDay: dayN ? Math.round(secs / dayN) : 0, daysActive: dayN },
    days: days,
    breakdown: Object.keys(br).map(function (k) { return br[k]; }).sort(function (x, y) { return Math.abs(y.pts) - Math.abs(x.pts); }),
    recent: (f.events || []).sort(function (x, y) { return y.t - x.t; }).slice(0, 40)
  };
}
