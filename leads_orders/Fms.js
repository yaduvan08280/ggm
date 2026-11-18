/*******************************************************
 * Fms.js — reads the two FMS sheets and writes step answers back into them.
 *
 * Layout comes from the sheet itself, so a renamed heading or an extra field
 * column is picked up without code changes:
 *   row 2 "What"  a block starts where a step name is written
 *   row 5 "When"  hours allowed (TAT) for the step
 *   row 6         headings: Planned · Actual · <status> · Time Delay · fields…
 *   row 7         formulas (never written by the app) and dropdowns (options)
 *******************************************************/

function fmsSheet_(fid) {
  var key = 'sh_' + fid;
  if (MEMO_[key]) return MEMO_[key];
  var f = FLOWS[fid], sh = (f.ssId ? SpreadsheetApp.openById(f.ssId) : appSs_()).getSheetByName(f.tab);
  if (!sh) throw new Error('Tab "' + f.tab + '" not found' + (f.ssId ? ' in the ' + f.title + ' sheet.' : ' in the app sheet (run the move to the app sheet first).'));
  return (MEMO_[key] = sh);
}

function colLetterToIdx_(s) {
  var n = 0;
  for (var i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
  return n - 1;
}

function hKey_(s) { return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }

/** Field type from its dropdown / heading. */
function fieldType_(head, dv) {
  var h = hKey_(head);
  if (dv && dv.type === 'list') return 'select';
  if (dv && dv.type === 'date') return 'date';
  if (/(^|\b)(date|dt\.?|eta|etd|edd)(\b|$)|date\b|\bdt\b|prev\. dt/.test(h)) return 'date';
  if (/charges?$/.test(h) || /^(amount|tons covered|weight loaded \(t\)|loaded \(t\)|balance \(t\))$/.test(h)) return 'number';   // "Courier Charges", cycle tons
  if (/remark|note/.test(h)) return 'textarea';
  if (/^(mob\.?|contact details|phone|mobile)/.test(h)) return 'tel';
  if (/mail/.test(h)) return 'email';
  if (/^(wt\.?|balance wt\.?)$/.test(h)) return 'number';
  return 'text';
}

/** Step layout of one flow (cached 6 h; dropped when columns change). */
function layout_(fid) {
  var key = 'lay_' + fid;
  if (MEMO_[key]) return MEMO_[key];
  var c = cacheGet_(key + LAY_V);
  if (c) return (MEMO_[key] = c);
  c = buildLayout_(fid);
  cachePut_(key + LAY_V, c, 21600);
  return (MEMO_[key] = c);
}

var LAY_V = '_v6';
/** legacy = read an old FMS sheet (Config tab) instead of the app sheet (Steps tab). */
function buildLayout_(fid, legacy) {
  var f = FLOWS[fid], sh = fmsSheet_(fid), ss = sh.getParent();
  var lastCol = sh.getLastColumn();
  var top = sh.getRange(1, 1, ROW.HEAD, lastCol).getDisplayValues();
  var tmpl = sh.getRange(ROW.FIRST, 1, 1, lastCol);
  var formulas = tmpl.getFormulas()[0], dvs = tmpl.getDataValidations()[0];
  var what = top[ROW.WHAT - 1], who = top[ROW.WHO - 1], how = top[ROW.HOW - 1], when = top[ROW.WHEN - 1], head = top[ROW.HEAD - 1];

  // dropdown options of a column
  var rangeMemo = {};
  function dvOf(i) {
    var dv = dvs[i];
    if (!dv) return null;
    var t = String(dv.getCriteriaType()), vals = dv.getCriteriaValues();
    if (t === 'VALUE_IN_LIST') return { type: 'list', options: (vals[0] || []).map(String).filter(String) };
    if (t === 'VALUE_IN_RANGE') {
      var rg = vals[0], k = rg.getSheet().getName() + '!' + rg.getA1Notation();
      if (!rangeMemo[k]) rangeMemo[k] = rg.getDisplayValues().reduce(function (a, r) { return a.concat(r); }, []).map(String).filter(function (s) { return s.trim(); });
      return { type: 'list', options: rangeMemo[k] };
    }
    if (t === 'DATE_IS_VALID_DATE') return { type: 'date' };
    return null;
  }

  // Config tab: step key + answer options per step
  var cfgRows = [], cal = { open: 10, close: 18, mask: '0000001', hol: [] };
  var hm = function (s) { var m = String(s).match(/^(\d{1,2}):(\d{2})/); return m ? Number(m[1]) + Number(m[2]) / 60 : null; };
  var stepsSh = !legacy && !f.ssId ? ss.getSheetByName('Steps') : null;
  var cfgSh = stepsSh ? null : ss.getSheetByName('Config');
  if (stepsSh && stepsSh.getLastRow() > 1) {
    // Steps tab: Flow · No. · Key · Step · Clock starts from · Answer 1…
    stepsSh.getRange(2, 1, stepsSh.getLastRow() - 1, Math.max(5, stepsSh.getLastColumn())).getDisplayValues().forEach(function (r) {
      if (hKey_(r[0]) !== hKey_(f.tab) || !String(r[2]).trim()) return;
      cfgRows.push({ key: String(r[2]).trim(), name: String(r[1]).trim() + '. ' + String(r[3]).trim(), from: String(r[4] || '').trim(),
                     options: r.slice(5).map(String).filter(function (s) { return s.trim(); }) });
    });
  }
  if (cfgSh) {
    var cv = cfgSh.getRange(1, 1, Math.min(40, Math.max(1, cfgSh.getLastRow())), Math.min(26, Math.max(4, cfgSh.getLastColumn()))).getDisplayValues();
    if (hm(cv[0] && cv[0][0]) != null) cal.open = hm(cv[0][0]);
    if (cv[1] && hm(cv[1][0]) != null) cal.close = hm(cv[1][0]);
    if (cv[2] && /^[01]{7}$/.test(String(cv[2][0]).trim())) cal.mask = String(cv[2][0]).trim();
    cv.forEach(function (r, i) {
      if (i === 0 || !String(r[3] || '').trim() || !String(r[4] || '').trim()) return;
      cfgRows.push({ key: String(r[3]).trim(), name: String(r[4]).trim(), options: r.slice(5).map(String).filter(function (s) { return s.trim(); }) });
    });
  }
  var hol = ss.getSheetByName('Holidays');
  if (hol && hol.getLastRow() > 0) {
    var hr = hol.getRange(1, 1, Math.min(300, hol.getLastRow()), 2), hd = hr.getDisplayValues();
    hr.getValues().forEach(function (r, i) {
      var lab = hKey_(hd[i][0]), v = String(hd[i][1] || '').trim();
      if (stepsSh && /^office opens/.test(lab)) { if (hm(v) != null) cal.open = hm(v); return; }
      if (stepsSh && /^office closes/.test(lab)) { if (hm(v) != null) cal.close = hm(v); return; }
      if (stepsSh && /^weekly off/.test(lab)) { if (/^[01]{7}$/.test(v)) cal.mask = v; return; }
      var t = r[0] instanceof Date ? r[0].getTime() : null;
      if (t) cal.hol.push(wDay(t));
    });
  }

  // blocks
  var starts = [];
  for (var c = 1; c < lastCol; c++) if (String(what[c] || '').trim()) starts.push(c);
  if (!starts.length) throw new Error('No step names found in row 2 of ' + f.title + '.');
  var base = [], firstStep = starts.length > 1 ? starts[1] : lastCol;
  for (var b = 0; b < firstStep; b++) {
    if (!String(head[b]).trim()) continue;
    var dvb = dvOf(b);
    base.push({ c: b, k: String(head[b]).trim(), t: b === 1 ? 'datetime' : fieldType_(head[b], dvb), o: dvb && dvb.options ? dvb.options : null,
                ro: b === 0 || b === 1 || !!formulas[b] });
  }
  // Columns filled by a formula in another cell (Order → Delivery: B7 =FILTER('Form responses 1'!$A$2:$O, …) fills B:P).
  // A typed value there breaks the formula (#REF!) and the data vanishes, so they are never written here;
  // their edits go to the source tab instead.
  var source = null;
  base.forEach(function (fl) {
    var fm = String(formulas[fl.c] || '');
    var m = fm.match(/^=\s*(?:FILTER|QUERY|SORT|UNIQUE)\(\s*'?([^'!]+)'?!\$?([A-Z]{1,3})\$?(\d+):\$?([A-Z]{1,3})/i);
    if (m && !source) source = { tab: m[1], c0: fl.c, key: colLetterToIdx_(m[2]), row0: Number(m[3]), width: colLetterToIdx_(m[4]) - colLetterToIdx_(m[2]) + 1 };
    else if (/^=\s*(ARRAYFORMULA|FILTER|QUERY|SORT|UNIQUE|IMPORTRANGE|\{)/i.test(fm)) fl.ro = true;
  });
  if (source) base.forEach(function (fl) {
    if (fl.c >= source.c0 && fl.c < source.c0 + source.width) { fl.ro = true; fl.sp = 1; fl.src = source.key + (fl.c - source.c0); }
  });

  var steps = [];
  for (var s = 1; s < starts.length; s++) {
    var from = starts[s], to = s + 1 < starts.length ? starts[s + 1] - 1 : lastCol - 1;
    var title = String(what[from]).replace(/\s+/g, ' ').trim();
    var num = (title.match(/\((\d+[A-Z]?)\)\s*$/i) || [])[1] || String(s + 1);
    var name = title.replace(/\(\d+[A-Z]?\)\s*$/i, '').trim();
    var cols = { p: -1, a: -1, s: -1, d: -1 }, fields = [];
    for (var i = from; i <= to; i++) {
      var h = hKey_(head[i]);
      if (cols.p < 0 && h === 'planned') { cols.p = i; continue; }
      if (cols.a < 0 && h === 'actual') { cols.a = i; continue; }
      if (cols.a >= 0 && cols.s < 0 && i === cols.a + 1 && h !== 'time delay') { cols.s = i; continue; }
      if (/^time delay/.test(h)) { cols.d = i; continue; }
      if (!h) continue;
      var dv = dvOf(i);
      fields.push({ c: i, k: String(head[i]).trim(), t: fieldType_(head[i], dv), o: dv && dv.options ? dv.options : null, ro: !!formulas[i],
                    arr: /^=\s*ARRAYFORMULA/i.test(formulas[i] || '') });
    }
    if (cols.p < 0 || cols.a < 0) continue;      // not a step block
    // key + options from the Config tab (matched by number "(2)" / "2." or by name)
    var cfg = null;
    cfgRows.forEach(function (r) {
      if (cfg) return;
      var rn = (r.name.match(/^(\d+[A-Z]?)\./i) || r.name.match(/\((\d+[A-Z]?)\)\s*$/i) || [])[1];
      if ((rn && rn.toUpperCase() === num.toUpperCase()) || hKey_(r.name) === hKey_(title)) cfg = r;
    });
    var sdv = cols.s >= 0 ? dvOf(cols.s) : null;
    var opts = cfg && cfg.options.length ? cfg.options : (sdv && sdv.options ? sdv.options : ['Done']);
    // deadline anchor: the cell the Planned formula starts from
    var fm = String(formulas[cols.p] || ''), anchor = null;
    var m = fm.match(/_start\s*,\s*\$?([A-Z]{1,3})\$?\d+/i) || fm.match(/ISBLANK\(\s*\$?([A-Z]{1,3})\$?\d+\s*\)/i);
    if (m) anchor = colLetterToIdx_(m[1].toUpperCase());
    steps.push({
      key: cfg ? cfg.key : 'S' + num.toUpperCase(), num: num, title: name, who: String(who[from] || '').trim(), how: String(how[from] || '').trim(),
      tat: parseFloat(String(when[from]).replace(',', '.')), p: cols.p, a: cols.a, s: cols.s, d: cols.d,
      statusHead: cols.s >= 0 ? String(head[cols.s]).trim() : 'Status', opts: opts, fields: fields, anchor: anchor, fromText: cfg && cfg.from || ''
    });
  }
  // fields the app fills itself (cycle summaries, trucks) are read-only; a cycle's own details come from its order
  steps.forEach(function (st) {
    var af = ((APP_FIELDS[fid] || {})[st.key] || []).map(hKey_);
    st.fields.forEach(function (fl) { if (af.indexOf(hKey_(fl.k)) > -1) fl.ro = true; });
  });
  if (FLOWS[fid].parent) base.forEach(function (b) { b.ro = true; });
  // anchor column → which step's Actual (or which field) starts the clock
  steps.forEach(function (st, i) {
    var a = st.anchor, ref = null, ft = st.fromText, m2;
    if (a == null && ft) {                       // Steps tab: "Timestamp" · "<KEY> Actual" · "<KEY>: <field>"
      if (hKey_(ft) === 'timestamp') ref = { base: 1 };
      else if ((m2 = ft.match(/^(\S+)\s+actual$/i)) && stepByKey_({ steps: steps }, m2[1])) ref = { step: m2[1], actual: true };
      else if ((m2 = ft.match(/^([^:]+):\s*(.+)$/))) ref = { step: m2[1].trim(), field: m2[2].trim() };
    }
    if (ref) { /* from the Steps tab */ }
    else if (a == null) ref = i ? { step: steps[i - 1].key, actual: true } : { base: 1 };
    else if (a === 1) ref = { base: 1 };
    else steps.forEach(function (o) {
      if (o.a === a) ref = { step: o.key, actual: true };
      o.fields.forEach(function (fl) { if (fl.c === a) ref = { step: o.key, field: fl.k }; });
    });
    st.from = ref || (i ? { step: steps[i - 1].key, actual: true } : { base: 1 });
    delete st.fromText;
    if (!(st.tat >= 0)) st.tat = 8;
  });
  return { fid: fid, gid: sh.getSheetId(), cols: lastCol, base: base, steps: steps, cal: cal, source: source, formulaCols: formulas.map(function (x, i) { return x && !/^=\s*ARRAYFORMULA/i.test(x) ? i : -1; }).filter(function (i) { return i >= 0; }) };
}

function stepByKey_(lay, key) {
  for (var i = 0; i < lay.steps.length; i++) if (lay.steps[i].key === key) return lay.steps[i];
  return null;
}
function fieldOf_(lay, ref) {           // 'base:Head' | 'KEY:Head' | 'KEY:@status'
  var i = ref.indexOf(':'), sk = ref.slice(0, i), h = hKey_(ref.slice(i + 1));
  var list = sk === 'base' ? lay.base : ((stepByKey_(lay, sk) || {}).fields || []);
  for (var j = 0; j < list.length; j++) if (hKey_(list[j].k) === h) return list[j];
  return null;
}

/* ---------------------------------------------------------------- step settings (layout + admin choices) */

function stepCfg_(fid) {
  var key = 'scfg_' + fid;
  if (MEMO_[key]) return MEMO_[key];
  var lay = layout_(fid), saved = (settings_().steps || {})[fid] || {}, rules = (settings_().rules || {})[fid] || DEFAULT_RULES[fid] || {};
  var out = {};
  lay.steps.forEach(function (st) {
    var sv = saved[st.key] || {};
    var dflOwner = fid === 'L2O' || /SALES/i.test(st.who);
    out[st.key] = {
      label: sv.label || (DEFAULT_LABELS[fid] || {})[st.key] || st.title,
      ownerActs: sv.ownerActs != null ? !!sv.ownerActs : dflOwner,
      doers: Array.isArray(sv.doers) ? sv.doers : [],
      required: Array.isArray(sv.required) ? sv.required : ((DEFAULT_REQUIRED[fid] || {})[st.key] || []),
      card: Array.isArray(sv.card) ? sv.card : ((DEFAULT_CARD[fid] || {})[st.key] || []),   // saved empty = the Admin wants no details
      side: sv.side != null ? sv.side : ((DEFAULT_SIDE[fid] || {})[st.key] || ''),
      photo: sv.photo != null ? !!sv.photo : (DEFAULT_PHOTO_STEPS[fid] || []).indexOf(st.key) > -1,
      rules: rules[st.key] || {}
    };
  });
  return (MEMO_[key] = out);
}

function fieldRules_(fid) {
  var v = (settings_().fieldRules || {})[fid];
  return Array.isArray(v) ? v : (DEFAULT_FIELD_RULES[fid] || []);
}

/* ---------------------------------------------------------------- reading rows */

function cellOut_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : v.getTime();
  if (typeof v === 'string') return v.replace(/\\r$/, '').trim();
  return v;
}

/** [{ r: sheet row, id, b: {head: value}, s: {KEY: {p, a, s, f: {head: value}}} }] */
function readFlow_(fid) {
  var key = 'rd_' + fid;
  if (MEMO_[key]) return MEMO_[key];
  var lay = layout_(fid), sh = fmsSheet_(fid), last = sh.getLastRow();
  if (last < ROW.FIRST) return (MEMO_[key] = []);
  var ids = sh.getRange(ROW.FIRST, 1, last - ROW.FIRST + 1, 1).getDisplayValues();
  var n = 0;
  for (var i = ids.length - 1; i >= 0; i--) if (String(ids[i][0]).trim()) { n = i + 1; break; }
  if (!n) return (MEMO_[key] = []);
  var vals = sh.getRange(ROW.FIRST, 1, n, lay.cols).getValues();
  var out = [];
  vals.forEach(function (row, i) {
    var id = String(row[0]).trim();
    if (!id) return;
    var b = {}, s = {};
    lay.base.forEach(function (fl) { var v = cellOut_(row[fl.c]); if (v !== '' && v != null) b[fl.k] = v; });
    lay.steps.forEach(function (st) {
      var o = { p: msOf_(row[st.p]), a: msOf_(row[st.a]), s: st.s >= 0 ? cellOut_(row[st.s]) : '', f: {} };
      if (typeof row[st.a] === 'string' && row[st.a].trim() && !o.a) o.a = Date.now();   // "Done" typed into Actual
      st.fields.forEach(function (fl) { var v = cellOut_(row[fl.c]); if (v !== '' && v != null) o.f[fl.k] = v; });
      if (o.s === '' ) delete o.s;
      s[st.key] = o;
    });
    out.push({ r: ROW.FIRST + i, id: id, b: b, s: s });
  });
  return (MEMO_[key] = out);
}

/** Value behind a card / condition reference for one lead. */
function refVal_(lead, ref) {
  var i = ref.indexOf(':'), sk = ref.slice(0, i), h = ref.slice(i + 1);
  if (sk === 'base') return pick_(lead.b, h);
  var s = lead.s[sk];
  if (!s) return '';
  if (h === '@status') return s.s || '';
  if (h === '@actual') return s.a || '';
  return pick_(s.f, h);
}
function pick_(obj, h) {
  if (obj[h] != null) return obj[h];
  var k = hKey_(h);
  for (var x in obj) if (hKey_(x) === k) return obj[x];
  return '';
}

/* ---------------------------------------------------------------- where each lead stands */

/**
 * Adds: cur (open main step), side (open side steps), plan per step, closed, owner.
 * Closed: a "lost"/"won" answer with an Actual, the last step done, or closed in the app.
 */
function decorate_(fid, lead, lay, scfg, state, nowMs) {
  var st = state[lead.id] || {}, steps = lay.steps, owner = pick_(lead.b, FLOWS[fid].owner);
  var closed = null, cur = null, side = [];
  steps.forEach(function (step, i) {
    var x = lead.s[step.key], isLast = i === steps.length - 1;
    // effective deadline: sheet's Planned, or restarted clock after a send-back
    var rs = st['restart:' + step.key];
    var anchorVal = step.from.base ? msOf_(lead.b.Timestamp || pick_(lead.b, 'Timestamp')) :
      step.from.actual ? (lead.s[step.from.step] || {}).a : msOf_(refVal_(lead, step.from.step + ':' + step.from.field));
    if (!anchorVal && !step.from.base && !step.from.actual && !scfg[step.key].side) {
      // clock starts from a date field that was left empty (old rows without "Ready by"): count from the step before
      for (var j = i - 1; j >= 0; j--) if (!scfg[steps[j].key].side) { anchorVal = (lead.s[steps[j].key] || {}).a; break; }
    }
    if ((NO_CLOCK[fid] || {})[step.key]) x.p = null;                // no deadline (e.g. the order while its cycles run)
    else if (rs && (!anchorVal || rs > anchorVal)) x.p = workAdd(rs, step.tat, lay.cal);
    else if (!x.p && anchorVal) x.p = workAdd(anchorVal, step.tat, lay.cal);
    if (closed) return;
    if (x.a) {
      var r = ruleOf(scfg[step.key].rules, step.key, x.s || '', isLast && !scfg[step.key].side);
      if (r === 'lost' || r === 'won') closed = { o: r, at: x.a, step: step.key, why: x.s || '' };
      return;
    }
    if (scfg[step.key].side) {                       // beside the main line: only when its field has a value
      var prev = step.from.actual ? (lead.s[step.from.step] || {}).a : anchorVal;
      var cond = refVal_(lead, scfg[step.key].side);
      var cs = cond == null ? '' : String(cond).trim();          // a number must be above 0 (balance -0.14 = nothing left)
      if (prev && cs !== '' && !(/^-?[\d.,]+$/.test(cs) && !(Number(cs.replace(/,/g, '')) > 0))) side.push(step.key);
      return;
    }
    if (!cur) cur = step.key;
  });
  if (!closed && !cur) {
    var lastMain = steps.filter(function (s) { return !scfg[s.key].side; }).pop();
    closed = { o: 'won', at: lastMain ? (lead.s[lastMain.key] || {}).a : null, step: lastMain ? lastMain.key : '', why: 'Done' };
  }
  if (st.closed && st.closed.o) closed = { o: st.closed.o, at: st.closed.at, step: st.closed.step || cur || '', why: st.closed.why || '', by: st.closed.by || '', app: 1 };
  if (closed) { cur = null; side = []; }
  lead.cur = cur;
  lead.side = side;
  lead.closed = closed;
  lead.owner = String(owner || '');
  lead.ind = st.industry || '';
  lead.link = st.link || '';
  lead.rs = {};
  Object.keys(st).forEach(function (k) { if (k.indexOf('restart:') === 0) lead.rs[k.slice(8)] = st[k]; });
  return lead;
}

/* ---------------------------------------------------------------- writing */

/** Sheet row of a lead, checked against column A (rows can move if someone sorts the sheet). */
function findRow_(fid, id) {
  var sh = fmsSheet_(fid), last = sh.getLastRow();
  var ids = sh.getRange(ROW.FIRST, 1, Math.max(1, last - ROW.FIRST + 1), 1).getDisplayValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]).trim() === id) return ROW.FIRST + i;
  throw new Error(id + ' was not found in the ' + FLOWS[fid].title + ' sheet. Refresh and try again.');
}

