/*******************************************************
 * Cycles.js — an order is sent in cycles (Admin's design, 17 Nov 2026).
 *
 *   ORDERS   once per order: 2 Confirm at station · 3 Client OK · 4 Estimate / PI · 5 In cycles
 *            ("In cycles" has no deadline; Loaded / Balance / Cycles are filled by the app)
 *   CYCLES   one row per cycle (ORD-150-C1, -C2 …):
 *            6 Cycle payment (Advance received / Credit / On Dispatch / On Delivery + tons it covers)
 *            7 Trucks · 8 Dispatch · 9 Payment confirmation · 10 Invoice · 11 Delivery · 12 Balance payment call
 *   Trucks   one row per truck of a cycle (truck no., transporter, driver mob., weight)
 *
 *   Rules: trucks only after the cycle's payment (the gate) · trucks ≤ tons the payment covers and ≤ order
 *   balance (2 % weighbridge margin) · Credit / On Dispatch / On Delivery only for customers the Admin allows
 *   (Settings → Customers) · balance = ordered − loaded · the order completes itself when the balance is 0
 *   and every cycle is done · the first cycle starts by itself when the estimate step is done.
 *******************************************************/

function cyclesOn_() { return FLOW_IDS.indexOf('CYC') > -1; }
function qtyNum_(v) { if (typeof v === 'number') return v; var n = parseFloat(String(v == null ? '' : v).replace(/,/g, '')); return isNaN(n) ? 0 : n; }
function round2_(n) { return Math.round(n * 100) / 100; }
function partyKey_(s) { return String(s || '').trim().toUpperCase().replace(/\s+/g, ' '); }
function cycNo_(id) { var m = /-C(\d+)$/.exec(String(id)); return m ? Number(m[1]) : 0; }
var TONS_MARGIN = 1.02;
/**
 * An order counts as fully sent once something is loaded and less than one truck is left: a truck always
 * carries more than 30 t, so a smaller balance cannot go (Admin, 17 Nov 2026; replaces the 5 % rule).
 */
var MIN_TRUCK_T = 30;
function fullySent_(sum) { return sum.qty > 0 && (sum.loaded || 0) > 0 && sum.balance < MIN_TRUCK_T; }

/** Settings → Customers: { PARTY: ['Credit', 'On Dispatch', 'On Delivery'] } (Advance received is always allowed). */
function custTerms_() { var v = settings_().custTerms; return v && typeof v === 'object' ? v : {}; }
function termsFor_(party) {
  var extra = custTerms_()[partyKey_(party)] || [];
  return CYCLE_TERMS.filter(function (t, i) { return i === 0 || extra.indexOf(t) > -1; });
}

/** Trucks still on the list (removed ones keep their row with "Removed" filled). */
function trucks_(keep) {
  return rows_(TABS.TRUCKS).map(function (r, i) {
    return { row: i + 2, cyc: String(r[0]).trim(), ord: String(r[1]).trim(), truck: String(r[2]), tpt: String(r[3]), mob: String(r[4]),
             wt: qtyNum_(r[5]), at: msOf_(r[6]), by: String(r[7]), gone: !!String(r[8] == null ? '' : r[8]).trim() };
  }).filter(function (t) { return !t.gone && keep(t); });
}

/** An order with its cycles: { qty, loaded, balance, open, cycles: [{ id, cur, label, closed, term, covered, amount, loaded, trucks, dispatch, invoice }] } */
function orderSummary_(orderId) {
  var order = null;
  readFlow_('O2D').forEach(function (l) { if (l.id === orderId) order = l; });
  var qty = order ? qtyNum_(pick_(order.b, 'QTY.')) : 0;
  var lay = layout_('CYC'), scfg = stepCfg_('CYC'), state = leadState_('CYC'), now = Date.now();
  var trucks = trucks_(function (t) { return t.ord === orderId; });
  var cycles = readFlow_('CYC').filter(function (l) { return String(pick_(l.b, 'Order No')).trim() === orderId; }).map(function (l0) {
    var l = JSON.parse(JSON.stringify(l0));
    decorate_('CYC', l, lay, scfg, state, now);
    var mine = trucks.filter(function (t) { return t.cyc === l.id; });
    var f = function (k, h) { var v = ((l.s[k] || {}).f || {})[h]; return v == null ? '' : v; };
    return { id: l.id, cur: l.cur || '', label: l.cur ? scfg[l.cur].label : '', closed: l.closed ? l.closed.o : '', term: (l.s.ADVANCE || {}).s || '',
             covered: qtyNum_(f('ADVANCE', 'Tons covered')), amount: f('ADVANCE', 'Amount'), loaded: round2_(mine.reduce(function (a, t) { return a + t.wt; }, 0)),
             trucks: mine.length, dispatch: f('DISPATCH', 'Dispatch Date'), invoice: f('INVOICE', 'Invoice No.') };
  }).sort(function (a, b) { return cycNo_(a.id) - cycNo_(b.id); });
  var loaded = round2_(trucks.reduce(function (a, t) { return a + t.wt; }, 0));
  return { qty: qty, loaded: loaded, balance: round2_(qty - loaded), cycles: cycles, open: cycles.filter(function (c) { return !c.closed; }).length };
}
/** Tons of the order not yet taken by other cycles (an open cycle holds what its payment covers). */
function uncovered_(sum, exceptId) {
  var used = 0;
  sum.cycles.forEach(function (c) {
    if (c.id === exceptId || c.closed === 'lost') return;
    used += c.closed ? c.loaded : Math.max(c.covered, c.loaded);
  });
  return round2_(sum.qty - used);
}

function baseCol_(lay, head) { var b = lay.base.filter(function (x) { return hKey_(x.k) === hKey_(head); })[0]; return b ? b.c : -1; }
function fieldCol_(st, head) { var f = st ? st.fields.filter(function (x) { return hKey_(x.k) === hKey_(head); })[0] : null; return f ? f.c : -1; }

