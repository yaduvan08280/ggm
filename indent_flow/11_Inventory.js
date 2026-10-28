/**********************************************************************
 * File: 11_Inventory.gs  —  Per-site item master and stock
 *
 *  Each site keeps its own tab: INV_TONK, INV_NEWAI, INV_SANWARIYA,
 *  INV_KHAKHUNDA. One row per item.
 *
 *  WHAT YOU SET
 *    Item_Name / Part_Number / Unit / Section   what the thing is
 *    Initial_Stock        the opening balance. Every later figure is
 *                         derived from this plus the ledger, so it is
 *                         the one number that anchors the whole item.
 *    Lead_Time_Days       order to receipt
 *    Safety_Stock         the buffer you always want on the shelf
 *    Min_Order_Qty        the vendor will not sell less
 *    Max_Order_Qty        above this, purchase cannot act alone
 *    ROP_Override         a reorder point you set by hand; blank means
 *                         trust the calculation
 *
 *  WHAT THE APP DERIVES  — editing these by hand achieves nothing
 *    Total_IN / Total_OUT      summed from the ledger
 *    Current_Stock             Initial + IN - OUT
 *    Avg_Daily_Consumption     out-movements over the lookback window
 *    Reorder_Point             (ADC x Lead_Time) + Safety_Stock
 *
 *  The ledger is the single source of truth. Both the app and a person
 *  typing into the sheet write to it, and the figures above are
 *  recomputed from it — so the two can never disagree.
 *********************************************************************/

/* ================================================================== */
/*  The ledger, totalled                                               */
/* ================================================================== */

/** Key an item for totalling.
 *
 *  NAME ONLY, deliberately. A ledger row's part number is whatever the
 *  indent happened to carry — often blank — while the name is always
 *  there and is what findItem_ treats as the item's identity. Keying on
 *  both would file the same item under two keys and total only one of
 *  them, which is how an issue can vanish from a figure. Two items may
 *  not share a name at one site; that is checked when they are added. */
function itemKey_(name) {
  return String(name || '').trim().toLowerCase();
}

/** Every movement in the ledger, totalled per site and item, in ONE read.
 *  Checkpoints (a hub count, goods still with a purchaser) are skipped —
 *  they record a quantity without putting anything on a shelf.
 *
 *  `range` optionally narrows to { from, to } as Date objects. */
function ledgerTotals_(range) {
  var key = '~lt_' + (range ? (+range.from + '_' + +range.to) : 'all');
  if (_MEMO[key]) return _MEMO[key];

  var out = {};
  readAll_(SH.STOCK).forEach(function (r) {
    var flag  = safeStr_(r.Moves_Stock).toUpperCase();
    var moves = flag ? (flag === 'Y') : txnMovesStock_(r.Transaction_Type);
    if (!moves) return;

    if (range) {
      var at = toDate_(r.Timestamp);
      if (!at || at < range.from || at > range.to) return;
    }

    var site = String(r.Site || '').toUpperCase().trim();
    var k = site + '::' + itemKey_(r.Product_Name);
    if (!out[k]) out[k] = { in: 0, out: 0, rows: 0 };
    var q = num_(r.Quantity, 0);
    if (q >= 0) out[k].in += q; else out[k].out += -q;
    out[k].rows++;
  });

  _MEMO[key] = out;
  return out;
}

/** The totals above are memoised for the execution, and appending to the
 *  ledger invalidates them. memoClear_ only knows about sheet names, so
 *  these keys are cleared by hand — a stale total would hand a guard a
 *  figure from before the movement it is guarding. */
function clearLedgerCache_() {
  Object.keys(_MEMO).forEach(function (k) { if (k.indexOf('~lt_') === 0) delete _MEMO[k]; });
}

/** One item's totals at one site. */
function totalsFor_(totals, site, name) {
  return totals[String(site || '').toUpperCase().trim() + '::' + itemKey_(name)] ||
         { in: 0, out: 0, rows: 0 };
}

/* ================================================================== */
/*  Reading                                                            */
/* ================================================================== */

function invRows_(site) {
  var tab = invSheet_(site);
  if (!tab) return [];
  return readAll_(tab).filter(function (r) { return truthy_(r.Active) && safeStr_(r.Item_Name); });
}

function shapeItem_(r, site, totals) {
  totals = totals || ledgerTotals_();
  var t = totalsFor_(totals, site, r.Item_Name);

  var initial = num_(r.Initial_Stock, 0);
  var stock   = initial + t.in - t.out;
  var adc     = num_(r.Avg_Daily_Consumption, 0);
  var lead    = num_(r.Lead_Time_Days, 0);
  var safety  = num_(r.Safety_Stock, 0);
  var override= blankNum_(r.ROP_Override);
  var rop     = override === '' ? reorderPointOf_(adc, lead, safety) : num_(override, 0);
  var maxOrd  = num_(r.Max_Order_Qty, 0);

  return {
    code       : safeStr_(r.Item_Code),
    name       : safeStr_(r.Item_Name),
    partNumber : safeStr_(r.Part_Number),
    unit       : safeStr_(r.Unit) || 'NOS',
    section    : safeStr_(r.Section),
    site       : site,

    initialStock: initial,
    totalIn    : t.in,
    totalOut   : t.out,
    stock      : stock,

    adc        : adc,
    leadDays   : lead,
    safetyStock: safety,
    reorderPoint: rop,
    ropOverride: override,

    minOrderQty: num_(r.Min_Order_Qty, 0),
    maxOrderQty: maxOrd,

    /* Five bands, on the reorder point rather than a hand-set floor.
       They are kept apart so the tile figures add up and nothing is
       counted twice. */
    band       : stockBand_(stock, rop, safety),
    daysOfCover: adc > 0 ? Math.round((stock / adc) * 10) / 10 : '',

    notes      : safeStr_(r.Notes),
    pending    : false,          // filled in by listInventory_ where relevant
    updatedAt  : iso_(r.Updated_At),
    updatedBy  : safeStr_(r.Updated_By)
  };
}

/** Where an item sits, against its own reorder point.
 *
 *    OUT       nothing on the shelf
 *    CRITICAL  at or below the safety buffer — it should never be here
 *    LOW       at or below the reorder point — order now
 *    WATCH     within a quarter of the reorder point
 *    HEALTHY   above all of that
 */
function stockBand_(stock, rop, safety) {
  if (stock <= 0) return 'OUT';
  if (safety > 0 && stock <= safety) return 'CRITICAL';
  if (rop > 0 && stock <= rop) return 'LOW';
  if (rop > 0 && stock <= rop * 1.25) return 'WATCH';
  return 'HEALTHY';
}

/** The item list for a site, with a date range applied to the movement
 *  figures. Site-bound people always get their own site. */