/** Input from the page → the value written to the cell. */
function cellIn_(fl, v) {
  if (v == null) return '';
  if (fl.t === 'date' || fl.t === 'datetime') {
    if (v === '') return '';
    var d = typeof v === 'number' ? new Date(v) : (/^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + 'T00:00:00+05:30') : new Date(v));
    if (isNaN(d.getTime())) throw new Error(fl.k + ': not a valid date.');
    return d;
  }
  if (fl.t === 'number') { var s = String(v).trim(); if (s === '') return ''; var n = Number(s); return isNaN(n) ? s : n; }
  return String(v).slice(0, 5000);
}

/** Writes several cells of one row: { colIdx: value }. */
function writeCells_(fid, row, cells) {
  var sh = fmsSheet_(fid), lay = layout_(fid);
  lay.base.forEach(function (fl) {
    if (fl.sp && Object.prototype.hasOwnProperty.call(cells, String(fl.c))) throw new Error('"' + fl.k + '" is filled by a formula in the sheet; it is changed in "' + lay.source.tab + '".');
  });
  Object.keys(cells).forEach(function (c) {
    var rg = sh.getRange(row, Number(c) + 1), v = cells[c];
    rg.setValue(v);
  });
}

/** Next "ORD-###" (one more than the highest number in column A). */
function nextId_(fid) {
  var max = 0, pre = 'ORD-', width = 3;
  readFlow_(fid).forEach(function (l) {
    var m = l.id.match(/^(.*?)(\d+)$/);
    if (m && Number(m[2]) > max) { max = Number(m[2]); pre = m[1]; width = m[2].length; }
  });
  var n = String(max + 1);
  while (n.length < width) n = '0' + n;
  return pre + n;
}