/** A new cycle row for an order (no answers yet → it starts at "Cycle payment"). */
function newCycle_(me, order) {
  var lay = layout_('CYC'), sh = fmsSheet_('CYC'), sum = orderSummary_(order.id);
  var n = sum.cycles.reduce(function (m, c) { return Math.max(m, cycNo_(c.id)); }, 0) + 1, id = order.id + '-C' + n, row = [];
  for (var c = 0; c < lay.cols; c++) row.push('');
  var set = function (h, v) { var i = baseCol_(lay, h); if (i >= 0) row[i] = v; };
  row[0] = id; set('Timestamp', new Date()); set('Order No', order.id);
  ['SALES PER.', 'PARTY NAME', 'Mines/Factory', 'Mat. Gr.'].forEach(function (h) { set(h, pick_(order.b, h)); });
  var r = newRow_('CYC');
  sh.getRange(r, 1, 1, lay.cols).setValues([row]);
  MEMO_['rd_CYC'] = null;
  logEvent_(me, 'CYC', id, '', 'CYCLE', 'Cycle ' + n + ' of ' + order.id + ' started', { ownerUser: usersForName_(order.owner)[0] || '' });
  logEvent_(me, 'O2D', order.id, 'CYCLES', 'CYCLE', 'C' + n + ' started');
  return id;
}

/** Writes Loaded / Balance / Cycles on the order; completes the order when everything is sent and every cycle is done. */
function writeOrderSummary_(me, orderId) {
  if (!orderId || !cyclesOn_()) return null;
  var lay = layout_('O2D'), st = stepByKey_(lay, 'CYCLES');
  if (!st) return null;
  ['rd_CYC', 'rd_O2D', 'rows_' + TABS.TRUCKS.name, 'state_CYC'].forEach(function (k) { MEMO_[k] = null; });
  var sum = orderSummary_(orderId), cells = {}, order = freshLead_('O2D', orderId);
  var put = function (h, v) { var c = fieldCol_(st, h); if (c >= 0) cells[c] = v; };
  put('Loaded (t)', sum.loaded || (sum.cycles.length ? 0 : ''));
  put('Balance (t)', sum.qty > 0 ? sum.balance : '');
  put('Cycles', sum.cycles.length ? sum.cycles.length + (sum.open ? ' (' + sum.open + ' open)' : ' (all done)') : '');
  if (order.cur === 'CYCLES' && fullySent_(sum) && sum.cycles.length && !sum.open) {
    cells[st.a] = new Date(); if (st.s >= 0) cells[st.s] = 'Completed';
    var ou = usersForName_(order.owner)[0] || '';
    logEvent_(me, 'O2D', orderId, 'CYCLES', 'DONE', 'Completed', { ownerUser: ou });
    logEvent_(me, 'O2D', orderId, 'CYCLES', 'WON', 'All ' + sum.qty + ' t sent in ' + sum.cycles.length + ' cycle(s)', { ownerUser: ou });
  }
  writeCells_('O2D', order.r, cells);
  MEMO_['rd_O2D'] = null;
  return boardLead_('O2D', orderId);
}

/** Checks before a step answer is saved (inside submitStep, under the lock). */
function cycleGate_(fid, lead, stepKey, status, fields) {
  if (!cyclesOn_()) return;
  fields = fields || {};
  if (fid === 'O2D' && stepKey === 'CYCLES') {
    var s0 = orderSummary_(lead.id);
    if (s0.open) throw new Error('Finish or close the open cycles of ' + lead.id + ' first (' + s0.cycles.filter(function (c) { return !c.closed; }).map(function (c) { return c.id; }).join(', ') + ').');
    if (status === 'Completed' && s0.qty > 0 && !fullySent_(s0)) throw new Error(s0.balance + ' t of ' + lead.id + ' is still to be sent (an order is complete below ' + MIN_TRUCK_T + ' t left). Start a cycle for it, or choose "Closed – rest cancelled".');
    return;
  }
  if (fid !== 'CYC') return;
  if (stepKey === 'ADVANCE') {
    var party = pick_(lead.b, 'PARTY NAME'), ok = termsFor_(party), adv = (lead.s.ADVANCE || {}).f || {};
    if (ok.indexOf(status) < 0) throw new Error('"' + status + '" is not allowed for ' + party + '. The Admin can allow it in Settings → Customers.');
    var tons = qtyNum_('Tons covered' in fields ? fields['Tons covered'] : adv['Tons covered']);
    var amt = qtyNum_('Amount' in fields ? fields.Amount : adv.Amount);
    if (!(tons > 0)) throw new Error('Enter the tons this payment covers.');
    if (status === CYCLE_TERMS[0] && !(amt > 0)) throw new Error('Enter the advance amount received.');
    var oid = String(pick_(lead.b, 'Order No')).trim(), sum = orderSummary_(oid), free = uncovered_(sum, lead.id);
    if (sum.qty > 0 && tons > free * TONS_MARGIN + 0.001) throw new Error('Only ' + Math.max(0, free) + ' t of ' + oid + ' is not covered by other cycles.');
  }
  if (stepKey === 'TRANSPORT' && !trucks_(function (t) { return t.cyc === lead.id; }).length) throw new Error('Add the trucks of ' + lead.id + ' first.');
}

/** After a step answer: the estimate done → the first cycle starts; a cycle moved → the order's totals (maybe complete). */
function cycleAfterStep_(me, fid, lead, stepKey, rule) {
  var out = {};
  if (!cyclesOn_()) return out;
  if (fid === 'O2D' && stepKey === 'ESTIMATE' && rule === 'next') {
    MEMO_ = { ss: MEMO_.ss };
    var order = freshLead_('O2D', lead.id);
    if (order.cur === 'CYCLES' && !orderSummary_(lead.id).cycles.length) {
      var cid = newCycle_(me, order);
      out.CYC = [boardLead_('CYC', cid)];
      out.O2D = [writeOrderSummary_(me, lead.id)];
    }
  }
  if (fid === 'CYC') {
    MEMO_ = { ss: MEMO_.ss };
    var o = writeOrderSummary_(me, String(pick_(lead.b, 'Order No')).trim());
    if (o) out.O2D = [o];
  }
  return out;
}
/** patch + extra, the newest copy of a lead winning. */
function mergePatch_(patch, extra) {
  Object.keys(extra || {}).forEach(function (f) {
    var have = (patch[f] || []).map(function (l) { return l && l.id; });
    patch[f] = (patch[f] || []).concat((extra[f] || []).filter(function (l) { return l && have.indexOf(l.id) < 0; }));
  });
  return patch;
}

