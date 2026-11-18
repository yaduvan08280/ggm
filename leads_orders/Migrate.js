/*******************************************************
 * Migrate.js — the app's own backend: everything lives in this one spreadsheet.
 *
 *   LEADS / ORDERS   one row per lead / order, laid out like the old FMS sheets
 *                    (row 2 What · 3 Who · 4 How · 5 When (hours) · 6 headings · data from row 7),
 *                    plain values only: no formulas, so nothing can spill or break.
 *   Steps            step key, clock start and answer options of every step
 *   Holidays         office hours, weekly off and holidays (deadline maths)
 *
 *   migrateToAppSheet_()  one-time copy of both old FMS sheets (cleaned + formatted; done 15 Nov 2026)
 *   New leads and orders are entered in the app only (no Google Forms).
 *   formatSideTabs_()     colours of the other tabs
 *******************************************************/

var DROP_COLS = { L2O: [], O2D: [/^material grade\s*\(/i, /^delay days$/i, /^est\. date \(one day bef\)$/i] };
var TH = {
  ink: '#1C1917', ink2: '#2B2620', ink3: '#57534E', honey: '#F5B841', honeyDk: '#B7791F', white: '#FFFFFF',
  band: '#FFF8E8', tintA: '#FCE7B2', tintB: '#F7D88F', softA: '#FFF4D6', softB: '#FDEBC2', baseTop: '#3B342C',
  red: '#B42318', redBg: '#FDECEA', green: '#17663E', greenBg: '#E3F3EA', amberBg: '#FFF1CC'
};
var GOOD_WORDS = ['Done', 'Yes', 'SUCCESS', 'Passed', 'Delivered', 'Full Advance'];
var BAD_WORDS = ['No', 'FAILED', 'Failed', 'Order Reject', 'Close Inquiry', 'Cancelled', 'Wrong Number', 'Rate Issue', 'Quality Issue', 'Un Delivered'];

function legacySheet_(fid) {
  var lg = FLOWS[fid].legacy, sh = SpreadsheetApp.openById(lg.ssId).getSheetByName(lg.tab);
  if (!sh) throw new Error('Old tab "' + lg.tab + '" not found.');
  return sh;
}
/** Step layout of the old FMS sheet (read with the same code as before). */
function legacyLayout_(fid) {
  var k = 'sh_' + fid, keep = MEMO_[k];
  MEMO_[k] = legacySheet_(fid);
  try { return buildLayout_(fid, true); } finally { if (keep) MEMO_[k] = keep; else delete MEMO_[k]; }
}
function cleanVal_(v) {
  if (typeof v === 'string') { v = v.replace(/\r/g, '').trim(); if (/^#(N\/A|REF!|VALUE!|DIV\/0!|NAME\?|NUM!|ERROR!|NULL!)/i.test(v)) return ''; }
  if (v instanceof Date && isNaN(v.getTime())) return '';
  return v;
}

/* ---------------------------------------------------------------- one-time copy */

function migrateToAppSheet_() {
  var ss = appSs_(), out = {}, lss = null, holidays = [], cal = null;
  FLOW_IDS.forEach(function (fid) {
    var f = FLOWS[fid], lsh = legacySheet_(fid), lay = legacyLayout_(fid);
    lss = lss || lsh.getParent();
    cal = cal || lay.cal;
    var lastCol = lay.cols, top = lsh.getRange(1, 1, ROW.HEAD, lastCol).getDisplayValues();
    var what = top[ROW.WHAT - 1], who = top[ROW.WHO - 1], how = top[ROW.HOW - 1], when = top[ROW.WHEN - 1], head = top[ROW.HEAD - 1];
    // blocks (base + one per step, as in row 2) and the columns that stay
    var lst = [];
    for (var c = 1; c < lastCol; c++) if (String(what[c] || '').trim()) lst.push(c);
    var firstStep = lst.length > 1 ? lst[1] : lastCol, starts = [0].concat(lst.slice(1));
    var blockOf = function (col) { var b = 0; starts.forEach(function (s, i) { if (col >= s) b = i; }); return b; };
    var drop = DROP_COLS[fid] || [], keep = [];
    for (c = 0; c < lastCol; c++) {
      var h = String(head[c] || '').trim();
      if (h && !drop.some(function (re) { return re.test(h); })) keep.push(c);
    }
    var gradeCols = [];
    for (c = 0; c < firstStep; c++) if (/^material grade\s*\(/i.test(String(head[c] || ''))) gradeCols.push(c);
    var matCol = -1;
    for (c = 0; c < firstStep; c++) if (hKey_(head[c]) === hKey_(f.material)) matCol = c;

    // data rows (only rows with an id)
    var last = lsh.getLastRow(), rows = [];
    if (last >= ROW.FIRST) {
      var ids = lsh.getRange(ROW.FIRST, 1, last - ROW.FIRST + 1, 1).getDisplayValues(), n = 0;
      for (var i = ids.length - 1; i >= 0; i--) if (String(ids[i][0]).trim()) { n = i + 1; break; }
      if (n) rows = lsh.getRange(ROW.FIRST, 1, n, lastCol).getValues().filter(function (r) { return String(r[0]).trim(); });
    }
    var data = rows.map(function (r) {
      if (matCol >= 0 && cleanVal_(r[matCol]) === '') gradeCols.some(function (g) { var v = cleanVal_(r[g]); if (v !== '') { r[matCol] = v; return true; } return false; });
      return keep.map(function (col) { return cleanVal_(r[col]); });
    });

    // the four label rows: block text at the first kept column of each block
    var lab = [[], [], [], []], seen = {};
    keep.forEach(function (col, j) {
      var b = blockOf(col), s0 = starts[b];
      [what, who, how, when].forEach(function (src, k) { lab[k][j] = ''; });
      if (j === 0) { lab[0][0] = 'What'; lab[1][0] = 'Who'; lab[2][0] = 'How'; lab[3][0] = 'When (hrs)'; }
      if (b === 0 && col === 1 || (b > 0 && !seen[b])) {
        var at = b === 0 ? 1 : s0;
        lab[0][j] = String(what[at] || '').replace(/\s+/g, ' ').trim();
        lab[1][j] = String(who[at] || '').trim();
        lab[2][j] = String(how[at] || '').trim();
        lab[3][j] = String(when[at] || '').trim();
        seen[b] = 1;
      }
    });
    var heads = keep.map(function (col) { return String(head[col]).trim(); });
    var title = [f.title.toUpperCase()].concat(keep.slice(1).map(function () { return ''; }));
    title[4] = 'Kept by the Leads & Orders app · one row per ' + f.unit + ' · type only in the white columns of a step';

    // fresh tab
    var old = ss.getSheetByName(f.tab);
    if (old) ss.deleteSheet(old);
    var sh = ss.insertSheet(f.tab), K = keep.length, need = Math.max(1000, ROW.FIRST + data.length + 500);
    if (sh.getMaxColumns() < K) sh.insertColumnsAfter(sh.getMaxColumns(), K - sh.getMaxColumns());
    if (sh.getMaxColumns() > K) sh.deleteColumns(K + 1, sh.getMaxColumns() - K);
    if (sh.getMaxRows() < need) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows());
    var all = [title].concat(lab).concat([heads]).concat(data);
    sh.getRange(1, 1, all.length, K).setValues(all);

    // what each new column is
    var info = keep.map(function (col, j) {
      var x = { j: j, col: col, head: heads[j], block: blockOf(col), kind: 'field', type: 'text', opts: null };
      if (col === 0) x.kind = 'id';
      else if (col === 1) { x.kind = 'ts'; x.type = 'datetime'; }
      lay.base.forEach(function (b) { if (b.c === col && col > 1) { x.type = b.t; x.opts = b.o; } });
      lay.steps.forEach(function (st) {
        if (st.p === col) { x.kind = 'planned'; x.type = 'datetime'; }
        else if (st.a === col) { x.kind = 'actual'; x.type = 'datetime'; }
        else if (st.s === col) { x.kind = 'status'; x.opts = st.opts; }
        else if (st.d === col) { x.kind = 'delay'; }
        st.fields.forEach(function (fl) { if (fl.c === col) { x.type = fl.t; x.opts = fl.o; } });
      });
      return x;
    });
    formatFlowTab_(sh, fid, info, need);
    out[fid] = { rows: data.length, cols: K, dropped: lastCol - K };

    // Steps rows + form import map
    out[fid].steps = lay.steps.map(function (st) {
      var from = st.from.base ? 'Timestamp' : st.from.actual ? st.from.step + ' Actual' : st.from.step + ': ' + st.from.field;
      return [f.tab, st.num, st.key, st.title, from].concat(st.opts);
    });
    // holidays of the old sheet
    var hs = lsh.getParent().getSheetByName('Holidays');
    if (hs && hs.getLastRow() > 0) hs.getRange(1, 1, hs.getLastRow(), Math.min(2, Math.max(1, hs.getLastColumn()))).getValues().forEach(function (r) {
      var t = msOf_(r[0]);
      if (t && r[0] instanceof Date) holidays.push([r[0], r[1] || '']);
    });
  });

  // Steps tab
  var stepRows = out.L2O.steps.concat(out.O2D.steps), wide = 5 + Math.max.apply(null, stepRows.map(function (r) { return r.length - 5; }).concat([3]));
  var sHead = ['Flow', 'No.', 'Key', 'Step', 'Clock starts from'];
  for (var a = 1; sHead.length < wide; a++) sHead.push('Answer ' + a);
  stepRows = stepRows.map(function (r) { while (r.length < wide) r.push(''); return r; });
  var st = freshTab_(ss, 'Steps', 1 + stepRows.length + 20, wide);
  st.getRange(1, 2, 1 + stepRows.length, 1).setNumberFormat('@');
  st.getRange(1, 1, 1 + stepRows.length, wide).setValues([sHead].concat(stepRows));
  headerStyle_(st, wide);
  st.setColumnWidth(1, 80); st.setColumnWidth(2, 50); st.setColumnWidth(3, 110); st.setColumnWidth(4, 300); st.setColumnWidth(5, 160);
  for (var w = 6; w <= wide; w++) st.setColumnWidth(w, 120);
  st.getRange(2, 1, stepRows.length, 1).setFontWeight('bold').setFontColor(TH.honeyDk);
  st.getRange(2, 3, stepRows.length, 1).setFontFamily('Roboto Mono');

  // Holidays tab
  var seenH = {}, hol = holidays.filter(function (h) { var k = h[0].getTime(); if (seenH[k]) return false; seenH[k] = 1; return true; })
    .sort(function (x, y) { return x[0] - y[0]; });
  var hm = function (x) { var hh = Math.floor(x), mm = Math.round((x - hh) * 60); return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm; };
  var ht = freshTab_(ss, 'Holidays', Math.max(200, hol.length + 50), 2);
  ht.getRange(1, 2, 3, 1).setNumberFormat('@');
  ht.getRange(1, 1, 5, 2).setValues([['Office opens', hm(cal.open)], ['Office closes', hm(cal.close)], ['Weekly off (Mon→Sun, 1 = off)', cal.mask], ['', ''], ['Holiday date', 'Holiday']]);
  if (hol.length) ht.getRange(6, 1, hol.length, 2).setValues(hol);
  ht.getRange(6, 1, Math.max(1, ht.getMaxRows() - 5), 1).setNumberFormat('dd/mm/yyyy (ddd)');
  ht.getRange(1, 1, 3, 1).setFontWeight('bold').setBackground(TH.softA).setFontColor(TH.ink);
  ht.getRange(1, 2, 3, 1).setBackground(TH.white).setFontWeight('bold').setHorizontalAlignment('center');
  ht.getRange(5, 1, 1, 2).setBackground(TH.ink).setFontColor(TH.white).setFontWeight('bold');
  ht.setFrozenRows(5); ht.setColumnWidth(1, 230); ht.setColumnWidth(2, 220);
  ht.setTabColor(TH.ink3);

  // same clock as the old sheets
  try {
    if (lss && ss.getSpreadsheetTimeZone() !== lss.getSpreadsheetTimeZone()) ss.setSpreadsheetTimeZone(lss.getSpreadsheetTimeZone());
    if (lss && ss.getSpreadsheetLocale() !== lss.getSpreadsheetLocale()) ss.setSpreadsheetLocale(lss.getSpreadsheetLocale());
  } catch (e) {}
  formatSideTabs_();
  delete out.L2O.steps; delete out.O2D.steps;
  out.holidays = hol.length;
  return out;
}

function freshTab_(ss, name, rows, cols) {
  var old = ss.getSheetByName(name);
  if (old) ss.deleteSheet(old);
  var sh = ss.insertSheet(name);
  if (sh.getMaxColumns() > cols) sh.deleteColumns(cols + 1, sh.getMaxColumns() - cols);
  if (sh.getMaxRows() > rows) sh.deleteRows(rows + 1, sh.getMaxRows() - rows);
  return sh;
}

function headerStyle_(sh, cols) {
  sh.getRange(1, 1, 1, cols).setBackground(TH.ink).setFontColor(TH.white).setFontWeight('bold').setVerticalAlignment('middle').setWrap(true);
  sh.setRowHeight(1, 30);
  sh.setFrozenRows(1);
}

function banding_(range) {
  try {
    range.getSheet().getBandings().forEach(function (b) { b.remove(); });
    range.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false).setFirstRowColor(TH.white).setSecondRowColor(TH.band);
  } catch (e) { Logger.log('banding: ' + e); }
}

/** Colours, widths, frozen panes, number formats and dropdowns of LEADS / ORDERS. */
function formatFlowTab_(sh, fid, info, rows) {
  var K = info.length, dataN = rows - ROW.HEAD;
  sh.getRange(1, 1, rows, K).setFontFamily('Inter').setFontSize(10).setVerticalAlignment('middle').setFontColor(TH.ink);
  // row 1: title
  sh.getRange(1, 1, 1, K).setBackground(TH.ink).setFontColor(TH.honey);
  sh.getRange(1, 1).setFontSize(13).setFontWeight('bold');
  sh.getRange(1, 5).setFontColor('#D6CFC2').setFontStyle('italic');   // after the frozen columns, so the title is not cut
  sh.setRowHeight(1, 34);
  // rows 2–5: step blocks
  var blocks = {};
  info.forEach(function (x) { (blocks[x.block] = blocks[x.block] || []).push(x.j); });
  Object.keys(blocks).forEach(function (b) {
    var js = blocks[b], c0 = js[0] + 1, n = js.length, alt = Number(b) % 2;
    if (Number(b) === 0) {
      sh.getRange(2, 1, 1, n).setBackground(TH.baseTop).setFontColor(TH.white).setFontWeight('bold');
      sh.getRange(3, 1, 3, n).setBackground('#4A4239').setFontColor('#E7E0D3').setFontSize(9);
      sh.getRange(2, 1, 4, 1).setFontColor(TH.honey).setFontWeight('bold');
      return;
    }
    var top = sh.getRange(2, c0, 1, n), sub = sh.getRange(3, c0, 3, n);
    if (n > 1) { top.merge(); sh.getRange(3, c0, 1, n).merge(); sh.getRange(4, c0, 1, n).merge(); sh.getRange(5, c0, 1, n).merge(); }
    top.setBackground(alt ? TH.tintA : TH.tintB).setFontWeight('bold').setHorizontalAlignment('center').setWrap(true);
    sub.setBackground(alt ? TH.softA : TH.softB).setFontColor(TH.ink3).setFontSize(9).setHorizontalAlignment('center');
    sh.getRange(5, c0).setFontWeight('bold').setFontColor(TH.honeyDk);
    sh.getRange(2, c0, rows - 1, 1).setBorder(null, true, null, null, null, null, TH.honeyDk, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  });
  sh.setRowHeight(2, 36);
  // row 6: headings
  var hr = sh.getRange(ROW.HEAD, 1, 1, K);
  hr.setBackground(TH.ink2).setFontColor(TH.white).setFontWeight('bold').setHorizontalAlignment('center').setWrap(true);
  info.forEach(function (x) { if (/planned|actual|status|delay/.test(x.kind)) sh.getRange(ROW.HEAD, x.j + 1).setFontColor(TH.honey); });
  sh.setRowHeight(ROW.HEAD, 42);
  // data
  banding_(sh.getRange(ROW.FIRST, 1, dataN, K));
  var fmt = function (x) {
    if (x.kind === 'delay') return '[h]:mm';
    if (x.type === 'datetime') return 'dd/mm/yyyy hh:mm';
    if (x.type === 'date') return 'dd/mm/yyyy';
    if (x.type === 'tel') return '@';
    return null;
  };
  var statusRanges = [], delayRanges = [];
  info.forEach(function (x) {
    var col = sh.getRange(ROW.FIRST, x.j + 1, dataN, 1), nf = fmt(x), w = 130;
    if (nf) col.setNumberFormat(nf);
    if (x.kind === 'id') { w = 82; col.setFontWeight('bold').setFontColor(TH.honeyDk).setFontFamily('Roboto Mono'); }
    else if (x.kind === 'ts' || x.kind === 'planned' || x.kind === 'actual') { w = 118; col.setHorizontalAlignment('center'); }
    else if (x.kind === 'status') { w = 104; col.setHorizontalAlignment('center').setFontWeight('bold'); statusRanges.push(col); }
    else if (x.kind === 'delay') { w = 70; col.setHorizontalAlignment('center'); delayRanges.push(col); }
    else if (x.type === 'textarea') { w = 200; col.setWrap(false); }
    else if (x.type === 'date') { w = 96; col.setHorizontalAlignment('center'); }
    else if (x.type === 'number') { w = 76; col.setHorizontalAlignment('right'); }
    if (x.kind === 'planned') col.setFontColor(TH.ink3);
    sh.setColumnWidth(x.j + 1, w);
    var dv = null;
    if (x.opts && x.opts.length) dv = SpreadsheetApp.newDataValidation().requireValueInList(x.opts, true).setAllowInvalid(true).build();
    else if (x.type === 'date' && x.kind === 'field') dv = SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(true).build();
    if (dv) col.setDataValidation(dv);
  });
  // colour rules: good / bad answers, late steps
  var rules = [];
  if (statusRanges.length) {
    GOOD_WORDS.forEach(function (wd) { rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(wd).setBackground(TH.greenBg).setFontColor(TH.green).setRanges(statusRanges).build()); });
    BAD_WORDS.forEach(function (wd) { rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(wd).setBackground(TH.redBg).setFontColor(TH.red).setRanges(statusRanges).build()); });
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenCellNotEmpty().setBackground(TH.amberBg).setRanges(statusRanges).build());
  }
  if (delayRanges.length) rules.push(SpreadsheetApp.newConditionalFormatRule().whenCellNotEmpty().setBackground(TH.redBg).setFontColor(TH.red).setRanges(delayRanges).build());
  sh.setConditionalFormatRules(rules);
  // frozen panes + tab colour
  var baseN = info.filter(function (x) { return x.block === 0; }).length;
  sh.setFrozenRows(ROW.HEAD);
  sh.setFrozenColumns(Math.min(4, baseN));
  sh.setTabColor(fid === 'L2O' ? '#D69E2E' : '#9C6A12');
  sh.setHiddenGridlines(false);
}