function listInventory_(token, p) {
  var actor = requireAuth_(token);
  p = p || {};
  var site  = inventorySiteFor_(actor, p.site);
  var q     = safeStr_(p.q).toLowerCase();
  var range = dateRange_(p.range, p.from, p.to);

  /* Each band stands for exactly itself, so the tile figures and the list
     always agree. REORDER is the one exception, and it is a deliberate
     shorthand for "everything that wants ordering" rather than a band an
     item can be in. */
  var bands = {};
  (p.bands || []).forEach(function (l) {
    var b = String(l).toUpperCase();
    if (b === 'REORDER') { bands.OUT = true; bands.CRITICAL = true; bands.LOW = true; }
    else bands[b] = true;
  });
  /* A browser tab left open from before this screen was rebuilt still asks
     in the old two-band language, where "LOW" meant everything short. It is
     answered in its own terms rather than being quietly given a narrower
     list than the tile it just pressed says. */
  (p.levels || []).forEach(function (l) {
    var b = String(l).toUpperCase();
    if (b === 'LOW') { bands.LOW = true; bands.CRITICAL = true; }
    else bands[b] = true;
  });

  var totals    = ledgerTotals_();
  var inRange   = range.all ? totals : ledgerTotals_(range);
  var openingAt = range.all ? null : ledgerTotals_({ from: new Date(0), to: range.from });

  var all = invRows_(site).map(function (r) {
    var i = shapeItem_(r, site, totals);
    if (!range.all) {
      var t0 = totalsFor_(openingAt, site, r.Item_Name);
      var tr = totalsFor_(inRange,   site, r.Item_Name);
      i.openingStock = i.initialStock + t0.in - t0.out;
      i.rangeIn      = tr.in;
      i.rangeOut     = tr.out;
      i.rangeAdc     = range.days > 0 ? Math.round((tr.out / range.days) * 100) / 100 : 0;
    } else {
      i.openingStock = i.initialStock;
      i.rangeIn      = i.totalIn;
      i.rangeOut     = i.totalOut;
      i.rangeAdc     = i.adc;
    }
    return i;
  });

  var items = all;
  if (Object.keys(bands).length) {
    items = items.filter(function (i) { return bands[i.band]; });
  }
  if (q) {
    items = items.filter(function (i) {
      return (i.name + ' ' + i.partNumber + ' ' + i.section).toLowerCase().indexOf(q) !== -1;
    });
  }
  if (safeStr_(p.section)) {
    var sec = safeStr_(p.section).toUpperCase();
    items = items.filter(function (i) { return String(i.section).toUpperCase() === sec; });
  }
  items.sort(function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; });

  function band(b) { return all.filter(function (i) { return i.band === b; }).length; }

  return {
    site   : site,
    sites  : String(actor.Site || '').toUpperCase() === SITE_ALL || !actor.Site
               ? siteList_() : [site],
    canEdit: canEditInventory_(actor, site),
    sections: sectionsFor_(site),
    range  : range.label ? { key: range.key, label: range.label,
                             from: iso_(range.from), to: iso_(range.to), days: range.days } : null,
    items  : items,
    shown  : items.length,
    // the tiles always count the whole shelf, never the filtered view
    counts : {
      total   : all.length,
      out     : band('OUT'),
      critical: band('CRITICAL'),
      low     : band('LOW'),
      watch   : band('WATCH'),
      healthy : band('HEALTHY'),
      // everything that needs ordering, which is what the reorder list holds
      reorder : all.filter(function (i) {
                  return i.band === 'OUT' || i.band === 'CRITICAL' || i.band === 'LOW';
                }).length
    }
  };
}

/** Which site's stock this person is looking at. */
function inventorySiteFor_(actor, wanted, strict) {
  var mine = String(actor.Site || '').toUpperCase().trim();
  if (roleNeedsSite_(actor.Role)) {
    if (!isSite_(mine)) {
      throw new Error('Your account is not attached to a site yet, so there is no stock to show. ' +
                      'Ask the administrator to set your site in Users.');
    }
    /* Reading is clamped: a screen that asks for the wrong site is simply
       shown its own, which is what every one of them wants anyway. Writing
       is refused outright — quietly filing a NEWAI item under TONK because
       that is the only site you are allowed would be worse than saying no. */
    var asked = String(wanted || '').toUpperCase().trim();
    if (strict && asked && asked !== SITE_ALL && asked !== mine) {
      throw new Error('You look after ' + mine + ', so you cannot change the ' + asked +
                      ' item list. Ask the ' + asked + ' store team.');
    }
    return mine;                                  // never anybody else's stock
  }
  var w = String(wanted || '').toUpperCase().trim();
  if (!w || w === SITE_ALL) w = isSite_(mine) ? mine : siteList_()[0];
  if (!isSite_(w)) throw new Error('"' + wanted + '" is not one of the four sites.');
  return w;
}

/** The store team maintain their own site; an admin may maintain any. */
function canEditInventory_(actor, site) {
  var role = String(actor.Role).toUpperCase();
  if (role === 'ADMIN') return true;
  if (role !== 'STORE') return false;
  return String(actor.Site || '').toUpperCase().trim() === String(site).toUpperCase().trim();
}

/** One item by name (or part number) at a site. Case-insensitive. */
function findItem_(site, name, partNumber) {
  var tab = invSheet_(site);
  if (!tab) return null;
  var n  = String(name || '').trim().toLowerCase();
  var pn = String(partNumber || '').trim().toLowerCase();
  var hit = null, byPart = null;
  readAll_(tab).forEach(function (r) {
    if (!truthy_(r.Active)) return;
    if (!hit && n && String(r.Item_Name).trim().toLowerCase() === n) hit = r;
    if (!byPart && pn && String(r.Part_Number).trim().toLowerCase() === pn) byPart = r;
  });
  return hit || byPart;
}

/** What the indent form shows under the item box: stock, unit, ceiling. */
function itemLookup_(token, p) {
  var actor = requireAuth_(token);
  var site = inventorySiteFor_(actor, (p && p.site) || '');
  var r = findItem_(site, p && p.name, p && p.partNumber);
  if (!r) return { site: site, known: false };
  var item = shapeItem_(r, site);
  item.known = true;
  return item;
}

/* ================================================================== */
/*  Writing                                                            */
/* ================================================================== */

/** A stock figure is a real, finite, non-negative number — or the field
 *  was left alone. Distinguishes "not a number" from "negative", because
 *  telling somebody their typo is negative helps nobody. */
function invQty_(v, label, allowBlank) {
  if (v === undefined || v === null || safeStr_(v) === '') {
    if (allowBlank) return null;
    throw new Error(label + ' is required.');
  }
  var n = Number(v);
  if (isNaN(n) || !isFinite(n)) throw new Error(label + ' must be a number.');
  if (n < 0) throw new Error(label + ' cannot be negative.');
  return n;
}

/** The fields of an item that a person may set, normalised and checked.
 *  Used both when adding and when editing, so the two can never drift. */
function itemFields_(site, p, existing) {
  var f = {};
  function has(k) { return p[k] !== undefined; }

  if (has('name')) {
    var name = safeStr_(p.name);
    if (!name) throw new Error('Item name is required.');
    f.Item_Name = name;
  }
  if (has('partNumber'))  f.Part_Number   = safeStr_(p.partNumber);
  if (has('unit'))        f.Unit          = safeStr_(p.unit) || 'NOS';
  if (has('section'))     f.Section       = resolveSection_(site, p.section);
  if (has('notes'))       f.Notes         = safeStr_(p.notes);

  if (has('leadDays'))    f.Lead_Time_Days = invQty_(p.leadDays,    'Lead time', true) || 0;
  if (has('safetyStock')) f.Safety_Stock   = invQty_(p.safetyStock, 'Safety stock', true) || 0;
  if (has('minOrderQty')) f.Min_Order_Qty  = invQty_(p.minOrderQty, 'Minimum order quantity', true) || 0;
  if (has('maxOrderQty')) f.Max_Order_Qty  = invQty_(p.maxOrderQty, 'Maximum order quantity', true) || 0;

  if (has('ropOverride')) {
    var o = invQty_(p.ropOverride, 'Reorder point', true);
    f.ROP_Override = o === null ? '' : o;
  }
  if (has('initialStock')) f.Initial_Stock = invQty_(p.initialStock, 'Opening stock', true) || 0;

  if (f.Min_Order_Qty && f.Max_Order_Qty && f.Min_Order_Qty > f.Max_Order_Qty) {
    throw new Error('The minimum order quantity (' + f.Min_Order_Qty + ') is above the maximum (' +
                    f.Max_Order_Qty + '), so no quantity would ever be orderable.');
  }
  return f;
}