/** First empty row under the data; formulas copied from row 7 when the row has none. */
function newRow_(fid) {
  var lay = layout_(fid), sh = fmsSheet_(fid), data = readFlow_(fid);
  var r = data.length ? data[data.length - 1].r + 1 : ROW.FIRST;
  var a = sh.getRange(r, 1).getDisplayValue();
  if (String(a).trim()) throw new Error('The row after the last ' + FLOWS[fid].unit + ' is not empty. Ask the admin to check the sheet.');
  if (r > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 20);
  var tmpl = sh.getRange(ROW.FIRST, 1, 1, lay.cols).getFormulasR1C1()[0], have = sh.getRange(r, 1, 1, lay.cols).getFormulas()[0];
  lay.formulaCols.forEach(function (c) { if (!have[c] && tmpl[c]) sh.getRange(r, c + 1).setFormulaR1C1(tmpl[c]); });
  return r;
}

/* ---------------------------------------------------------------- source tab (Form responses 1) */

function srcSheet_(fid) {
  var lay = layout_(fid);
  if (!lay.source) return null;
  var sh = fmsSheet_(fid).getParent().getSheetByName(lay.source.tab);
  if (!sh) throw new Error('Tab "' + lay.source.tab + '" not found.');
  return sh;
}

/** The source-tab row behind a sheet row: the FILTER keeps the non-empty rows in order. Checked on the timestamp. */
function srcRowOf_(fid, lead) {
  var lay = layout_(fid), src = lay.source, sh = srcSheet_(fid), n = sh.getLastRow() - src.row0 + 1;
  if (n < 1) throw new Error('The source tab is empty.');
  var keys = sh.getRange(src.row0, src.key + 1, n, 1).getValues(), k = lead.r - ROW.FIRST, seen = 0;
  for (var i = 0; i < keys.length; i++) {
    if (keys[i][0] === '' || keys[i][0] == null) continue;
    if (seen === k) {
      var ts = msOf_(keys[i][0]), want = msOf_(lead.b.Timestamp);
      if (ts && want && Math.abs(ts - want) > 1500) throw new Error(lead.id + ': the sheet and "' + src.tab + '" do not line up. Nothing was changed.');
      return src.row0 + i;
    }
    seen++;
  }
  throw new Error(lead.id + ' was not found in "' + src.tab + '".');
}

/** Writes base fields: plain columns in the FMS row, formula-filled ones in the source row. map = { colIdx: value } */
function writeBase_(fid, lead, map) {
  var lay = layout_(fid), direct = {}, srcCells = {};
  Object.keys(map).forEach(function (c) {
    var fl = lay.base.filter(function (b) { return String(b.c) === String(c); })[0];
    if (fl && fl.sp) { if (fl.src != null) srcCells[fl.src] = map[c]; }
    else direct[c] = map[c];
  });
  if (Object.keys(direct).length) writeCells_(fid, lead.r, direct);
  if (Object.keys(srcCells).length) {
    var sh = srcSheet_(fid), row = srcRowOf_(fid, lead);
    Object.keys(srcCells).forEach(function (c) { sh.getRange(row, Number(c) + 1).setValue(srcCells[c]); });
    SpreadsheetApp.flush();
  }
}