/** Lead panel extras: a cycle gets its trucks, allowed terms and order totals; an order its cycles. */
function cycleDetail_(fid, lead, out) {
  if (!cyclesOn_()) return;
  if (fid === 'CYC') {
    var oid = String(pick_(lead.b, 'Order No')).trim(), sum = orderSummary_(oid);
    out.trucks = trucks_(function (t) { return t.cyc === lead.id; });
    out.terms = termsFor_(pick_(lead.b, 'PARTY NAME'));
    out.order = { id: oid, qty: sum.qty, loaded: sum.loaded, balance: sum.balance, free: uncovered_(sum, lead.id) };
  } else if (fid === 'O2D') {
    var s2 = orderSummary_(lead.id);
    if (s2.cycles.length || lead.cur === 'CYCLES') { out.cycles = s2.cycles; out.sum = { qty: s2.qty, loaded: s2.loaded, balance: s2.balance, free: uncovered_(s2), open: s2.open }; }
  }
}

/* ---------------------------------------------------------------- page calls */

/** "Start next cycle" on an order that is in cycles. */
function createCycle(token, orderId) {
  var me = staff_(token);
  if (!cyclesOn_()) throw new Error('Cycles are not set up yet.');
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var order = freshLead_('O2D', orderId), role = roleOf_(me);
    if (order.closed) throw new Error(orderId + ' is closed.');
    if (order.cur !== 'CYCLES') throw new Error(orderId + ' is not "In cycles" yet — cycles start after the estimate step.');
    if (!(role === 'admin' || role === 'manager' || isOwner_(me, order) || canAct_(me, 'O2D', order, 'CYCLES'))) throw new Error('Only the sales person, a Manager or an Admin can start a cycle.');
    var sum = orderSummary_(orderId);
    if (sum.qty > 0 && uncovered_(sum) <= 0.01) throw new Error('Nothing left to send: the cycles of ' + orderId + ' already cover all ' + sum.qty + ' t.');
    var id = newCycle_(me, order), o = writeOrderSummary_(me, orderId);
    MEMO_ = { ss: MEMO_.ss };
    var cyc = boardLead_('CYC', id);
    bumpVer_({ O2D: [o], CYC: [cyc] });
    return { ok: true, id: id, msg: id + ' started — record its payment, then add the trucks.', order: o, cycle: cyc };
  } finally { lock.releaseLock(); }
}

/** t = { truck, tpt, mob, wt } — only after the cycle's payment (the cycle is at "Trucks"). */
function addTruck(token, cid, t) {
  var me = staff_(token);
  t = t || {};
  var truck = String(t.truck || '').trim().toUpperCase().replace(/\s+/g, ' '), wt = qtyNum_(t.wt);
  if (truck.length < 4) throw new Error('Enter the truck number.');
  if (!(wt > 0)) throw new Error('Enter the weight loaded (tons).');
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var cyc = truckStep_(me, cid), oid = String(pick_(cyc.b, 'Order No')).trim(), sum = orderSummary_(oid);
    var mine = sum.cycles.filter(function (c) { return c.id === cid; })[0] || { loaded: 0 }, covered = qtyNum_(((cyc.s.ADVANCE || {}).f || {})['Tons covered']);
    if (covered > 0 && mine.loaded + wt > covered * TONS_MARGIN + 0.001) throw new Error('That is more than this cycle\'s payment covers: ' + covered + ' t covered, ' + mine.loaded + ' t already on trucks.');
    if (sum.qty > 0 && sum.loaded + wt > sum.qty * TONS_MARGIN + 0.001) throw new Error('That is more than the order balance: ' + sum.balance + ' t left of ' + sum.qty + ' t.');
    append_(TABS.TRUCKS, [cid, oid, truck, String(t.tpt || '').trim(), String(t.mob || '').trim(), wt, new Date(), me.name, '']);
    logEvent_(me, 'CYC', cid, 'TRANSPORT', 'TRUCK', truck + ' · ' + wt + ' t added', { detail: { truck: truck, tpt: t.tpt || '', mob: t.mob || '', wt: wt } });
    return afterTrucks_(me, cid, oid, truck + ' added (' + wt + ' t).');
  } finally { lock.releaseLock(); }
}
function removeTruck(token, cid, row) {
  var me = staff_(token), lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var cyc = truckStep_(me, cid), oid = String(pick_(cyc.b, 'Order No')).trim();
    var tr = trucks_(function (x) { return x.cyc === cid && x.row === Number(row); })[0];
    if (!tr) throw new Error('That truck is not on ' + cid + '.');
    tab_(TABS.TRUCKS).getRange(tr.row, 9).setValue('Removed ' + Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd/MM/yyyy HH:mm') + ' by ' + me.name);
    logEvent_(me, 'CYC', cid, 'TRANSPORT', 'TRUCK', tr.truck + ' · ' + tr.wt + ' t removed');
    return afterTrucks_(me, cid, oid, tr.truck + ' removed.');
  } finally { lock.releaseLock(); }
}
function truckStep_(me, cid) {
  if (!cyclesOn_()) throw new Error('Cycles are not set up yet.');
  var cyc = freshLead_('CYC', cid), scfg = stepCfg_('CYC');
  if (cyc.closed) throw new Error(cid + ' is closed.');
  if (cyc.cur === 'ADVANCE') throw new Error('Record the payment of ' + cid + ' first — trucks can be added after it.');
  if (cyc.cur !== 'TRANSPORT') throw new Error('The trucks of ' + cid + ' can no longer change — it is at "' + (scfg[cyc.cur] || {}).label + '".');
  if (!canAct_(me, 'CYC', cyc, 'TRANSPORT')) throw new Error('This step is not assigned to you.');
  return cyc;
}
function afterTrucks_(me, cid, oid, msg) {
  MEMO_['rows_' + TABS.TRUCKS.name] = null;
  var lay = layout_('CYC'), st = stepByKey_(lay, 'TRANSPORT'), mine = trucks_(function (x) { return x.cyc === cid; }), cells = {};
  var c1 = fieldCol_(st, 'Trucks'), c2 = fieldCol_(st, 'Weight loaded (t)');
  if (c1 >= 0) cells[c1] = mine.map(function (x) { return x.truck + ' (' + x.wt + ' t)'; }).join(', ');
  if (c2 >= 0) cells[c2] = mine.length ? round2_(mine.reduce(function (a, x) { return a + x.wt; }, 0)) : '';
  writeCells_('CYC', findRow_('CYC', cid), cells);
  var o = writeOrderSummary_(me, oid), det = leadDetailFor_(me, 'CYC', cid);
  bumpVer_({ CYC: [det.lead], O2D: o ? [o] : [] });
  return { ok: true, msg: msg, detail: det, order: o };
}