/** Header colours of the other tabs and the tab order. */
function formatSideTabs_() {
  var ss = appSs_();
  var order = [FLOWS.L2O.tab, FLOWS.O2D.tab, 'Steps', 'Holidays', TABS.EVENTS.name, TABS.NOTES.name, TABS.PHOTOS.name, TABS.STATE.name, TABS.ACTIVITY.name, TABS.SETTINGS.name];
  ss.getSheets().forEach(function (sh) { if (order.indexOf(sh.getName()) < 0) order.push(sh.getName()); });
  order.forEach(function (name, i) {
    var sh = ss.getSheetByName(name);
    if (!sh) return;
    if (i > 3) {
      var cols = Math.max(1, sh.getLastColumn());
      sh.getRange(1, 1, Math.max(1, sh.getMaxRows()), cols).setFontFamily('Inter').setFontSize(10).setVerticalAlignment('middle');
      headerStyle_(sh, cols);
      if (sh.getMaxRows() > 1) banding_(sh.getRange(2, 1, sh.getMaxRows() - 1, cols));
      sh.setTabColor(/^Portal/i.test(name) ? '#78716C' : TH.ink2);
    } else if (name === 'Steps') sh.setTabColor(TH.ink3);
    try { ss.setActiveSheet(sh); ss.moveActiveSheet(i + 1); } catch (e) {}
  });
  try { ss.setActiveSheet(ss.getSheetByName(FLOWS.L2O.tab)); } catch (e) {}
}