/** Add an item. Part number and section are compulsory — without them a
 *  requester cannot find it and the reorder list cannot group it. */
function addInventoryItem_(token, p) {
  var actor = requireRole_(token, ['STORE', 'ADMIN']);
  return withLock_(function () {
    var site = inventorySiteFor_(actor, p && p.site, true);
    if (!canEditInventory_(actor, site)) {
      throw new Error('You can only maintain the stock of your own site.');
    }
    var name = safeStr_(p.name);
    if (!name) throw new Error('Item name is required.');
    if (!safeStr_(p.partNumber)) throw new Error('Part number is required for a new item.');
    if (!safeStr_(p.section))    throw new Error('Choose which section of ' + site + ' keeps this item.');

    var existing = findItem_(site, name, p.partNumber);
    if (existing) {
      throw new Error('"' + safeStr_(existing.Item_Name) + '" is already on the ' + site +
                      ' list. Edit that row instead of adding it again.');
    }
    if (itemRequestPending_(site, name, p.partNumber)) {
      throw new Error('"' + name + '" is already waiting for the administrator to approve it.');
    }

    var opening = invQty_(p.initialStock !== undefined ? p.initialStock : p.stock,
                          'Opening stock', true) || 0;
    var fields = itemFields_(site, p, null);
    fields.Initial_Stock = opening;
    /* When the store adds an item because an indent asked for something not
       on the list, the request carries that indent's number, so the admin
       deciding it can see exactly what it is for. */
    if (safeStr_(p.indentId)) fields.__indentId = safeStr_(p.indentId);

    /* Nothing reaches the item list without the administrator, including a
       brand-new item. The indent it was added for can still move on — the
       name is already written on the indent — so nobody is left waiting. */
    if (String(actor.Role).toUpperCase() !== 'ADMIN') {
      return requestItemChange_(actor, site, null, fields, 'ADD');
    }
    return applyItemAdd_(site, fields, actor);
  });
}

/** Write a new row. Only ever called once the change is allowed. */
function applyItemAdd_(site, fields, actor) {
  delete fields.__indentId;          // a note about why, not a column
  var tab = invSheet_(site);
  var t = now_();
  var row = {
    Item_Code    : nextId_(tab, 'Item_Code', 'ITM', 4),
    Item_Name    : fields.Item_Name,
    Part_Number  : fields.Part_Number || '',
    Unit         : fields.Unit || 'NOS',
    Section      : fields.Section || '',
    Current_Stock: num_(fields.Initial_Stock, 0),
    ROP_Override : fields.ROP_Override === undefined ? '' : fields.ROP_Override,
    Max_Order_Qty: num_(fields.Max_Order_Qty, 0),
    Notes        : fields.Notes || '',
    Active       : 'TRUE',
    Created_By   : actor.Name, Created_At: t,
    Updated_By   : actor.Name, Updated_At: t,
    Avg_Daily_Consumption: 0,
    Lead_Time_Days: num_(fields.Lead_Time_Days, 0),
    Safety_Stock  : num_(fields.Safety_Stock, 0),
    Reorder_Point : reorderPointOf_(0, fields.Lead_Time_Days, fields.Safety_Stock),
    Min_Order_Qty : num_(fields.Min_Order_Qty, 0),
    Initial_Stock : num_(fields.Initial_Stock, 0),
    Total_IN      : 0,
    Total_OUT     : 0
  };
  insert_(tab, row);
  memoClear_();
  return shapeItem_(findBy_(tab, 'Item_Code', row.Item_Code), site);
}

function updateInventoryItem_(token, p) {
  var actor = requireRole_(token, ['STORE', 'ADMIN']);
  return withLock_(function () {
    var site = inventorySiteFor_(actor, p && p.site, true);
    if (!canEditInventory_(actor, site)) {
      throw new Error('You can only maintain the stock of your own site.');
    }
    var tab = invSheet_(site);
    var r = safeStr_(p.code) ? findBy_(tab, 'Item_Code', safeStr_(p.code))
                             : findItem_(site, p.name, p.partNumber);
    if (!r) throw new Error('No such item on the ' + site + ' list.');

    /* The stock figure is derived from the ledger and cannot be typed over.
       Correcting it means either moving the goods or restating the opening
       balance, and both leave a trace. */
    if (p.stock !== undefined && safeStr_(p.stock) !== '') {
      throw new Error('Stock is worked out from the ledger, so it cannot be typed over. ' +
                      'Record a movement for what actually came in or went out, or ask an ' +
                      'administrator to restate the opening balance.');
    }
    var fields = itemFields_(site, p, r);
    if (p.active !== undefined) fields.Active = p.active === false ? 'FALSE' : 'TRUE';

    // only the fields that would actually change anything
    var changed = {};
    Object.keys(fields).forEach(function (k) {
      if (String(r[k] === undefined ? '' : r[k]).trim() !== String(fields[k]).trim()) {
        changed[k] = fields[k];
      }
    });
    if (!Object.keys(changed).length) return shapeItem_(r, site);

    if (String(actor.Role).toUpperCase() !== 'ADMIN') {
      return requestItemChange_(actor, site, r, changed, 'EDIT');
    }
    return applyItemEdit_(site, r, changed, actor);
  });
}

function applyItemEdit_(site, r, changed, actor) {
  var tab = invSheet_(site);
  var patch = {};
  Object.keys(changed).forEach(function (k) { patch[k] = changed[k]; });
  patch.Updated_By = actor.Name;
  patch.Updated_At = now_();
  update_(tab, r.__row, patch);
  memoClear_();
  return shapeItem_(findBy_(tab, 'Item_Code', safeStr_(r.Item_Code)), site);
}

/** Correcting the opening balance is how a counted figure is set right.
 *  It is a deliberate act by an administrator and is logged as one. */
function setOpeningStock_(token, p) {
  var actor = requireRole_(token, ['ADMIN']);
  return withLock_(function () {
    var site = inventorySiteFor_(actor, p && p.site);
    var tab = invSheet_(site);
    var r = safeStr_(p.code) ? findBy_(tab, 'Item_Code', safeStr_(p.code))
                             : findItem_(site, p.name, p.partNumber);
    if (!r) throw new Error('No such item on the ' + site + ' list.');
    var before = num_(r.Initial_Stock, 0);
    var after  = invQty_(p.initialStock, 'Opening stock');
    update_(tab, r.__row, { Initial_Stock: after, Updated_By: actor.Name, Updated_At: now_() });
    memoClear_();
    logStock_(site, '', safeStr_(r.Item_Name), safeStr_(r.Part_Number), 0,
              STOCK_TXN.ADJUSTED, '', actor,
              'Opening balance corrected: ' + before + ' \u2192 ' + after, false);
    refreshItemFigures_(site, r.Item_Code);
    return shapeItem_(findBy_(tab, 'Item_Code', safeStr_(r.Item_Code)), site);
  });
}

/* ================================================================== */
/*  The bridge between the workflow and the shelf                      */
/* ================================================================== */