/* ---------------------------------------------------------------- one-time move to cycles (?cycles=1) */

var OLD_CYCLE_STEPS = ['ADVANCE', 'TRANSPORT', 'S6A', 'DISPATCH', 'PAY_CONFIRM', 'INVOICE', 'DELIVERY', 'BALANCE_PAY'];

/** Builds a flow tab from blocks: [{ what, who, how, when, cols: [{ h, kind, type, opts }] }] (block 0 = the details). */
function writeSpecTab_(ss, name, fid, blocks, data) {
  var heads = [], lab = [[], [], [], []], info = [];
  blocks.forEach(function (b, bi) {
    b.cols.forEach(function (c, k) {
      var j = heads.length;
      heads.push(c.h);
      lab.forEach(function (r) { r[j] = ''; });
      if (bi === 0 && j === 0) { lab[0][0] = 'What'; lab[1][0] = 'Who'; lab[2][0] = 'How'; lab[3][0] = 'When (hrs)'; }
      if (k === (bi === 0 ? 1 : 0)) { lab[0][j] = b.what; lab[1][j] = b.who; lab[2][j] = b.how; lab[3][j] = b.when; }
      info.push({ j: j, col: j, head: c.h, block: bi, kind: c.kind || 'field', type: c.type || 'text', opts: c.opts || null });
    });
  });
  var K = heads.length, title = [FLOWS[fid].title.toUpperCase()];
  for (var i = 1; i < K; i++) title.push('');
  title[4] = 'Kept by the Leads & Orders app · one row per ' + FLOWS[fid].unit + ' · type only in the white columns of a step';
  var need = Math.max(1000, ROW.FIRST + data.length + 500);
  // built under a temporary name; the old tab is only replaced once the new one is complete
  var tmp = name + ' (new)', sh = freshTab_(ss, tmp, need, K);
  if (sh.getMaxColumns() < K) sh.insertColumnsAfter(sh.getMaxColumns(), K - sh.getMaxColumns());
  if (sh.getMaxRows() < need) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows());
  var all = [title].concat(lab).concat([heads]).concat(data.map(function (r) { r = r.slice(0, K); while (r.length < K) r.push(''); return r; }));
  sh.getRange(1, 1, all.length, K).setValues(all);
  formatFlowTab_(sh, fid, info, need);
  var old = ss.getSheetByName(name);
  if (old) ss.deleteSheet(old);
  sh.setName(name);
  return sh;
}
function stepCols_(st) {          // old step block → [{ c, h, kind, type, opts }] in sheet order
  var out = [{ c: st.p, h: 'Planned', kind: 'planned', type: 'datetime' }, { c: st.a, h: 'Actual', kind: 'actual', type: 'datetime' }];
  if (st.s >= 0) out.push({ c: st.s, h: st.statusHead || 'Status', kind: 'status', opts: st.opts });
  if (st.d >= 0) out.push({ c: st.d, h: 'Time Delay', kind: 'delay' });
  st.fields.forEach(function (f) { out.push({ c: f.c, h: f.k, kind: 'field', type: f.t, opts: f.o }); });
  return out.sort(function (a, b) { return a.c - b.c; });
}
function pcol_(h) { return { h: h }; }
function stdCols_(opts, fields) {
  return [{ h: 'Planned', kind: 'planned', type: 'datetime' }, { h: 'Actual', kind: 'actual', type: 'datetime' }, { h: 'Status', kind: 'status', opts: opts },
          { h: 'Time Delay', kind: 'delay' }].concat(fields);
}