/* ---------------------------------------------------------------- Contact + Give quotation → "Contact & quote" */

var MERGED_ANSWERS = ['Done', 'CNR', 'BUSY/Not Reachable', 'Cut The Call', 'Wrong Number', 'Close Inquiry', 'Rate Issue', 'Quality Issue', 'Negotiating', 'Order Reject'];

/**
 * One time (16 Nov 2026, the Admin's decision): steps 2 CONTACT and 3 QUOTATION of LEADS become one step
 * "Contact & quote" with a new field "Raw Rates/Prices".
 *   · a backup copy of LEADS is made first
 *   · quotation given        → its answer + time become the merged step's Actual / Status
 *   · quotation follow-up    → that answer stays (tile at the merged step)
 *   · contacted, no quote    → open again at the merged step (213 leads on 16 Nov) — lost-at-contact stays closed
 *   · the quotation remark is added to REMARK ("… | Quotation: …"); nothing is thrown away
 *   · the 4 quotation clock columns go; the freed remark column becomes "Raw Rates/Prices"
 *   · Steps tab, saved step settings and rules follow; every changed lead gets a MERGE line in Events
 */
function mergeContactQuote_() {
  var ss = appSs_(), sh = fmsSheet_('L2O');
  cache_().remove('lay_L2O' + LAY_V); MEMO_ = { ss: ss };
  var lay = layout_('L2O'), C = stepByKey_(lay, 'CONTACT'), Q = stepByKey_(lay, 'QUOTATION');
  if (!C || !Q) throw new Error('CONTACT / QUOTATION not found — already merged?');
  var remOf = function (st) { return st.fields.filter(function (f) { return /remark/i.test(f.k); })[0]; };
  var cRem = remOf(C), qRem = remOf(Q);
  if (!cRem || !qRem || Q.p !== cRem.c + 1 || qRem.c !== Q.p + 4 || Q.fields.length !== 1) throw new Error('LEADS columns are not laid out as expected; nothing changed.');
  var stamp = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'd MMM yyyy HH:mm');
  var backup = sh.copyTo(ss).setName('LEADS before merge ' + stamp);

  var n = sh.getLastRow() - ROW.FIRST + 1, w = sh.getLastColumn();
  var rg = sh.getRange(ROW.FIRST, 1, n, w), vals = rg.getValues(), events = [], out = { back: 0, done: 0, follow: 0, remarks: 0, rows: 0 };
  var crules = stepCfg_('L2O').CONTACT.rules;
  vals.forEach(function (r) {
    var id = String(r[0]).trim();
    if (!id) return;
    out.rows++;
    var ca = r[C.a], cs = String(r[C.s] || '').trim(), cp = r[C.p], qa = r[Q.a], qs = String(r[Q.s] || '').trim(), crem = String(r[cRem.c] || '').trim(), qrem = String(r[qRem.c] || '').trim();
    var before = { contact: { a: ca instanceof Date ? ca.getTime() : ca, s: cs, remark: crem }, quotation: { p: r[Q.p] instanceof Date ? r[Q.p].getTime() : r[Q.p], a: qa instanceof Date ? qa.getTime() : qa, s: qs, remark: qrem } };
    var lostAtContact = !!ca && ruleOf(crules, 'CONTACT', cs, false) === 'lost', what = '';
    if (qa && !lostAtContact) { r[C.a] = qa; r[C.s] = qs; r[C.d] = cp instanceof Date && qa instanceof Date && qa > cp ? (qa.getTime() - cp.getTime()) / 864e5 : ''; out.done++; what = 'quotation given → merged step done'; }
    else if (qs && !lostAtContact) { r[C.a] = ''; r[C.s] = qs; r[C.d] = ''; out.follow++; what = 'quotation follow-up (' + qs + ') → at Contact & quote'; }
    else if (ca && !lostAtContact) { r[C.a] = ''; r[C.s] = ''; r[C.d] = ''; out.back++; what = 'contacted, no quotation yet → at Contact & quote'; }
    if (qrem) { r[cRem.c] = crem ? crem + ' | Quotation: ' + qrem : 'Quotation: ' + qrem; out.remarks++; what = what || 'quotation remark kept'; }
    r[qRem.c] = '';                                         // this column becomes "Raw Rates/Prices"
    if (what) events.push([new Date(), 'system', 'System', 'L2O', id, 'CONTACT', 'MERGE', what, '', '', '', '', JSON.stringify(before)]);
  });
  rg.setValues(vals);

  // columns: drop Planned/Actual/Status/Time Delay of the quotation block; its remark column becomes Raw Rates/Prices
  var newCol = Q.p + 1;                                     // 1-based position of the old quotation REMARK after the delete
  sh.getRange(2, C.p + 1, 4, (qRem.c - C.p) + 1).breakApart();
  sh.deleteColumns(Q.p + 1, 4);
  var maxR = sh.getMaxRows();
  sh.getRange(1, cRem.c + 1, maxR, 1).copyFormatToRange(sh, newCol, newCol, 1, maxR);
  sh.getRange(ROW.FIRST, newCol, maxR - ROW.FIRST + 1, 1).clearDataValidations().setNumberFormat('@');
  sh.getRange(ROW.HEAD, newCol).setValue('Raw Rates/Prices');
  var top = sh.getRange(2, C.p + 1, 4, 1).getValues();
  top[0][0] = 'CONTACT & QUOTATION (2)';
  sh.getRange(2, newCol, 4, 1).clearContent();
  for (var i = 0; i < 4; i++) { var m = sh.getRange(2 + i, C.p + 1, 1, newCol - C.p); m.merge(); m.getCell(1, 1).setValue(top[i][0]); }
  sh.setColumnWidth(newCol, 200);
  sh.getRange(ROW.FIRST, C.s + 1, maxR - ROW.FIRST + 1, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(MERGED_ANSWERS, true).setAllowInvalid(true).build());

  // Steps tab: one row for the merged step, sampling's clock starts at its Actual
  var st = ss.getSheetByName('Steps'), sv = st.getRange(1, 1, st.getLastRow(), Math.max(st.getLastColumn(), 5 + MERGED_ANSWERS.length)).getValues(), qRow = 0;
  sv.forEach(function (r, i) {
    if (hKey_(r[0]) !== hKey_(FLOWS.L2O.tab)) return;
    var k = String(r[2]).trim();
    if (k === 'CONTACT') { st.getRange(i + 1, 4).setValue('CONTACT & QUOTATION'); st.getRange(i + 1, 6, 1, MERGED_ANSWERS.length).setValues([MERGED_ANSWERS]); }
    if (k === 'QUOTATION') qRow = i + 1;
    if (k === 'SAMPLING') st.getRange(i + 1, 5).setValue('CONTACT Actual');
  });
  if (qRow) st.deleteRow(qRow);

  // saved step settings + rules
  var s = settings_(), steps = s.steps || {};
  if (steps.L2O) {
    var L = steps.L2O, ref = 'CONTACT:Raw Rates/Prices';
    L.CONTACT = L.CONTACT || {};
    L.CONTACT.label = 'Contact & quote';
    L.CONTACT.card = (L.CONTACT.card || []).filter(function (x) { return x.indexOf('QUOTATION:') !== 0; });
    if (L.CONTACT.card.indexOf(ref) < 0) L.CONTACT.card.push(ref);
    L.CONTACT.required = (L.CONTACT.required || []).filter(function (x) { return x.indexOf('QUOTATION:') !== 0; });
    if (L.CONTACT.required.indexOf(ref) < 0) L.CONTACT.required.push(ref);
    Object.keys(L).forEach(function (k) {
      if (!L[k] || !L[k].card) return;
      var seen = {};
      L[k].card = L[k].card.map(function (x) { return x === 'QUOTATION:@status' ? ref : x === 'QUOTATION:REMARK' ? 'CONTACT:REMARK' : x; })
        .filter(function (x) { if (x.indexOf('QUOTATION:') === 0 || seen[x]) return false; seen[x] = 1; return true; });
      if (L[k].required) L[k].required = L[k].required.filter(function (x) { return x.indexOf('QUOTATION:') !== 0; });
      if (L[k].side && String(L[k].side).indexOf('QUOTATION:') === 0) L[k].side = '';
    });
    delete L.QUOTATION;
    setSetting_('steps', steps, 'system');
  }
  if (s.rules && s.rules.L2O) {
    var rl = s.rules.L2O;
    rl.CONTACT = Object.assign({}, DEFAULT_RULES.L2O.CONTACT, rl.CONTACT || {}, rl.QUOTATION || {});
    delete rl.QUOTATION;
    setSetting_('rules', s.rules, 'system');
  }
  if (events.length) { var es = tab_(TABS.EVENTS); es.getRange(es.getLastRow() + 1, 1, events.length, events[0].length).setValues(events); }

  cache_().remove('lay_L2O' + LAY_V); cache_().remove('settings'); MEMO_ = { ss: ss };
  out.backup = backup.getName();
  return out;
}