/** Move a site's stock by `delta` and book it in the ledger.
 *
 *  A movement that would take the shelf below zero is REFUSED, not floored.
 *  Flooring is what made IND-0014 possible: 50 were "issued" from a shelf
 *  holding 1, the missing 49 were quietly absorbed, and the settlement at
 *  step 10 then handed 45 boxes back that had never existed. A figure that
 *  cannot be true must stop the operation, never absorb it.
 *
 *  An unknown item is booked but not invented — the ledger still records the
 *  movement, with a blank balance, because there is no row to balance.
 */
function adjustStock_(site, indentId, name, partNumber, delta, txnType, actor, remarks, issuedTo) {
  var tab = invSheet_(site);
  var d = num_(delta, 0);
  var r = tab ? findItem_(site, name, partNumber) : null;
  var balance = '';

  if (r && d) {
    var before = derivedStockOf_(site, r);
    var after  = before + d;
    if (after < 0) {
      throw new Error('There are only ' + before + ' ' + (safeStr_(r.Unit) || '') +
                      ' of "' + safeStr_(r.Item_Name) + '" on the ' + site + ' shelf, so ' +
                      Math.abs(d) + ' cannot come off it. Check the figure under Stock, ' +
                      'or reduce the quantity.');
    }
    balance = after;
  }

  /* The ledger is filed under the ITEM LIST's name, never the caller's.
     They are usually the same, but not always: a transfer arriving from
     Tonk carries Tonk's name for the thing, and Newai may have matched it
     on the part number under a name of their own. Writing Tonk's name into
     Newai's ledger would file the movement under an item Newai does not
     have, and the shelf figure would never see it. */
  logStock_(site, indentId,
            r ? safeStr_(r.Item_Name) : name,
            r ? (safeStr_(r.Part_Number) || safeStr_(partNumber)) : partNumber,
            d, txnType, balance, actor, remarks, true, issuedTo);
  if (r) refreshItemFigures_(site, r.Item_Code);
  return balance;
}

/** What the ledger says is on the shelf: the opening balance plus every
 *  movement since. This is the figure every guard reads — never the cell,
 *  because a person typing into the sheet writes the ledger, not the cell. */
function derivedStockOf_(site, r) {
  var t = totalsFor_(ledgerTotals_(), site, r.Item_Name);
  return num_(r.Initial_Stock, 0) + t.in - t.out;
}

/** Write the derived figures back so the sheet reads correctly on its own.
 *  Nothing depends on these cells; they exist for a human with the tab open. */
function refreshItemFigures_(site, itemCode) {
  var tab = invSheet_(site);
  if (!tab) return;
  var r = findBy_(tab, 'Item_Code', safeStr_(itemCode));
  if (!r) return;
  var t = totalsFor_(ledgerTotals_(), site, r.Item_Name);
  var stock = num_(r.Initial_Stock, 0) + t.in - t.out;
  var rop = blankNum_(r.ROP_Override) === ''
    ? reorderPointOf_(r.Avg_Daily_Consumption, r.Lead_Time_Days, r.Safety_Stock)
    : num_(r.ROP_Override, 0);
  update_(tab, r.__row, {
    Total_IN: t.in, Total_OUT: t.out, Current_Stock: stock, Reorder_Point: rop
  });
}

/** What is on the shelf right now, and whether the item is listed at all.
 *  Used by every guard that has to decide before it moves anything. */
function shelfFor_(site, name, partNumber) {
  var r = findItem_(site, name, partNumber);
  if (!r) return { listed: false, stock: 0, unit: '', name: safeStr_(name) };
  return { listed: true, stock: derivedStockOf_(site, r),
           unit: safeStr_(r.Unit) || '', name: safeStr_(r.Item_Name),
           maxOrderQty: num_(r.Max_Order_Qty, 0), minOrderQty: num_(r.Min_Order_Qty, 0) };
}

/** `moves` says whether this row actually changed the shelf. A checkpoint
 *  (a hub count, a counter purchase in transit) records the quantity but
 *  leaves the figure alone, and must not be summed as a movement. */
function logStock_(site, indentId, name, partNumber, qty, txnType, balance, actor, remarks, moves, issuedTo) {
  insert_(SH.STOCK, {
    Transaction_ID: 'TXN-' + uuid_().slice(0, 8),
    Indent_ID     : safeStr_(indentId),
    Product_Name  : safeStr_(name),
    Part_Number   : safeStr_(partNumber),
    Quantity      : qty,
    Transaction_Type: txnType,
    Site          : safeStr_(site),
    Balance_After : balance === '' ? '' : balance,
    Actor_ID      : actor ? actor.User_ID : 'SYSTEM',
    Actor_Name    : actor ? actor.Name : 'System',
    Timestamp     : now_(),
    Remarks       : safeStr_(remarks),
    Moves_Stock   : moves ? 'Y' : 'N',
    Issued_To     : safeStr_(issuedTo)
  });
  clearLedgerCache_();

  // Every real stock movement can also be written to the site's IMS sheet (added in
  // version 19). OFF unless the Settings tab says IMS_PUSH_ENABLED = TRUE: the IMS
  // sheets are filled in by hand by the store teams, and pushing as well would count
  // every movement twice. When on, it runs once the write lock is released.
  if (moves && truthy_(getSetting_('IMS_PUSH_ENABLED'))) {
    var imsType = "";
    var upperTxn = String(txnType).toUpperCase();
    if (['RECEIVED_AT_PLANT', 'RETURNED_TO_STOCK', 'TRANSFER_IN'].indexOf(upperTxn) !== -1) {
      imsType = "In";
    } else if (['ISSUED', 'TAKEN_BY_REQUESTER', 'TRANSFER_OUT'].indexOf(upperTxn) !== -1) {
      imsType = "Out";
    }
    if (imsType !== "") {
      var at = new Date();
      afterLock_(function () { pushToExternalIMS_(site, at, imsType, partNumber, name, qty, remarks); });
    }
  }
}

/** The most of this item the purchase team may buy without the admin.
 *  0 means no ceiling has been set for it. */
function maxOrderQtyFor_(site, name, partNumber) {
  var r = findItem_(site, name, partNumber);
  return r ? num_(r.Max_Order_Qty, 0) : 0;
}

/** Is this quantity over the item's ceiling?  Returns 0 when it is not,
 *  otherwise the ceiling that was exceeded. */
function overMaxOrderQty_(ind) {
  var max = maxOrderQtyFor_(ind.Site, ind.Part_Name, ind.Part_Number);
  if (!max) return 0;
  var want = num_(ind.Quantity, 0);
  return want > max ? max : 0;
}


/* ==================================================================
   Reconciliation — finding what the old floor-at-zero already broke
   ------------------------------------------------------------------
   Until this version, a movement that would have taken the shelf below
   zero was floored instead of refused. That made impossible operations
   look successful and left figures that cannot be derived from their
   own ledger. IND-0014 is the known case: 50 issued from a shelf of 1,
   then 45 handed back that had never left.

   This walks each site's ledger and reports every item whose current
   figure disagrees with the sum of its own movements. It REPORTS ONLY.
   The true figure is on the shelf, not in the sheet, so a storekeeper
   has to count and correct it — which is logged as a deliberate
   adjustment, exactly as a correction should be.
   ================================================================== */