function migrateCycles_() {
  var ss = appSs_(), p = PropertiesService.getScriptProperties(), stamp = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'd MMM yyyy HH:mm');
  FLOW_IDS.forEach(function (f) { cache_().remove('lay_' + f + LAY_V); });
  MEMO_ = { ss: ss };
  var lay = layout_('O2D'), keys = lay.steps.map(function (s) { return s.key; });
  if (keys.indexOf('CYCLES') > -1) throw new Error('ORDERS already has cycles.');
  ['STATION', 'CLIENT_OK', 'ESTIMATE', 'ADVANCE', 'TRANSPORT', 'DISPATCH', 'PAY_CONFIRM', 'INVOICE', 'DELIVERY', 'BALANCE_PAY'].forEach(function (k) {
    if (keys.indexOf(k) < 0) throw new Error('ORDERS has no step ' + k + '; nothing changed.');
  });
  var S = function (k) { return stepByKey_(lay, k); }, sh = fmsSheet_('O2D');
  var backup = sh.copyTo(ss).setName('ORDERS before cycles ' + stamp);
  var top = sh.getRange(1, 1, ROW.HEAD, lay.cols).getDisplayValues();
  var last = sh.getLastRow(), raw = last >= ROW.FIRST ? sh.getRange(ROW.FIRST, 1, last - ROW.FIRST + 1, lay.cols).getValues().filter(function (r) { return String(r[0]).trim(); }) : [];
  var board = {};
  buildBoard_('O2D').leads.forEach(function (l) { board[l.id] = l; });
  var old = {};
  readFlow_('O2D').forEach(function (l) { old[l.id] = l; });

  // ---- ORDERS: details + steps 2–4 as they are, then "In cycles"
  var baseCols = lay.base.map(function (b) { return { c: b.c, h: b.k, kind: b.c === 0 ? 'id' : b.c === 1 ? 'ts' : 'field', type: b.c === 1 ? 'datetime' : b.t, opts: b.o }; });
  var keepSteps = ['STATION', 'CLIENT_OK', 'ESTIMATE'].map(S);
  var oBlocks = [{ what: top[ROW.WHAT - 1][1], who: top[ROW.WHO - 1][1], how: top[ROW.HOW - 1][1], when: top[ROW.WHEN - 1][1], cols: baseCols }]
    .concat(keepSteps.map(function (st) {
      return { what: top[ROW.WHAT - 1][st.p] || st.title, who: top[ROW.WHO - 1][st.p], how: top[ROW.HOW - 1][st.p], when: top[ROW.WHEN - 1][st.p], cols: stepCols_(st) };
    }))
    .concat([{ what: 'DISPATCH IN CYCLES (5)', who: 'SALES PERSON', how: 'In the app', when: '', cols: stdCols_(['Completed', 'Closed – rest cancelled'],
      [{ h: 'Loaded (t)', type: 'number' }, { h: 'Balance (t)', type: 'number' }, { h: 'Cycles' }, { h: 'Remark', type: 'textarea' }]) }]);
  var copyIdx = [];
  oBlocks.slice(0, 4).forEach(function (b) { b.cols.forEach(function (c) { copyIdx.push(c.c); }); });

  // ---- CYCLES tab blocks (who / how / hours from the old steps)
  var tb = function (k) { var st = S(k); return { who: top[ROW.WHO - 1][st.p], how: top[ROW.HOW - 1][st.p], when: top[ROW.WHEN - 1][st.p], opts: st.opts }; };
  var cBase = [{ h: 'Cycle No', kind: 'id' }, { h: 'Timestamp', kind: 'ts', type: 'datetime' }, pcol_('Order No'), pcol_('SALES PER.'), pcol_('PARTY NAME'), pcol_('Mines/Factory'), pcol_('Mat. Gr.')];
  var CSPEC = [
    ['ADVANCE', 'CYCLE PAYMENT (6)', CYCLE_TERMS, [{ h: 'Amount', type: 'number' }, { h: 'Tons covered', type: 'number' }, { h: 'Remark', type: 'textarea' }]],
    ['TRANSPORT', 'TRUCKS (7)', ['Done'], [{ h: 'Trucks' }, { h: 'Weight loaded (t)', type: 'number' }, { h: 'Remark', type: 'textarea' }]],
    ['DISPATCH', 'DISPATCH (8)', null, [{ h: 'Dispatch Date', type: 'date' }, { h: 'Veh. Reached at site' }, { h: 'Remark', type: 'textarea' }]],
    ['PAY_CONFIRM', 'PAYMENT CONFIRMATION (9)', null, [{ h: 'Remark', type: 'textarea' }]],
    ['INVOICE', 'CHECK & SEND INVOICE (10)', null, [{ h: 'Invoice No.' }, { h: 'Remark', type: 'textarea' }]],
    ['DELIVERY', 'CONFIRMATION OF DELIVERY (11)', null, [{ h: 'Remark', type: 'textarea' }]],
    ['BALANCE_PAY', 'CALL FOR BALANCE PAYMENT (12)', null, [{ h: 'Remark 1' }, { h: 'Remark 2' }, { h: 'Remark', type: 'textarea' }]]
  ];
  var cBlocks = [{ what: 'CYCLE DETAILS (1)', who: 'APP', how: 'From the order', when: '', cols: cBase }].concat(CSPEC.map(function (x) {
    var t = tb(x[0]); return { what: x[1], who: t.who, how: t.how, when: t.when, cols: stdCols_(x[2] || t.opts, x[3]) };
  }));
  // column positions inside the new CYCLES rows
  var cPos = {}, j = 0;
  cBlocks.forEach(function (b, bi) {
    b.cols.forEach(function (c) {
      var k = bi === 0 ? 'base' : CSPEC[bi - 1][0];
      var nm = c.kind === 'planned' ? '@p' : c.kind === 'actual' ? '@a' : c.kind === 'status' ? '@s' : c.kind === 'delay' ? '@d' : c.h;
      cPos[k + ':' + nm] = j++;
    });
  });
  var CW = j;

  // ---- every order
  var oRows = [], cRows = [], tRows = [], states = [], events = [], cnt = { orders: 0, inCycles: 0, carried: 0, fresh: 0, archived: 0, completed: 0, trucks: 0 };
  var mapTerm = function (st, term) {
    var t = String(term || '').trim(), s = String(st || '').trim();
    if (['Credit', 'On Dispatch', 'On Delivery'].indexOf(t) > -1) return t;
    if (['Credit', 'On Dispatch', 'On Delivery'].indexOf(s) > -1) return s;
    if (/^(yes|full advance|part payment|done)$/i.test(s) || /^(part payment|done)$/i.test(t)) return CYCLE_TERMS[0];
    return s;
  };
  raw.forEach(function (r) {
    var id = String(r[0]).trim(), b = board[id] || {}, o = old[id] || { s: {}, b: {} }, now = new Date();
    cnt.orders++;
    var x = function (k) { return o.s[k] || { f: {} }; };
    var has = OLD_CYCLE_STEPS.some(function (k) { var y = x(k); return y.a || y.s || Object.keys(y.f || {}).some(function (h) { return y.f[h] !== '' && y.f[h] != null; }); });
    var qty = qtyNum_(pick_(o.b, 'QTY.')), tr = x('TRANSPORT'), wt = qtyNum_(tr.f['WT.']), bal = String(tr.f['Balance WT.'] == null ? '' : tr.f['Balance WT.']).trim();
    var loadedOld = wt > 0 ? wt : (bal !== '' && !isNaN(Number(bal)) ? Math.max(0, qty - Number(bal)) : (tr.a ? qty : 0));
    var s6aOpen = !!tr.a && !x('S6A').a && qtyNum_(bal) > 0.01;
    var row = copyIdx.map(function (c) { return r[c]; }), cyc = ['', '', '', '', '', '', '', ''];   // P A S D Loaded Balance Cycles Remark
    var made = [], ow = pick_(o.b, 'SALES PER.');
    var newCycleRow = function (n, steps) {
      var cr = []; for (var q = 0; q < CW; q++) cr.push('');
      var cid = id + '-C' + n, put = function (k, h, v) {
        var pos = cPos[k + ':' + h];
        if (typeof v === 'number' && v > 1e11 && /date/i.test(h)) v = new Date(v);    // dates come out of readFlow_ as numbers
        if (pos != null && v !== undefined) cr[pos] = v;
      };
      put('base', 'Cycle No', cid); put('base', 'Timestamp', steps ? (r[1] || now) : now); put('base', 'Order No', id);
      ['SALES PER.', 'PARTY NAME', 'Mines/Factory', 'Mat. Gr.'].forEach(function (h) { put('base', h, pick_(o.b, h)); });
      if (steps) Object.keys(steps).forEach(function (k) { var y = steps[k]; Object.keys(y).forEach(function (h) { put(k, h, y[h]); }); });
      cRows.push(cr); made.push(cid);
      return cid;
    };
    var carry = function () {          // the shipment already on its way, with everything typed so far
      var y = function (k) { return x(k); }, f = function (k, h) { var v = (y(k).f || {})[h]; return v == null ? '' : v; };
      var steps = {
        ADVANCE: { '@p': y('ADVANCE').p ? new Date(y('ADVANCE').p) : '', '@a': y('ADVANCE').a ? new Date(y('ADVANCE').a) : '', '@s': mapTerm(y('ADVANCE').s, f('ADVANCE', 'Payment Term')),
                   'Tons covered': round2_(loadedOld), Remark: [f('ADVANCE', 'Payment Term') ? 'Payment term: ' + f('ADVANCE', 'Payment Term') : '', f('ADVANCE', 'Remark')].filter(String).join(' · ') },
        TRANSPORT: { 'Trucks': [f('TRANSPORT', 'VEH.'), f('TRANSPORT', 'TPT. NAME')].filter(String).join(' · '), 'Weight loaded (t)': loadedOld ? round2_(loadedOld) : '' },
        DISPATCH: { 'Dispatch Date': f('DISPATCH', 'Act. Date'), 'Veh. Reached at site': f('DISPATCH', 'Veh. Reached at site') },
        PAY_CONFIRM: { Remark: f('PAY_CONFIRM', 'Remark') }, INVOICE: { Remark: f('INVOICE', 'Remark') }, DELIVERY: { Remark: f('DELIVERY', 'Remark') },
        BALANCE_PAY: { 'Remark 1': f('BALANCE_PAY', 'Remark 1'), 'Remark 2': f('BALANCE_PAY', 'Remark 2'), Remark: f('BALANCE_PAY', 'Remark') }
      };
      ['TRANSPORT', 'DISPATCH', 'PAY_CONFIRM', 'INVOICE', 'DELIVERY', 'BALANCE_PAY'].forEach(function (k) {
        var z = y(k); steps[k]['@p'] = z.p ? new Date(z.p) : ''; steps[k]['@a'] = z.a ? new Date(z.a) : ''; steps[k]['@s'] = z.s || '';
      });
      var cid = newCycleRow(1, steps);
      if (tr.a || f('TRANSPORT', 'VEH.')) { tRows.push([cid, id, String(f('TRANSPORT', 'VEH.') || '(not noted)').toUpperCase(), f('TRANSPORT', 'TPT. NAME'), f('TRANSPORT', 'MOB.'), round2_(loadedOld), now, 'Moved from the old order', '']); cnt.trucks++; }
      return cid;
    };
    var closedBy = b.closed, lost = closedBy && closedBy.o === 'lost', won = closedBy && closedBy.o === 'won';
    if (lost) {
      if (has) { var ca = carry(); states.push(['CYC', ca, 'closed', JSON.stringify({ o: 'lost', at: closedBy.at || Date.now(), by: 'System', why: 'Order closed as lost before cycles', step: '' }), now, 'system']); cnt.archived++; }
    } else if (won && !s6aOpen) {
      cyc[1] = closedBy.at ? new Date(closedBy.at) : now; cyc[2] = 'Completed'; cnt.completed++;
      if (has) {
        var cw = carry();
        if (!x('BALANCE_PAY').a) states.push(['CYC', cw, 'closed', JSON.stringify({ o: 'won', at: closedBy.at || Date.now(), by: 'System', why: 'Order completed before cycles', step: '' }), now, 'system']);
        cnt.archived++;
      }
      cyc[4] = loadedOld ? round2_(loadedOld) : ''; cyc[5] = qty ? round2_(qty - loadedOld) : ''; cyc[6] = made.length ? made.length + ' (all done)' : '';
    } else if (b.cur && ['STATION', 'CLIENT_OK', 'ESTIMATE'].indexOf(b.cur) > -1) {
      // not yet at the payment: nothing to move
    } else {
      cnt.inCycles++;
      var loaded = 0, remark = '';
      if (tr.a) { carry(); loaded = loadedOld; cnt.carried++; }
      else if (has) {
        var y0 = x('ADVANCE');
        remark = 'Before cycles: ' + [y0.s ? 'advance step "' + y0.s + '"' : '', (y0.f || {})['Payment Term'] ? 'payment term ' + y0.f['Payment Term'] : '', (y0.f || {}).Remark || ''].filter(String).join(' · ');
      }
      if (!qty || qty - loaded > 0.01) {
        var fresh = newCycleRow(made.length + 1, remark ? { ADVANCE: { Remark: remark.slice(0, 500) } } : null);
        cnt.fresh++;
        events.push([now, 'system', 'System', 'CYC', fresh, '', 'CYCLE', 'Cycle started when the order moved to cycles', '', '', '', '', '']);
      }
      cyc[4] = round2_(loaded); cyc[5] = qty ? round2_(qty - loaded) : ''; cyc[6] = made.length + ' (moved from the old steps)';
    }
    if (has) {
      var det = {};
      OLD_CYCLE_STEPS.forEach(function (k) { var y = x(k); if (y.a || y.s || Object.keys(y.f || {}).length) det[k] = { p: y.p || '', a: y.a || '', s: y.s || '', f: y.f || {} }; });
      events.push([now, 'system', 'System', 'O2D', id, 'CYCLES', 'MOVE', 'Steps 5–11 moved to cycles' + (made.length ? ' (' + made.join(', ') + ')' : ''), '', '', '', '', JSON.stringify(det).slice(0, 45000)]);
    }
    oRows.push(row.concat(cyc));
  });

  // ---- write
  var oSh = writeSpecTab_(ss, FLOWS.O2D.tab, 'O2D', oBlocks, oRows);
  var cSh = writeSpecTab_(ss, FLOWS.CYC.tab, 'CYC', cBlocks, cRows);
  cSh.setTabColor('#B7791F');
  var tt = tab_(TABS.TRUCKS);
  if (tRows.length) tt.getRange(tt.getLastRow() + 1, 1, tRows.length, tRows[0].length).setValues(tRows);
  if (states.length) { var stt = tab_(TABS.STATE); stt.getRange(stt.getLastRow() + 1, 1, states.length, states[0].length).setValues(states); }
  if (events.length) { var es = tab_(TABS.EVENTS); es.getRange(es.getLastRow() + 1, 1, events.length, events[0].length).setValues(events); }
  try {
    ss.setActiveSheet(oSh); ss.moveActiveSheet(2);
    ss.setActiveSheet(cSh); ss.moveActiveSheet(3);
    ss.setActiveSheet(tt); ss.moveActiveSheet(4);
  } catch (e) {}

  // ---- Steps tab
  var st = ss.getSheetByName('Steps'), sw = Math.max(st.getLastColumn(), 15), sv = st.getRange(1, 1, Math.max(1, st.getLastRow()), sw).getValues();
  var head = sv[0], rest = sv.slice(1).filter(function (r) { return String(r[0]).trim() && !(hKey_(r[0]) === hKey_(FLOWS.O2D.tab) && OLD_CYCLE_STEPS.indexOf(String(r[2]).trim()) > -1); });
  var oi = 0;
  rest.forEach(function (r, i) { if (hKey_(r[0]) === hKey_(FLOWS.O2D.tab)) oi = i + 1; });
  rest.splice(oi, 0, ['ORDERS', '5', 'CYCLES', 'DISPATCH IN CYCLES', 'ESTIMATE Actual', 'Completed', 'Closed – rest cancelled']);
  var froms = { ADVANCE: 'Timestamp', TRANSPORT: 'ADVANCE Actual', DISPATCH: 'TRANSPORT Actual', PAY_CONFIRM: 'DISPATCH Actual', INVOICE: 'PAY_CONFIRM Actual', DELIVERY: 'INVOICE Actual', BALANCE_PAY: 'DELIVERY Actual' };
  CSPEC.forEach(function (x2, i) { rest.push([FLOWS.CYC.tab, String(6 + i), x2[0], x2[1].replace(/\s*\(\d+\)$/, ''), froms[x2[0]]].concat(x2[2] || S(x2[0]).opts)); });
  var allRows = [head].concat(rest).map(function (r) { r = r.slice(0, sw); while (r.length < sw) r.push(''); return r; });
  var clearN = Math.max(sv.length, allRows.length) + 5;
  st.getRange(1, 1, clearN, sw).clearContent();
  st.getRange(1, 2, allRows.length, 1).setNumberFormat('@');
  st.getRange(1, 1, allRows.length, sw).setValues(allRows);

  // ---- settings: cycle steps take over the old order steps' people, labels, tiles
  var s = settings_(), steps = s.steps || {}, O = steps.O2D || {}, C = steps.CYC || {};
  var mapRef = function (ref) {
    var m = {
      'base:QTY.': 'ADVANCE:Tons covered', 'TRANSPORT:TPT. NAME': 'TRANSPORT:Trucks', 'TRANSPORT:VEH.': 'TRANSPORT:Trucks', 'TRANSPORT:MOB.': 'TRANSPORT:Trucks',
      'TRANSPORT:WT.': 'TRANSPORT:Weight loaded (t)', 'ADVANCE:Payment Term': 'ADVANCE:@status', 'DISPATCH:Act. Date': 'DISPATCH:Dispatch Date'
    };
    if (m[ref]) return m[ref];
    if (/^base:(Mines\/Factory|Mat\. Gr\.|PARTY NAME|SALES PER\.)$/.test(ref)) return ref;
    var k = ref.slice(0, ref.indexOf(':'));
    return ['ADVANCE', 'TRANSPORT', 'DISPATCH', 'PAY_CONFIRM', 'INVOICE', 'DELIVERY', 'BALANCE_PAY'].indexOf(k) > -1 && !/Balance WT|Est\. Date/.test(ref) ? ref : null;
  };
  ['ADVANCE', 'TRANSPORT', 'DISPATCH', 'PAY_CONFIRM', 'INVOICE', 'DELIVERY', 'BALANCE_PAY'].forEach(function (k) {
    var src = O[k];
    if (!src) return;
    var seen = {}, card = (src.card || []).map(mapRef).filter(function (x2) { if (!x2 || seen[x2]) return false; seen[x2] = 1; return true; });
    C[k] = { label: k === 'ADVANCE' ? 'Cycle payment' : k === 'TRANSPORT' ? 'Trucks' : src.label, ownerActs: src.ownerActs, doers: src.doers || [], photo: src.photo,
             side: '', card: card, required: ((DEFAULT_REQUIRED.CYC || {})[k] || []).slice() };
  });
  OLD_CYCLE_STEPS.forEach(function (k) { delete O[k]; });
  O.CYCLES = { label: 'In cycles', ownerActs: true, doers: [], required: [], side: '', photo: false, card: DEFAULT_CARD.O2D.CYCLES.slice() };
  steps.O2D = O; steps.CYC = C;
  setSetting_('steps', steps, 'system');
  var la = s.lateAlerts;
  if (la && la.O2D) { la.CYC = la.CYC || {}; OLD_CYCLE_STEPS.forEach(function (k) { if (la.O2D[k]) { la.CYC[k] = la.O2D[k]; delete la.O2D[k]; } }); setSetting_('lateAlerts', la, 'system'); }

  // ---- switch on
  p.setProperty('CYCLES_ON', new Date().toISOString());
  if (FLOW_IDS.indexOf('CYC') < 0) FLOW_IDS.push('CYC');
  FLOW_IDS.forEach(function (f) { cache_().remove('lay_' + f + LAY_V); });
  cache_().remove('settings');
  MEMO_ = { ss: ss };
  cnt.backup = backup.getName();
  cnt.cycles = cRows.length;
  return cnt;
}