/** ?mergecq=1 — runs once (MERGED_CQ). */
function mergeCqOut_() {
  var p = PropertiesService.getScriptProperties(), res;
  if (p.getProperty('MERGED_CQ')) res = { already: p.getProperty('MERGED_CQ') };
  else {
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      if (p.getProperty('MERGED_CQ')) res = { already: p.getProperty('MERGED_CQ') };
      else { res = mergeContactQuote_(); p.setProperty('MERGED_CQ', new Date().toISOString()); }
    } catch (e) { res = { error: String(e.message || e) }; }
    finally { lock.releaseLock(); }
    if (res && !res.error && !res.already) {
      p.setProperty('BOARD_BUILT', '0'); p.deleteProperty('REBUILDING');
      try { rebuildBoards_(); } catch (e) { res.rebuild = String(e); }
      var b = boardData_('L2O'), cnt = {};
      b.leads.forEach(function (l) { if (l.cur) cnt[l.cur] = (cnt[l.cur] || 0) + 1; });
      res.board = cnt; res.steps = layout_('L2O').steps.map(function (s) { return s.key + ':' + s.fields.map(function (f) { return f.k; }).join('|'); });
    }
  }
  return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
}

/** ?migrate=1 — runs once: copies the old sheets, sets the triggers, builds the board. */
function migrateOut_() {
  var p = PropertiesService.getScriptProperties(), res;
  if (p.getProperty('MIGRATED')) res = { already: p.getProperty('MIGRATED') };
  else {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(1000)) res = { busy: true };
    else {
      try {
        if (p.getProperty('MIGRATED')) res = { already: p.getProperty('MIGRATED') };
        else {
          var t0 = Date.now();
          res = migrateToAppSheet_();
          p.setProperty('MIGRATED', new Date().toISOString());
          MEMO_ = { ss: MEMO_.ss };
          FLOW_IDS.forEach(function (fid) { cache_().remove('lay_' + fid + LAY_V); });
          try { installTriggers_(); } catch (e) { res.triggers = String(e); }
          res.secs = Math.round((Date.now() - t0) / 1000);
        }
      } finally { lock.releaseLock(); }
    }
  }
  if (res && !res.already && !res.busy) {
    p.setProperty('BOARD_BUILT', '0');
    p.deleteProperty('REBUILDING');
    try { rebuildBoards_(); } catch (e) { res.rebuild = String(e); }
    FLOW_IDS.forEach(function (f) { var b = boardData_(f); res[f].board = b.leads.length; });
  }
  return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
}