function reconcileStock_(token) {
  if (token) requireRole_(token, ['ADMIN']);
  var out = [];
  var totals = ledgerTotals_();

  siteList_().forEach(function (site) {
    var tab = invSheet_(site);
    if (!tab) return;
    readAll_(tab).forEach(function (r) {
      if (!truthy_(r.Active)) return;
      var t = totalsFor_(totals, site, r.Item_Name);
      var expected = num_(r.Initial_Stock, 0) + t.in - t.out;
      var actual   = num_(r.Current_Stock, 0);
      var drift    = actual - expected;
      if (Math.abs(drift) < 0.0001) return;
      out.push({
        site: site, item: safeStr_(r.Item_Name), unit: safeStr_(r.Unit),
        onSheet: actual, fromLedger: expected, drift: drift, movements: t.rows
      });
    });
  });

  out.sort(function (a, b) { return Math.abs(b.drift) - Math.abs(a.drift); });
  return out;
}

/* ==================================================================
   Average daily consumption
   ------------------------------------------------------------------
   What actually leaves the shelf, per day, over the lookback window.
   Only issues count as consumption — a transfer or a correction is not
   demand, and counting it would inflate every reorder point that
   depends on it.
   ================================================================== */
var CONSUMPTION_TYPES = ['ISSUED', 'TAKEN_BY_REQUESTER'];

function updateConsumption(lookbackDays) {
  var days = num_(lookbackDays, 0) || num_(getSetting_('CONSUMPTION_LOOKBACK_DAYS'), 0) ||
             CONSUMPTION_LOOKBACK_DAYS;
  var to   = now_();
  var from = new Date(to.getTime() - days * 86400000);

  // out-movements that count as demand, per site and item
  var used = {};
  readAll_(SH.STOCK).forEach(function (r) {
    if (CONSUMPTION_TYPES.indexOf(String(r.Transaction_Type).toUpperCase()) === -1) return;
    var at = toDate_(r.Timestamp);
    if (!at || at < from || at > to) return;
    var q = num_(r.Quantity, 0);
    if (q >= 0) return;
    var k = String(r.Site || '').toUpperCase().trim() + '::' + itemKey_(r.Product_Name);
    used[k] = (used[k] || 0) + (-q);
  });

  var touched = 0;
  siteList_().forEach(function (site) {
    var tab = invSheet_(site);
    if (!tab) return;
    readAll_(tab).forEach(function (r) {
      if (!truthy_(r.Active)) return;
      var qty = used[site + '::' + itemKey_(r.Item_Name)] || 0;
      var adc = Math.round((qty / days) * 100) / 100;
      var rop = blankNum_(r.ROP_Override) === ''
        ? reorderPointOf_(adc, r.Lead_Time_Days, r.Safety_Stock)
        : num_(r.ROP_Override, 0);
      if (num_(r.Avg_Daily_Consumption, -1) === adc && num_(r.Reorder_Point, -1) === rop) return;
      update_(tab, r.__row, { Avg_Daily_Consumption: adc, Reorder_Point: rop });
      touched++;
    });
  });

  bumpIfDirty_();
  return 'Consumption recalculated over ' + days + ' days. ' + touched + ' items updated.';
}

/** Recompute every derived figure on every site. The safety net behind
 *  rows typed straight into the ledger, and cheap enough to run often.
 *
 *  Each derived column is written back in ONE call per tab, and only when
 *  something in it moved (it used to be three calls per changed row). Only
 *  these four app-owned columns are written, so a hand edit to any other
 *  column made meanwhile is never overwritten.
 *
 *  Nothing on screen is drawn from these columns (figures are worked out
 *  from the ledger), so the sweep does not make open screens reload. */
function stockSweep() {
  var totals = ledgerTotals_();
  var fixed = 0;
  var DERIVED = ['Total_IN', 'Total_OUT', 'Current_Stock', 'Reorder_Point'];
  siteList_().forEach(function (site) {
    var tab = invSheet_(site);
    if (!tab) return;
    var rows = readAll_(tab);
    if (!rows.length) return;
    var head = headers_(tab);
    var idx = DERIVED.map(function (h) { return head.indexOf(h); });
    if (idx.some(function (i) { return i === -1; })) return;     // not this app's layout: leave it
    var lastRow = rows[rows.length - 1].__row;
    // start from what is there now, row by row, so untouched rows are written back unchanged
    var cols = DERIVED.map(function () { var a = []; for (var i = 2; i <= lastRow; i++) a.push(['']); return a; });
    var moved = DERIVED.map(function () { return false; });
    rows.forEach(function (r) {
      var at = r.__row - 2;
      DERIVED.forEach(function (h, k) { cols[k][at][0] = r[h]; });
      if (!truthy_(r.Active)) return;
      var t = totalsFor_(totals, site, r.Item_Name);
      var stock = num_(r.Initial_Stock, 0) + t.in - t.out;
      var rop = blankNum_(r.ROP_Override) === ''
        ? reorderPointOf_(r.Avg_Daily_Consumption, r.Lead_Time_Days, r.Safety_Stock)
        : num_(r.ROP_Override, 0);
      var want = [t.in, t.out, stock, rop];
      var rowMoved = false;
      DERIVED.forEach(function (h, k) {
        if (num_(r[h], -1) !== want[k]) { cols[k][at][0] = want[k]; moved[k] = true; rowMoved = true; }
      });
      if (rowMoved) fixed++;
    });
    var sh = sheet_(tab);
    DERIVED.forEach(function (h, k) {
      if (moved[k]) sh.getRange(2, idx[k] + 1, cols[k].length, 1).setValues(cols[k]);
    });
    if (moved.some(Boolean)) { memoClear_(tab); touchTab_(tab); }
  });
  flushTabs_();
  return fixed;
}

/** Readable version for the Apps Script editor. */
function reconcileStock() {
  portalAssertEditor_();
  var bad = reconcileStock_(null);
  if (!bad.length) return 'Every item reconciles with its own ledger. Nothing to correct.';
  var lines = bad.map(function (b) {
    return '  ' + b.site + ' · ' + b.item + ': sheet says ' + b.onSheet + ' ' + b.unit +
           ', its movements add up to ' + b.fromLedger +
           ' (' + (b.drift > 0 ? '+' : '') + b.drift + ')';
  });
  return bad.length + ' item' + (bad.length === 1 ? '' : 's') + ' cannot be reconciled with ' +
         'their own ledger. These are almost certainly from the old floor-at-zero bug.\n' +
         'Count each one and correct it under Stock ▸ Edit:\n\n' + lines.join('\n');
}

/* ==================================================================
   The date range
   ------------------------------------------------------------------
   One engine behind every figure that can be asked for over a period:
   the item list's in and out columns, the ledger, the history screens.

   Four presets and a custom range. "All time" is not a range at all —
   it skips the filtering entirely, which is both faster and the only
   honest answer for an opening balance.
   ================================================================== */
function dateRange_(key, from, to) {
  var k = String(key || 'ALL').toUpperCase();
  var now = now_();

  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0); }
  function endOfDay(d)   { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999); }
  function span(a, b, label, code) {
    var days = Math.max(1, Math.round((b - a) / 86400000));
    return { key: code, label: label, from: a, to: b, days: days, all: false };
  }

  if (k === 'TODAY')  return span(startOfDay(now), endOfDay(now), 'Today', 'TODAY');
  if (k === 'MONTH')  return span(new Date(now.getFullYear(), now.getMonth(), 1),
                                  endOfDay(now), 'This month', 'MONTH');
  if (k === 'YEAR')   return span(new Date(now.getFullYear(), 0, 1),
                                  endOfDay(now), 'This year', 'YEAR');

  if (k === 'CUSTOM') {
    var a = toDate_(from), b = toDate_(to);
    if (!a || !b) throw new Error('Pick both a start and an end date for a custom range.');
    a = startOfDay(a); b = endOfDay(b);
    if (a > b) throw new Error('The start date is after the end date.');
    return span(a, b, fmtDay_(a) + ' – ' + fmtDay_(b), 'CUSTOM');
  }

  return { key: 'ALL', label: 'All time', from: null, to: null, days: 0, all: true };
}