/**
 * One-time repair (16 Nov 2026): the move reopened 22 orders that were completed in the old steps because their
 * Balance WT. kept a weighbridge leftover (e.g. 0.19 t) and 6A was never marked. Such an order — every moved
 * cycle done, the only open cycle an untouched one the move created — goes back to completed; that empty cycle
 * row is removed. Orders with a cycle anyone has worked on are left alone.
 */
function cyclesFix1_() {
  var ss = appSs_(), out = { restored: [], kept: [] };
  MEMO_ = { ss: ss };
  var lay = layout_('O2D'), st = stepByKey_(lay, 'CYCLES'), csh = fmsSheet_('CYC'), del = [];
  var trucksAll = trucks_(function () { return true; });
  readFlow_('O2D').forEach(function (o0) {
    var o = JSON.parse(JSON.stringify(o0));
    decorate_('O2D', o, lay, stepCfg_('O2D'), leadState_('O2D'), Date.now());
    if (o.cur !== 'CYCLES') return;
    var sum = orderSummary_(o.id), cyc = readFlow_('CYC').filter(function (c) { return String(pick_(c.b, 'Order No')).trim() === o.id; });
    var moved = sum.cycles.filter(function (c) { return c.closed; }), open = sum.cycles.filter(function (c) { return !c.closed; });
    var untouched = function (c) {
      var raw = cyc.filter(function (x) { return x.id === c.id; })[0];
      return raw && c.cur === 'ADVANCE' && !raw.s.ADVANCE.a && !raw.s.ADVANCE.s && !Object.keys(raw.s.ADVANCE.f || {}).some(function (h) { return h !== 'Remark' && raw.s.ADVANCE.f[h] !== '' && raw.s.ADVANCE.f[h] != null; }) &&
        !trucksAll.some(function (t) { return t.cyc === c.id; });
    };
    if (!moved.length || !open.length || !open.every(untouched)) { if (moved.length) out.kept.push(o.id); return; }
    var at = 0;
    cyc.forEach(function (c) { var a = ((c.s.BALANCE_PAY || {}).a) || 0; if (a > at) at = a; });
    var cells = {}; cells[st.a] = at ? new Date(at) : new Date(); if (st.s >= 0) cells[st.s] = 'Completed';
    var cc = fieldCol_(st, 'Cycles'); if (cc >= 0) cells[cc] = moved.length + ' (all done)';
    writeCells_('O2D', o.r, cells);
    open.forEach(function (c) { del.push(findRow_('CYC', c.id)); });
    out.restored.push(o.id + ' (' + sum.balance + ' t left of ' + sum.qty + ')');
  });
  del.sort(function (a, b) { return b - a; }).forEach(function (r) { csh.deleteRow(r); });
  out.removedCycleRows = del.length;
  MEMO_ = { ss: ss };
  return out;
}
function cyclesFixOut_() {
  var p = PropertiesService.getScriptProperties(), res;
  if (p.getProperty('CYC_FIX1')) res = { already: p.getProperty('CYC_FIX1') };
  else {
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try { res = cyclesFix1_(); p.setProperty('CYC_FIX1', new Date().toISOString()); }
    catch (e) { res = { error: String(e.message || e) }; }
    finally { lock.releaseLock(); }
    if (!res.error) { p.setProperty('BOARD_BUILT', '0'); p.deleteProperty('REBUILDING'); try { rebuildBoards_(); } catch (e) { res.rebuild = String(e); } }
  }
  return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
}

/** ?cycles=1 — runs once (CYCLES_ON). */
function cyclesOut_() {
  var p = PropertiesService.getScriptProperties(), res;
  if (p.getProperty('CYCLES_ON')) res = { already: p.getProperty('CYCLES_ON') };
  else {
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      if (p.getProperty('CYCLES_ON')) res = { already: p.getProperty('CYCLES_ON') };
      else res = migrateCycles_();
    } catch (e) { res = { error: String(e.message || e), stack: String(e.stack || '').slice(0, 800) }; }
    finally { lock.releaseLock(); }
    if (res && !res.error && !res.already) {
      p.setProperty('BOARD_BUILT', '0'); p.deleteProperty('REBUILDING');
      try { rebuildBoards_(); } catch (e) { res.rebuild = String(e); }
      var cnt = {};
      ['O2D', 'CYC'].forEach(function (f) { boardData_(f).leads.forEach(function (l) { if (l.cur) cnt[f + ':' + l.cur] = (cnt[f + ':' + l.cur] || 0) + 1; }); });
      res.board = cnt;
    }
  }
  return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
}