function fmtDay_(d) {
  if (!d) return '';
  return Utilities.formatDate(d, APP.TIMEZONE, 'dd MMM yy');
}
function dayKey_(d) {
  if (!d) return '';
  return Utilities.formatDate(d, APP.TIMEZONE, 'yyyy-MM-dd');
}

/** The four presets the screens offer, so the browser never hard-codes them. */
function rangePresets_() {
  return [
    { key: 'TODAY', label: 'Today' },
    { key: 'MONTH', label: 'This month' },
    { key: 'YEAR',  label: 'This year' },
    { key: 'ALL',   label: 'All time' }
  ];
}

/* ==================================================================
   Item ledger — one item, one site, over a period
   ------------------------------------------------------------------
   Date, In, Out, who did it, who it went to. A day with no movement
   does not appear at all; a day with three movements appears three
   times, because collapsing them would hide who took what.
   ================================================================== */
function itemLedger_(token, p) {
  /* The ledger names who took what and how much is left. That is the store's
     working record and the purchase team's evidence; it is not something a
     requester needs to raise an indent, and it is not theirs to browse. */
  var actor = requireRole_(token, ['STORE', 'PURCHASE', 'ADMIN']);
  p = p || {};
  var site  = inventorySiteFor_(actor, p.site);
  var range = dateRange_(p.range, p.from, p.to);

  var name = safeStr_(p.name), part = safeStr_(p.partNumber);
  if (!name && !part && !safeStr_(p.code)) {
    return { site: site, range: rangeOut_(range), item: null, rows: [],
             items: itemPickList_(site), sites: sitesVisibleTo_(actor),
             presets: rangePresets_(), opening: 0, totalIn: 0, totalOut: 0, closing: 0 };
  }

  var r = safeStr_(p.code) ? findBy_(invSheet_(site), 'Item_Code', safeStr_(p.code))
                           : findItem_(site, name, part);
  if (!r) throw new Error('No such item on the ' + site + ' list.');
  var item = shapeItem_(r, site);

  var key = itemKey_(r.Item_Name);

  var rows = readAll_(SH.STOCK).filter(function (x) {
    if (String(x.Site || '').toUpperCase().trim() !== site) return false;
    if (itemKey_(x.Product_Name) !== key) return false;
    var flag  = safeStr_(x.Moves_Stock).toUpperCase();
    var moves = flag ? (flag === 'Y') : txnMovesStock_(x.Transaction_Type);
    if (!moves) return false;
    if (num_(x.Quantity, 0) === 0) return false;       // nothing moved, nothing to show
    if (!range.all) {
      var at = toDate_(x.Timestamp);
      if (!at || at < range.from || at > range.to) return false;
    }
    return true;
  });

  rows.sort(function (a, b) { return (toDate_(a.Timestamp) || 0) - (toDate_(b.Timestamp) || 0); });

  // the balance the period opened on
  var opening = item.initialStock;
  if (!range.all) {
    var before = totalsFor_(ledgerTotals_({ from: new Date(0), to: range.from }),
                            site, r.Item_Name);
    opening = item.initialStock + before.in - before.out;
  }

  var running = opening, tIn = 0, tOut = 0;
  var out = rows.map(function (x) {
    var q = num_(x.Quantity, 0);
    var inQ = q > 0 ? q : '', outQ = q < 0 ? -q : '';
    if (q > 0) tIn += q; else tOut += -q;
    running += q;
    return {
      at       : iso_(x.Timestamp),
      day      : dayKey_(toDate_(x.Timestamp)),
      dayLabel : fmtDay_(toDate_(x.Timestamp)),
      inQty    : inQ,
      outQty   : outQ,
      byWhom   : safeStr_(x.Actor_Name) || 'System',
      issuedTo : issuedToOf_(x),
      type     : safeStr_(x.Transaction_Type),
      indentId : safeStr_(x.Indent_ID),
      remarks  : safeStr_(x.Remarks),
      balance  : running
    };
  });

  return {
    site: site, sites: sitesVisibleTo_(actor), presets: rangePresets_(),
    range: rangeOut_(range),
    item: { code: item.code, name: item.name, partNumber: item.partNumber,
            unit: item.unit, section: item.section },
    items: itemPickList_(site),
    opening: opening, totalIn: tIn, totalOut: tOut, closing: running,
    rows: out
  };
}

/** Who the goods went to.
 *
 *  The row's own Issued_To wins whenever it is filled in — a storekeeper
 *  restocking the shelf and then handing ten of them to a fitter named that
 *  fitter, and saying "Deepak" there because Deepak raised the indent would
 *  be plainly wrong. Only when the row says nothing do we fall back to the
 *  person who asked for it, which is who an ordinary issue goes to.
 */
function issuedToOf_(row) {
  var named = safeStr_(row.Issued_To);
  if (named) return named;

  var id = safeStr_(row.Indent_ID);
  if (id) {
    var ind = findBy_(SH.INDENTS, 'Indent_ID', id);
    if (ind) {
      return safeStr_(ind.Requested_By) +
             (safeStr_(ind.Section) ? ' · ' + safeStr_(ind.Section) : '');
    }
  }
  return '';
}

function rangeOut_(range) {
  return { key: range.key, label: range.label, days: range.days, all: range.all,
           from: range.from ? iso_(range.from) : '', to: range.to ? iso_(range.to) : '' };
}

/** Every site this person may look at. */
function sitesVisibleTo_(actor) {
  var mine = String(actor.Site || '').toUpperCase().trim();
  if (roleNeedsSite_(actor.Role) && isSite_(mine)) return [mine];
  return siteList_();
}

/** Names and part numbers for a site, for the pickers. */
function itemPickList_(site) {
  return invRows_(site).map(function (r) {
    return { code: safeStr_(r.Item_Code), name: safeStr_(r.Item_Name),
             partNumber: safeStr_(r.Part_Number), unit: safeStr_(r.Unit) || 'NOS',
             section: safeStr_(r.Section) };
  }).sort(function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; });
}

/* ==================================================================
   History — every movement at a site over a period
   ================================================================== */
function stockHistory_(token, p) {
  var actor = requireRole_(token, ['STORE', 'PURCHASE', 'ADMIN']);
  p = p || {};
  var site  = inventorySiteFor_(actor, p.site);
  var range = dateRange_(p.range, p.from, p.to);
  var q     = safeStr_(p.q).toLowerCase();

  var rows = readAll_(SH.STOCK).filter(function (x) {
    if (String(x.Site || '').toUpperCase().trim() !== site) return false;
    if (num_(x.Quantity, 0) === 0) return false;
    if (!range.all) {
      var at = toDate_(x.Timestamp);
      if (!at || at < range.from || at > range.to) return false;
    }
    if (q) {
      var hay = (safeStr_(x.Product_Name) + ' ' + safeStr_(x.Part_Number) + ' ' +
                 safeStr_(x.Actor_Name) + ' ' + safeStr_(x.Indent_ID)).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });

  rows.sort(function (a, b) { return (toDate_(b.Timestamp) || 0) - (toDate_(a.Timestamp) || 0); });

  /* A hub count and a counter purchase are recorded here because the store
     wants to see them — but they are checkpoints, not movements: the goods
     are still in transit and the shelf has not changed. They are shown, and
     they are kept out of the two totals, or the totals would not match the
     ledger the stock figure is actually derived from. */
  var tIn = 0, tOut = 0;
  var out = rows.slice(0, 500).map(function (x) {
    var qty = num_(x.Quantity, 0);
    var flag  = safeStr_(x.Moves_Stock).toUpperCase();
    var moves = flag ? (flag === 'Y') : txnMovesStock_(x.Transaction_Type);
    if (moves) { if (qty > 0) tIn += qty; else tOut += -qty; }
    return {
      at: iso_(x.Timestamp), dayLabel: fmtDay_(toDate_(x.Timestamp)),
      item: safeStr_(x.Product_Name), partNumber: safeStr_(x.Part_Number),
      inQty: qty > 0 ? qty : '', outQty: qty < 0 ? -qty : '',
      moves: moves,
      type: safeStr_(x.Transaction_Type), byWhom: safeStr_(x.Actor_Name) || 'System',
      issuedTo: issuedToOf_(x), indentId: safeStr_(x.Indent_ID),
      balance: safeStr_(x.Balance_After), remarks: safeStr_(x.Remarks)
    };
  });

  return { site: site, sites: sitesVisibleTo_(actor), presets: rangePresets_(),
           range: rangeOut_(range), rows: out, shown: out.length,
           total: rows.length, totalIn: tIn, totalOut: tOut };
}

/* ==================================================================
   Reorder list — everything at or below its reorder point
   ------------------------------------------------------------------
   One screen, every site the reader may see, grouped so a purchase
   officer can work down all four in one pass.
   ================================================================== */
function reorderList_(token, p) {
  var actor = requireRole_(token, ['STORE', 'PURCHASE', 'ADMIN']);
  p = p || {};
  var sites = sitesVisibleTo_(actor);
  if (safeStr_(p.site) && sites.indexOf(String(p.site).toUpperCase()) !== -1) {
    sites = [String(p.site).toUpperCase()];
  }

  var totals = ledgerTotals_();
  var groups = sites.map(function (site) {
    var rows = invRows_(site)
      .map(function (r) { return shapeItem_(r, site, totals); })
      .filter(function (i) {
        return i.band === 'OUT' || i.band === 'CRITICAL' || i.band === 'LOW';
      })
      .map(function (i) {
        i.suggestedQty = suggestedOrderQty_(i);
        i.needsApproval = i.maxOrderQty > 0 && i.suggestedQty > i.maxOrderQty;
        return i;
      });

    var rank = { OUT: 0, CRITICAL: 1, LOW: 2 };
    rows.sort(function (a, b) {
      if (rank[a.band] !== rank[b.band]) return rank[a.band] - rank[b.band];
      return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;
    });
    return { site: site, rows: rows, count: rows.length };
  });

  return { groups: groups, sites: sites,
           total: groups.reduce(function (n, g) { return n + g.count; }, 0) };
}

/** How much to order to bring the shelf back to a working level.
 *
 *  The reorder point is where you ORDER, not where you want to sit — so
 *  ordering exactly back to it would trip the alarm again on arrival.
 *  The target is the reorder point plus another lead time's consumption,
 *  which is one full order cycle of headroom:
 *
 *      target = reorder point + (average daily consumption x lead time)
 *      need   = target - what is there
 *      never less than the vendor's minimum
 */
function suggestedOrderQty_(i) {
  var target = i.reorderPoint + (i.adc * i.leadDays);
  var need = target - i.stock;

  /* An item sitting exactly ON its reorder point works out to a need of
     zero, and a reorder list that says "order 0" is worse than useless —
     it is on the list precisely because something has to be done about it.
     So the floor is whatever lifts the shelf clear of the point again. */
  if (need <= 0) need = Math.max(1, i.reorderPoint - i.stock + 1);

  if (i.minOrderQty > 0 && need < i.minOrderQty) need = i.minOrderQty;
  return Math.ceil(need * 100) / 100;
}

/* ==================================================================
   Item requests — nothing reaches a list without the administrator
   ------------------------------------------------------------------
   A store change is held here, carrying the before and the after. The
   indent that prompted it is NOT held: the item name is already
   written on the indent, so work continues while the list catches up.
   ================================================================== */

/** Human-readable names for the fields, so the admin reads a change
 *  rather than a column name. */
var ITEM_FIELD_LABEL = {
  Item_Name: 'Item name', Part_Number: 'Part number', Unit: 'Unit', Section: 'Section',
  Lead_Time_Days: 'Lead time (days)', Safety_Stock: 'Safety stock',
  Min_Order_Qty: 'Minimum order quantity', Max_Order_Qty: 'Maximum order quantity',
  ROP_Override: 'Reorder point (set by hand)', Initial_Stock: 'Opening stock',
  Notes: 'Notes', Active: 'Active'
};

function requestItemChange_(actor, site, existing, changes, kind) {
  var id = nextId_(SH.ITEM_REQ, 'Request_ID', 'REQ', 4);
  var before = {};
  if (existing) {
    Object.keys(changes).forEach(function (k) {
      before[k] = existing[k] === undefined ? '' : existing[k];
    });
  }
  insert_(SH.ITEM_REQ, {
    Request_ID : id,
    Site       : site,
    Kind       : kind,
    Item_Code  : existing ? safeStr_(existing.Item_Code) : '',
    Item_Name  : changes.Item_Name || (existing ? safeStr_(existing.Item_Name) : ''),
    Part_Number: changes.Part_Number !== undefined ? changes.Part_Number
                 : (existing ? safeStr_(existing.Part_Number) : ''),
    Changes_JSON: JSON.stringify(changes),
    Before_JSON : JSON.stringify(before),
    Indent_ID  : safeStr_(changes.__indentId || changes.__transferId || ''),
    Status     : 'PENDING',
    Requested_By_ID: actor.User_ID, Requested_By: actor.Name, Requested_At: now_(),
    Decided_By : '', Decided_At: '', Decision_Note: ''
  });
  notify_('ITEM_REQUEST', null, {
    actorId: actor.User_ID,
    note: actor.Name + (kind === 'ADD' ? ' wants to add "' : ' wants to change "') +
          (changes.Item_Name || (existing ? safeStr_(existing.Item_Name) : 'an item')) +
          '" on the ' + site + ' list'
  });
  return { pending: true, requestId: id, kind: kind, site: site,
           name: changes.Item_Name || (existing ? safeStr_(existing.Item_Name) : ''),
           message: kind === 'ADD'
             ? 'Sent to the administrator to approve. The indent can carry on in the meantime.'
             : 'Sent to the administrator to approve. The item is unchanged until then.' };
}

/** Is this item already waiting on a decision? Stops a second request
 *  for the same thing piling up behind the first. */
function itemRequestPending_(site, name, partNumber) {
  var n = String(name || '').trim().toLowerCase();
  var pn = String(partNumber || '').trim().toLowerCase();
  var hit = null;
  readAll_(SH.ITEM_REQ).forEach(function (r) {
    if (hit) return;
    if (String(r.Status) !== 'PENDING') return;
    if (String(r.Site || '').toUpperCase().trim() !== String(site).toUpperCase().trim()) return;
    if (n && String(r.Item_Name).trim().toLowerCase() === n) hit = r;
    else if (pn && String(r.Part_Number).trim().toLowerCase() === pn) hit = r;
  });
  return hit;
}

function listItemRequests_(token, p) {
  var actor = requireAuth_(token);
  p = p || {};
  var status = safeStr_(p.status).toUpperCase() || 'PENDING';
  var mine = String(actor.Role).toUpperCase() === 'STORE';
  var site = String(actor.Site || '').toUpperCase().trim();

  return readAll_(SH.ITEM_REQ)
    .filter(function (r) {
      if (status !== 'ALL' && String(r.Status) !== status) return false;
      if (mine && String(r.Site || '').toUpperCase().trim() !== site) return false;
      return true;
    })
    .map(shapeItemRequest_)
    .sort(function (a, b) { return (b.at || '') < (a.at || '') ? -1 : 1; });
}

function shapeItemRequest_(r) {
  var changes = {}, before = {};
  try { changes = JSON.parse(r.Changes_JSON || '{}'); } catch (e) {}
  try { before  = JSON.parse(r.Before_JSON  || '{}'); } catch (e) {}
  var fields = Object.keys(changes)
    .filter(function (k) { return k.indexOf('__') !== 0; })
    .map(function (k) {
      return { field: k, label: ITEM_FIELD_LABEL[k] || k,
               from: before[k] === undefined ? '' : String(before[k]),
               to: String(changes[k]) };
    });
  return {
    id: safeStr_(r.Request_ID), site: safeStr_(r.Site), kind: safeStr_(r.Kind),
    itemCode: safeStr_(r.Item_Code), name: safeStr_(r.Item_Name),
    partNumber: safeStr_(r.Part_Number), indentId: safeStr_(r.Indent_ID),
    status: safeStr_(r.Status), fields: fields,
    by: safeStr_(r.Requested_By), at: iso_(r.Requested_At),
    decidedBy: safeStr_(r.Decided_By), decidedAt: iso_(r.Decided_At),
    note: safeStr_(r.Decision_Note)
  };
}

function decideItemRequest_(token, p) {
  var actor = requireRole_(token, ['ADMIN']);
  return withLock_(function () {
    var r = findBy_(SH.ITEM_REQ, 'Request_ID', safeStr_(p.requestId));
    if (!r) throw new Error('No such request.');
    if (String(r.Status) !== 'PENDING') {
      throw new Error('That request was already ' + String(r.Status).toLowerCase() + '.');
    }
    var approve = String(p.decision || '').toUpperCase() === 'APPROVE';
    var note = safeStr_(p.note);
    if (!approve && !note) throw new Error('Say why you are turning it down, so the store knows.');

    var site = safeStr_(r.Site);
    var changes = {};
    try { changes = JSON.parse(r.Changes_JSON || '{}'); } catch (e) {}
    delete changes.__indentId;

    delete changes.__transferId;

    var result = null;
    if (approve) {
      if (String(r.Kind) === 'ADD') {
        if (findItem_(site, changes.Item_Name, changes.Part_Number)) {
          throw new Error('"' + changes.Item_Name + '" is already on the ' + site +
                          ' list — somebody added it while this was waiting. Turn this one down.');
        }
        result = applyItemAdd_(site, changes, actor);
      } else {
        var row = findBy_(invSheet_(site), 'Item_Code', safeStr_(r.Item_Code));
        if (!row) throw new Error('That item is no longer on the ' + site + ' list.');
        result = applyItemEdit_(site, row, changes, actor);
      }
    }

    update_(SH.ITEM_REQ, r.__row, {
      Status: approve ? 'APPROVED' : 'REJECTED',
      Decided_By: actor.Name, Decided_At: now_(), Decision_Note: note
    });

    /* Goods can be standing in a store waiting on this decision. Approving
       the item lands them on the shelf; turning it down sends them back
       where they came from. Either way nobody has to remember to come back
       and finish it by hand. */
    var landed = approve ? landTransfersWaitingOn_(safeStr_(r.Request_ID), actor)
                         : returnTransfersWaitingOn_(safeStr_(r.Request_ID), actor,
                             note || 'The item was not approved for the receiving site.');

    return { decision: approve ? 'APPROVED' : 'REJECTED', item: result,
             transfers: landed };
  });
}

/** How many item changes are sitting on the admin's desk. */
function pendingItemRequestCount_() {
  return readWhere_(SH.ITEM_REQ, function (r) { return String(r.Status) === 'PENDING'; }).length;
}


/* ------------------------------------------------------------------
   SMART IMS PUSH (restored from version 19, unchanged)
   ------------------------------------------------------------------ */
/**
 * SMART IMS PUSH: Pushes data to the specific site's IMS Google Sheet.
 * Includes Auto-Match logic to find the correct SKU from the IMS 'Item List' tab.
 */
function pushToExternalIMS_(site, timestamp, type, sku, itemName, qty, remarks) {
  var imsIds = {
    'TONK': '1pyz5-wfC1I_Rr_oXiTQU1hR-ePOo01UvzfufJv30mQg',
    'NEWAI': '1qtO8LOOigprTWrXIX-70iYaDVrHyJgf3eSgafBhZ_UI',
    'KHAKHUNDA': '10_0tLel0Vk9o6htH3kB_y9M5z-5MKzV0tY0M8WGhkgs',
    'SANWARIYA': '1TPgwve108SjFSqSJ6DYAcBJrNGN76hEhcij5vtyJK5G819CvV7Fm'
  };

  var safeSite = String(site).toUpperCase().trim();
  var sheetId = imsIds[safeSite];
  
  if (!sheetId) return; 

  try {
    var imsSS = SpreadsheetApp.openById(sheetId);
    var formSheet = imsSS.getSheetByName("In/Out (Form)");
    var itemListSheet = imsSS.getSheetByName("Item List"); 
    
    if (!formSheet) return; 

    // -------------------------------------------------------------
    // SMART AUTO-MATCH LOGIC: Find matching SKU from IMS Item List
    // -------------------------------------------------------------
    var finalCombinedName = "";
    var safeWebName = String(itemName || "").trim().toLowerCase();
    var matchFound = false;

    if (itemListSheet) {
      var listData = itemListSheet.getDataRange().getValues();
      for (var i = 1; i < listData.length; i++) {
        var imsSku = String(listData[i][0]).trim(); 
        var imsItemName = String(listData[i][1]).trim(); 
        
        if (imsItemName.toLowerCase() === safeWebName) {
          finalCombinedName = imsSku + " - " + imsItemName;
          matchFound = true;
          break; 
        }
      }
    }

    if (!matchFound) {
      var safeSku = String(sku || "").trim();
      var safeName = String(itemName || "").trim();
      finalCombinedName = safeSku ? (safeSku + " - " + safeName) : safeName;
    }
    // -------------------------------------------------------------

    var lastRow = Math.max(formSheet.getLastRow(), 1);
    var lastSrNo = 0;
    if (lastRow > 1) {
      lastSrNo = Number(formSheet.getRange(lastRow, 1).getValue()) || 0;
    }
    var newSrNo = lastSrNo + 1;

    var absQty = Math.abs(Number(qty) || 0); 
    var finalRemark = String(remarks || "WebApp Auto Entry").trim();

    formSheet.appendRow([newSrNo, timestamp, type, finalCombinedName, absQty, "", finalRemark]);
    
  } catch(error) {
    console.error("IMS Push Failed for " + safeSite + ": " + error.message);
  }
}
